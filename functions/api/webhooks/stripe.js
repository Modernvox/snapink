import { calculateRetailPricing } from "../../_lib/retail-pricing.mjs";
import { json, now } from "../../_lib/orders.js";
import { EmailDeliveryError, sendSnapInkEmail } from "../../_lib/snapink-email.js";
import { safeOrderJson, verifyStripeSignature } from "../../_lib/retail-order-utils.js";
import { handleShopStripeEvent } from "../../_lib/shop-stripe.js";

const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function recordEvent(db,event,orderId) {
  await db.prepare("INSERT OR IGNORE INTO retail_stripe_events(event_id,event_type,order_id,received_at) VALUES(?,?,?,?)")
    .bind(event.id,event.type,orderId,now()).run();
}

async function notifyPayment(env,order,pricing,taxCents,totalPaidCents) {
  const time=now();
  const ownerClaim=await env.DB.prepare("UPDATE retail_orders SET owner_payment_notice_status='sending',updated_at=? WHERE id=? AND status='PAID' AND owner_payment_notice_status IN ('pending','failed')").bind(time,order.id).run();
  const customerClaim=await env.DB.prepare("UPDATE retail_orders SET payment_confirmation_status='sending',updated_at=? WHERE id=? AND status='PAID' AND payment_confirmation_status IN ('pending','failed')").bind(time,order.id).run();
  if(!ownerClaim.meta?.changes&&!customerClaim.meta?.changes) return;
  const design=safeOrderJson(order.draftJson);
  const summary=`Order ${order.orderNumber}\n${order.variant} sleeve / Size ${order.size} / Quantity ${order.quantity}\nDesign: ${design.text?.trim()?`“${design.text.trim()}”`:design.logoName?`Uploaded artwork (${design.logoName})`:"Custom sleeve colors / blank artwork"}\nColors: sleeve ${design.backgroundColor}, text ${design.fill}, outline ${design.stroke}\nMerchandise subtotal: ${usd(pricing.merchandiseSubtotalCents)}\nQuantity discount: ${pricing.discountCents?`-${usd(pricing.discountCents)}`:"$0.00"}\nShipping: ${usd(pricing.shippingCents)}\nTax: ${usd(taxCents)}\nPaid total: ${usd(totalPaidCents)}`;
  const statuses={owner:"sent",customer:"sent"};
  if(ownerClaim.meta?.changes) {
    try { await sendSnapInkEmail(env,{to:"partners@snapbacksleeves.com",replyTo:order.customerEmail,subject:`Payment received for ${order.orderNumber}`,text:`Stripe confirmed payment for a SnapInk retail order.\n\n${summary}\n\nThe order is paid and ready for your production review. It has not been automatically sent to production.`}); }
    catch(error){statuses.owner="failed";console.error("Retail payment owner notification failed",{orderNumber:order.orderNumber,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"});}
    await env.DB.prepare("UPDATE retail_orders SET owner_payment_notice_status=?,updated_at=? WHERE id=? AND status='PAID'").bind(statuses.owner,now(),order.id).run();
  }
  if(customerClaim.meta?.changes) {
    try { await sendSnapInkEmail(env,{to:order.customerEmail,subject:`Payment confirmed for SnapInk order ${order.orderNumber}`,text:`Your payment was received. Thank you for your SnapInk order.\n\n${summary}\n\nYour order will move into production after our team updates its fulfillment status. We do not promise a ship date in this message.`}); }
    catch(error){statuses.customer="failed";console.error("Retail payment customer confirmation failed",{orderNumber:order.orderNumber,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"});}
    await env.DB.prepare("UPDATE retail_orders SET payment_confirmation_status=?,updated_at=? WHERE id=? AND status='PAID'").bind(statuses.customer,now(),order.id).run();
  }
}

export async function onRequestPost({request,env}) {
  if(!env.DB||!env.STRIPE_WEBHOOK_SECRET) return json({error:"Stripe webhook is not configured."},503);
  const raw=await request.text();
  if(raw.length>1024*1024) return json({error:"Webhook payload is too large."},413);
  let valid=false;
  try { valid=await verifyStripeSignature(raw,request.headers.get("Stripe-Signature"),env.STRIPE_WEBHOOK_SECRET); }
  catch { valid=false; }
  if(!valid) return json({error:"Invalid Stripe webhook signature."},400);
  let event;
  try { event=JSON.parse(raw); }
  catch { return json({error:"Invalid Stripe webhook payload."},400); }
  if(typeof event.id!=="string"||!event.id.startsWith("evt_")||typeof event.type!=="string") return json({error:"Invalid Stripe event."},400);
  try {
    const prior=await env.DB.prepare("SELECT event_id FROM retail_stripe_events WHERE event_id=?").bind(event.id).first();
    if(prior) return json({received:true,duplicate:true});
    const session=event.data?.object;
    if(!session||typeof session.id!=="string"||!String(session.id).startsWith("cs_")) return json({received:true,ignored:true});
    const shopResult=await handleShopStripeEvent(env,event,session);
    if(shopResult)return shopResult;
    const orderId=session.metadata?.order_id;
    if(typeof orderId!=="string"||!/^[a-f0-9]{32}$/.test(orderId)) return json({received:true,ignored:true});
    const order=await env.DB.prepare(`SELECT id,order_number AS orderNumber,status,customer_name AS customerName,customer_email AS customerEmail,quantity,variant,size,
      shipping_address_json AS shippingAddressJson,draft_json AS draftJson,stripe_session_id AS stripeSessionId,unit_price_cents AS unitPriceCents,merchandise_subtotal_cents AS merchandiseSubtotalCents,
      discount_cents AS discountCents,shipping_cents AS shippingCents,total_before_tax_cents AS totalBeforeTaxCents FROM retail_orders WHERE id=?`).bind(orderId).first();
    if(!order||session.metadata?.order_number!==order.orderNumber||session.client_reference_id!==order.orderNumber) return json({received:true,ignored:true});
    if(event.type==="checkout.session.expired") {
      if(order.status==="AWAITING_PAYMENT"&&order.stripeSessionId===session.id) {
        await env.DB.prepare("UPDATE retail_orders SET status='APPROVED',checkout_url=NULL,checkout_expires_at=NULL,updated_at=? WHERE id=? AND status='AWAITING_PAYMENT' AND stripe_session_id=?")
          .bind(now(),order.id,session.id).run();
        await env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)")
          .bind(order.id,"stripe","checkout_expired",JSON.stringify({sessionId:session.id}),now()).run();
      }
      await recordEvent(env.DB,event,order.id);
      return json({received:true});
    }
    if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type)) {
      await recordEvent(env.DB,event,order.id);
      return json({received:true,ignored:true});
    }
    if(event.type==="checkout.session.completed"&&session.payment_status!=="paid") {
      await recordEvent(env.DB,event,order.id);
      return json({received:true,pendingPayment:true});
    }
    if(order.stripeSessionId!==session.id) return json({error:"Checkout session does not match the approved order."},409);
    const pricing=calculateRetailPricing(order.size,order.quantity);
    const taxCents=Number(session.total_details?.amount_tax);
    const shippingCents=Number(session.total_details?.amount_shipping||0);
    const totalCents=Number(session.amount_total);
    const stripeAddress=session.shipping_details?.address;
    const originalAddress=safeOrderJson(order.shippingAddressJson);
    const paidAddress=stripeAddress?{
      line1:typeof stripeAddress.line1==="string"?stripeAddress.line1:originalAddress.line1,
      line2:typeof stripeAddress.line2==="string"?stripeAddress.line2:null,
      city:typeof stripeAddress.city==="string"?stripeAddress.city:originalAddress.city,
      region:typeof stripeAddress.state==="string"&&stripeAddress.state?stripeAddress.state:originalAddress.region,
      postalCode:typeof stripeAddress.postal_code==="string"?stripeAddress.postal_code:originalAddress.postalCode,
      country:typeof stripeAddress.country==="string"?stripeAddress.country:originalAddress.country,
    }:null;
    if(session.currency!=="usd"||session.payment_status!=="paid"||!Number.isInteger(taxCents)||taxCents<0
      ||session.automatic_tax?.enabled!==true||session.automatic_tax?.status!=="complete"
      ||!paidAddress?.line1||!paidAddress.city||!paidAddress.postalCode||paidAddress.country!==originalAddress.country
      ||Number(session.amount_subtotal)!==pricing.discountedMerchandiseCents||shippingCents!==pricing.shippingCents
      ||totalCents!==pricing.totalBeforeTaxCents+taxCents) {
      console.error("Stripe payment did not match retail order totals",{orderNumber:order.orderNumber,eventId:event.id});
      return json({error:"Stripe payment amount or currency did not match the order."},409);
    }
    const paymentIntentId=typeof session.payment_intent==="string"?session.payment_intent:session.payment_intent?.id;
    if(typeof paymentIntentId!=="string"||!paymentIntentId.startsWith("pi_")) return json({error:"Stripe did not provide a verified payment reference."},409);
    if(order.status==="AWAITING_PAYMENT") {
      await env.DB.prepare(`UPDATE retail_orders SET status='PAID',shipping_address_json=?,tax_cents=?,total_paid_cents=?,stripe_payment_intent_id=?,paid_at=?,updated_at=?
        WHERE id=? AND status='AWAITING_PAYMENT' AND stripe_session_id=?`)
        .bind(JSON.stringify(paidAddress),taxCents,totalCents,paymentIntentId,now(),now(),order.id,session.id).run();
    }
    const current=await env.DB.prepare("SELECT status,stripe_session_id AS stripeSessionId,total_paid_cents AS totalPaidCents FROM retail_orders WHERE id=?").bind(order.id).first();
    if(current?.status!=="PAID"||current.stripeSessionId!==session.id||Number(current.totalPaidCents)!==totalCents) return json({error:"Order state did not accept this payment event."},409);
    await recordEvent(env.DB,event,order.id);
    await env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)")
      .bind(order.id,"stripe","payment_confirmed",JSON.stringify({paymentIntentId,taxCents,totalPaidCents:totalCents}),now()).run();
    await notifyPayment(env,order,pricing,taxCents,totalCents);
    return json({received:true,paid:true,orderNumber:order.orderNumber});
  } catch(error) {
    console.error("Stripe retail webhook processing failed",error instanceof Error?error.message:"unknown");
    return json({error:"Stripe event could not be processed."},500);
  }
}
