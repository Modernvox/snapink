import {bearer,json,now} from "../../_lib/orders.js";
import {EmailDeliveryError,sendSnapInkEmail} from "../../_lib/snapink-email.js";

const STATUS=new Set(["CHECKOUT_PENDING","AWAITING_PAYMENT","PAID","IN_PRODUCTION","SHIPPED","COMPLETED","CANCELLED","EXPIRED"]);
const usd=(cents)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(cents||0)/100);
const COLUMNS=`id,order_number AS orderNumber,status,customer_name AS customerName,customer_email AS customerEmail,customer_phone AS customerPhone,shipping_address_json AS shippingAddressJson,items_json AS itemsJson,quantity,merchandise_subtotal_cents AS merchandiseSubtotalCents,discount_cents AS discountCents,shipping_cents AS shippingCents,tax_cents AS taxCents,total_paid_cents AS totalPaidCents,currency,stripe_session_id AS stripeSessionId,stripe_payment_intent_id AS stripePaymentIntentId,checkout_url AS checkoutUrl,tracking_number AS trackingNumber,carrier,admin_notes AS adminNotes,customer_email_status AS customerEmailStatus,owner_email_status AS ownerEmailStatus,payment_email_status AS paymentEmailStatus,fulfillment_email_status AS fulfillmentEmailStatus,created_at AS createdAt,paid_at AS paidAt,updated_at AS updatedAt`;

export async function onRequestGet({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop order storage is unavailable."},503);
  const url=new URL(request.url),status=url.searchParams.get("status")||"",q=(url.searchParams.get("q")||"").trim().slice(0,100);
  if(status&&!STATUS.has(status))return json({error:"Choose a valid Shop order status."},400);
  try{const result=await env.DB.prepare(`SELECT ${COLUMNS} FROM shop_orders WHERE (?='' OR status=?) AND (?='' OR order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?) ORDER BY created_at DESC LIMIT 250`).bind(status,status,q,`%${q}%`,`%${q}%`,`%${q}%`).all();return json({orders:(result.results||[]).map((order)=>({...order,shippingAddress:JSON.parse(order.shippingAddressJson||"{}"),items:JSON.parse(order.itemsJson||"[]")}))})}
  catch(error){console.error("Admin Shop order list failed",error instanceof Error?error.message:"unknown");return json({error:"Shop orders could not be loaded. Apply migration 0012."},503)}
}

export async function onRequestPatch({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Shop order storage is unavailable."},503);
  let body;try{body=await request.json()}catch{return json({error:"Invalid Shop order update."},400)}
  if(typeof body.id!=="string"||!/^[a-f0-9]{32}$/i.test(body.id)||body.action!=="set_fulfillment")return json({error:"Choose a valid Shop order action."},400);
  const order=await env.DB.prepare(`SELECT ${COLUMNS} FROM shop_orders WHERE id=?`).bind(body.id).first();
  if(!order)return json({error:"Shop order not found."},404);
  const transitions={PAID:["IN_PRODUCTION"],IN_PRODUCTION:["SHIPPED"],SHIPPED:["COMPLETED"]};
  if(!transitions[order.status]?.includes(body.status))return json({error:`This order cannot move from ${order.status} to ${String(body.status)}.`},409);
  const carrier=typeof body.carrier==="string"?body.carrier.trim().slice(0,80):"";
  const tracking=typeof body.trackingNumber==="string"?body.trackingNumber.trim().slice(0,120):"";
  if(body.status==="SHIPPED"&&(!carrier||!tracking))return json({error:"Enter the carrier and tracking number before marking this order shipped."},400);
  const time=now();
  const updated=await env.DB.prepare("UPDATE shop_orders SET status=?,carrier=COALESCE(?,carrier),tracking_number=COALESCE(?,tracking_number),updated_at=? WHERE id=? AND status=?")
    .bind(body.status,carrier||null,tracking||null,time,order.id,order.status).run();
  if(!updated.meta?.changes)return json({error:"Shop order changed elsewhere. Refresh and retry."},409);
  await env.DB.prepare("INSERT INTO shop_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(order.id,"admin","fulfillment_status_changed",JSON.stringify({from:order.status,to:body.status,carrier:carrier||order.carrier,trackingNumber:tracking||order.trackingNumber}),time).run();
  const shipping=JSON.parse(order.shippingAddressJson||"{}");
  const subject=body.status==="SHIPPED"?`Your SnapInk order ${order.orderNumber} has shipped`:`SnapInk order ${order.orderNumber}: ${body.status.replaceAll("_"," ").toLowerCase()}`;
  const text=body.status==="SHIPPED"?`Your SnapInk exclusive sleeve order is on the way.\n\nOrder: ${order.orderNumber}\nCarrier: ${carrier}\nTracking: ${tracking}\nShip to: ${shipping.line1}, ${shipping.city}, ${shipping.region} ${shipping.postalCode}, ${shipping.country}`:`Your SnapInk order ${order.orderNumber} is now ${body.status.replaceAll("_"," ").toLowerCase()}.`;
  let emailStatus="sent";
  try{await sendSnapInkEmail(env,{to:order.customerEmail,subject,text})}catch(error){emailStatus="failed";console.error("Shop fulfillment email failed",{orderNumber:order.orderNumber,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"})}
  await env.DB.prepare("UPDATE shop_orders SET fulfillment_email_status=?,updated_at=? WHERE id=?").bind(emailStatus,now(),order.id).run();
  return json({ok:true,orderNumber:order.orderNumber,status:body.status,emailStatus});
}
