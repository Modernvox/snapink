import {json,now} from "./orders.js";
import {calculateShopTotals} from "./retail-pricing.mjs";
import {EmailDeliveryError,sendSnapInkEmail} from "./snapink-email.js";
import {cleanRetailCustomer,cleanShippingAddress} from "./retail-order-utils.js";
import {stripeAutomaticTaxEnabled,stripeSessionTax} from "./stripe-tax.js";

const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);

export async function handleShopStripeEvent(env,event,session){
  const orderId=session?.metadata?.shop_order_id;
  if(typeof orderId!=="string"||!/^[a-f0-9]{32}$/i.test(orderId))return null;
  const prior=await env.DB.prepare("SELECT event_id FROM shop_stripe_events WHERE event_id=?").bind(event.id).first();
  if(prior)return json({received:true,duplicate:true});
  const order=await env.DB.prepare(`SELECT id,order_number AS orderNumber,status,customer_name AS customerName,customer_email AS customerEmail,customer_phone AS customerPhone,
    shipping_address_json AS shippingAddressJson,items_json AS itemsJson,quantity,merchandise_subtotal_cents AS merchandiseSubtotalCents,discount_cents AS discountCents,
    shipping_cents AS shippingCents,stripe_session_id AS stripeSessionId,checkout_url AS checkoutUrl FROM shop_orders WHERE id=?`).bind(orderId).first();
  if(!order||session.metadata?.order_number!==order.orderNumber||session.client_reference_id!==order.orderNumber)return json({received:true,ignored:true});
  const record=()=>env.DB.prepare("INSERT OR IGNORE INTO shop_stripe_events(event_id,event_type,order_id,received_at) VALUES(?,?,?,?)").bind(event.id,event.type,order.id,now()).run();
  let items;
  try{items=JSON.parse(order.itemsJson)}catch{return json({error:"Saved Shop order details are invalid."},500)}
  if(!Array.isArray(items)||!items.length)return json({error:"Saved Shop order items are unavailable."},500);
  const quantity=items.reduce((sum,item)=>sum+Number(item.quantity||0),0);
  const merchandiseSubtotalCents=items.reduce((sum,item)=>sum+Number(item.unitPriceCents||0)*Number(item.quantity||0),0);
  const totals=calculateShopTotals(merchandiseSubtotalCents,quantity);
  if(quantity!==Number(order.quantity)||merchandiseSubtotalCents!==Number(order.merchandiseSubtotalCents)||totals.discountCents!==Number(order.discountCents)||totals.shippingCents!==Number(order.shippingCents))return json({error:"Saved Shop pricing does not reconcile."},409);
  if(event.type==="checkout.session.expired"){
    if(order.status==="AWAITING_PAYMENT"&&order.stripeSessionId===session.id){
      const changed=await env.DB.prepare("UPDATE shop_orders SET status='EXPIRED',checkout_url=NULL,updated_at=? WHERE id=? AND status='AWAITING_PAYMENT' AND stripe_session_id=?").bind(now(),order.id,session.id).run();
      if(changed.meta?.changes){
        for(const item of items)await env.DB.prepare("UPDATE shop_inventory SET reserved_quantity=MAX(0,reserved_quantity-?),updated_at=? WHERE product_id=? AND variant_id=? AND size=?").bind(item.quantity,now(),item.productId,item.variantId,item.size).run();
        await env.DB.prepare("INSERT INTO shop_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(order.id,"stripe","checkout_expired",JSON.stringify({sessionId:session.id}),now()).run();
      }
    }
    await record();
    return json({received:true});
  }
  if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)){await record();return json({received:true,ignored:true})}
  if(event.type==="checkout.session.completed"&&session.payment_status!=="paid"){await record();return json({received:true,pendingPayment:true})}
  if(order.status==="PAID"&&order.stripeSessionId===session.id){await record();return json({received:true,duplicate:true,paid:true})}
  const tax=stripeSessionTax(session,stripeAutomaticTaxEnabled(env)),taxCents=tax?.taxCents,discountCents=Number(session.total_details?.amount_discount||0),shippingCents=Number(session.total_details?.amount_shipping||0),totalCents=Number(session.amount_total);
  if(order.status!=="AWAITING_PAYMENT"||order.stripeSessionId!==session.id||session.currency!=="usd"||session.payment_status!=="paid"
    ||!tax
    ||Number(session.amount_subtotal)!==merchandiseSubtotalCents||discountCents!==totals.discountCents||shippingCents!==totals.shippingCents
    ||totalCents!==totals.totalBeforeTaxCents+taxCents)return json({error:"Stripe payment amount or currency did not match the Shop order."},409);
  const intent=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
  if(typeof intent!=="string"||!intent.startsWith("pi_"))return json({error:"Stripe did not provide a verified payment reference."},409);
  let customer,address;
  try {
    const stripeShipping=session.collected_information?.shipping_details||session.shipping_details;
    customer=cleanRetailCustomer({name:session.customer_details?.name||stripeShipping?.name,email:session.customer_details?.email||session.customer_email,phone:session.customer_details?.phone||stripeShipping?.phone});
    const fromStripe=stripeShipping?.address;
    address=cleanShippingAddress({line1:fromStripe?.line1,line2:fromStripe?.line2,city:fromStripe?.city,region:fromStripe?.state,postalCode:fromStripe?.postal_code,country:fromStripe?.country});
    if(address.country!=="US")throw new Error("A United States shipping address is required.");
  } catch { return json({error:"Stripe did not return the required customer and US shipping details."},409); }
  for(const item of items){
    const stock=await env.DB.prepare("UPDATE shop_inventory SET available_quantity=available_quantity-?,reserved_quantity=MAX(0,reserved_quantity-?),updated_at=? WHERE product_id=? AND variant_id=? AND size=? AND reserved_quantity>=? AND available_quantity>=?")
      .bind(item.quantity,item.quantity,now(),item.productId,item.variantId,item.size,item.quantity,item.quantity).run();
    if(!stock.meta?.changes){const exists=await env.DB.prepare("SELECT size FROM shop_inventory WHERE product_id=? AND variant_id=? AND size=?").bind(item.productId,item.variantId,item.size).first();if(exists)return json({error:"Shop inventory reservation could not be reconciled."},409)}
  }
  const updated=await env.DB.prepare("UPDATE shop_orders SET status='PAID',customer_name=?,customer_email=?,customer_phone=?,shipping_address_json=?,tax_cents=?,total_paid_cents=?,stripe_payment_intent_id=?,paid_at=?,updated_at=? WHERE id=? AND status='AWAITING_PAYMENT' AND stripe_session_id=?")
    .bind(customer.name,customer.email,customer.phone,JSON.stringify(address),taxCents,totalCents,intent,now(),now(),order.id,session.id).run();
  if(!updated.meta?.changes){const check=await env.DB.prepare("SELECT status FROM shop_orders WHERE id=?").bind(order.id).first();if(check?.status!=="PAID")return json({error:"Shop order could not be marked paid."},409)}
  order.customerName=customer.name;order.customerEmail=customer.email;order.customerPhone=customer.phone;order.shippingAddressJson=JSON.stringify(address);
  await env.DB.prepare("INSERT INTO shop_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(order.id,"stripe","payment_confirmed",JSON.stringify({paymentIntentId:intent,taxCents,totalPaidCents:totalCents}),now()).run();
  await record();
  const summary=`Order ${order.orderNumber}\n${items.map((item)=>`${item.quantity} x ${item.name} / ${item.variantName} / Size ${item.size}`).join("\n")}\nMerchandise subtotal: ${usd(merchandiseSubtotalCents)}\nQuantity discount: ${discountCents?`-${usd(discountCents)}`:"$0.00"}\nShipping: ${usd(shippingCents)}\nTax: ${usd(taxCents)}\nTotal paid: ${usd(totalCents)}`;
  const statuses={customer:"sent",owner:"sent"};
  for(const recipient of ["customer","owner"]){
    const to=recipient==="customer"?order.customerEmail:"mikejstpierre@gmail.com";
    try{await sendSnapInkEmail(env,{to,replyTo:recipient==="owner"?order.customerEmail:undefined,subject:recipient==="customer"?`Payment confirmed — SnapInk Shop order ${order.orderNumber}`:`SnapInk Shop order paid — ${order.orderNumber}`,text:`${recipient==="customer"?"Your payment is confirmed. Thank you for choosing a SnapInk exclusive design.":"Stripe confirmed payment for this Shop order. Update its fulfillment status in the admin dashboard when ready."}\n\n${summary}`})}
    catch(error){statuses[recipient]="failed";console.error("Shop payment email failed",{orderNumber:order.orderNumber,recipient,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"})}
  }
  await env.DB.prepare("UPDATE shop_orders SET payment_email_status=?,payment_owner_email_status=?,customer_email_status=?,updated_at=? WHERE id=?").bind(statuses.customer,statuses.owner,statuses.customer,now(),order.id).run();
  return json({received:true,paid:true,orderNumber:order.orderNumber});
}
