import { bearer, json, now } from "../../_lib/orders.js";
import { calculateRetailPricing } from "../../_lib/retail-pricing.mjs";
import { createSnapInkEmailAttachment, EmailDeliveryError, sendSnapInkEmail } from "../../_lib/snapink-email.js";
import { safeOrderJson } from "../../_lib/retail-order-utils.js";
import { stripeAutomaticTaxEnabled, stripeSessionTax } from "../../_lib/stripe-tax.js";
import { setSnapInkCheckoutPaymentMethods } from "../../_lib/stripe-payment-methods.js";

const STATUSES = ["PENDING_REVIEW","CHANGES_REQUESTED","DECLINED","APPROVED","AWAITING_PAYMENT","PAID","IN_PRODUCTION","SHIPPED","COMPLETED"];
const SITE = "https://snapbacksleeves.com";
const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const orderDraft = (order) => order.draft && typeof order.draft === "object" ? order.draft : safeOrderJson(order.draftJson);
const orderShipping = (order) => order.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : safeOrderJson(order.shippingAddressJson);
const designDescription = (draft) => `Design: ${draft.text?.trim() ? `“${draft.text.trim()}”` : draft.logoName ? `Uploaded artwork (${draft.logoName})` : "Custom sleeve colors / blank artwork"}\nColors: sleeve ${draft.backgroundColor}, text ${draft.fill}, outline ${draft.stroke}`;
async function designAttachments(env, order) {
  const draft = orderDraft(order);
  if (!draft.emailPreviewKey || !env.PRIVATE_ASSETS) return [];
  const file = await env.PRIVATE_ASSETS.get(draft.emailPreviewKey);
  if (!file) throw new Error("The saved design email attachment is unavailable.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 3.4 * 1024 * 1024) throw new Error("The saved design email attachment is too large to send safely.");
  return [createSnapInkEmailAttachment(`SnapInk-${order.orderNumber}-design.png`, bytes, "image/png")];
}
const rowOrder = (row) => ({
  ...row,
  shippingAddress: safeOrderJson(row.shippingAddressJson),
  draft: safeOrderJson(row.draftJson),
});

async function loadOrder(db, id) {
  return db.prepare(`SELECT id,order_number AS orderNumber,status,customer_name AS customerName,customer_email AS customerEmail,customer_phone AS customerPhone,
    shipping_address_json AS shippingAddressJson,quantity,variant,size,draft_json AS draftJson,artwork_key AS artworkKey,preview_key AS previewKey,source_artwork_key AS sourceArtworkKey,
    unit_price_cents AS unitPriceCents,merchandise_subtotal_cents AS merchandiseSubtotalCents,discount_cents AS discountCents,shipping_cents AS shippingCents,
    total_before_tax_cents AS totalBeforeTaxCents,tax_cents AS taxCents,total_paid_cents AS totalPaidCents,currency,owner_email_status AS ownerEmailStatus,
    customer_email_status AS customerEmailStatus,payment_email_status AS paymentEmailStatus,payment_confirmation_status AS paymentConfirmationStatus,owner_payment_notice_status AS ownerPaymentNoticeStatus,
    stripe_session_id AS stripeSessionId,stripe_payment_intent_id AS stripePaymentIntentId,checkout_url AS checkoutUrl,checkout_expires_at AS checkoutExpiresAt,
    payment_attempts AS paymentAttempts,admin_notes AS adminNotes,approved_at AS approvedAt,paid_at AS paidAt,created_at AS createdAt,updated_at AS updatedAt
    FROM retail_orders WHERE id=?`).bind(id).first();
}

async function emailStatusUpdate(env, order, status, reason) {
  await env.DB.prepare("UPDATE retail_orders SET status=?,admin_notes=?,updated_at=? WHERE id=?")
    .bind(status, reason || null, now(), order.id).run();
  await env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)")
    .bind(order.id,"admin",status.toLowerCase(),JSON.stringify({ note: reason || "" }),now()).run();
  let emailStatus = "sent";
  try {
    const text = status === "CHANGES_REQUESTED"
      ? `SnapInk needs a small design update before approving order ${order.orderNumber}.\n\n${reason}\n\nPlease reply to this email so we can coordinate the requested change. No payment has been collected.`
      : `We are unable to proceed with custom order ${order.orderNumber}.\n\n${reason}\n\nNo payment was collected. Reply to this email if you have questions.`;
    await sendSnapInkEmail(env,{ to: order.customerEmail, subject: status === "CHANGES_REQUESTED" ? `Update needed for SnapInk order ${order.orderNumber}` : `Update about SnapInk order ${order.orderNumber}`, text });
  } catch (error) {
    emailStatus = "failed";
    console.error("Retail order review email failed",{ orderNumber:order.orderNumber,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error" });
  }
  await env.DB.prepare("UPDATE retail_orders SET customer_email_status=?,updated_at=? WHERE id=?").bind(emailStatus,now(),order.id).run();
  return emailStatus;
}

async function sendPaymentLinkEmail(env, order, { claim = true } = {}) {
  if (!order.checkoutUrl) return { sent: false, error: "No secure payment session is saved for this order." };
  if (claim) {
    const claimed = await env.DB.prepare(`UPDATE retail_orders SET payment_email_status='sending',updated_at=?
      WHERE id=? AND status='AWAITING_PAYMENT' AND payment_email_status IN ('pending','failed')`).bind(now(),order.id).run();
    if (!claimed.meta?.changes) return { sent: order.paymentEmailStatus === "sent", skipped: true };
  }
  const pricing = calculateRetailPricing(order.size,order.quantity);
  try {
    const draft = orderDraft(order);
    const attachments = await designAttachments(env, order);
    const attachmentNote = attachments.length ? "A copy of your design is attached as a PNG." : "Your design preview remains saved securely with your order.";
    await sendSnapInkEmail(env,{ to:order.customerEmail,subject:`Your SnapInk order ${order.orderNumber} is approved`,text:
      `Your SnapInk custom sleeve order has been approved for production. ${attachmentNote}\n\nOrder: ${order.orderNumber}\nStyle: ${order.variant}\nSize: ${order.size}\nQuantity: ${order.quantity}\n${designDescription(draft)}\nMerchandise subtotal: ${usd(pricing.merchandiseSubtotalCents)}\nQuantity discount: ${pricing.discountCents?`-${usd(pricing.discountCents)}`:"$0.00"}\nShipping: ${usd(pricing.shippingCents)}\nTotal before applicable taxes: ${usd(pricing.totalBeforeTaxCents)}\n\nComplete payment securely with Stripe: ${order.checkoutUrl}\n${stripeAutomaticTaxEnabled(env) ? "Stripe Checkout will calculate applicable sales tax from your shipping address." : "Taxes are not calculated in this checkout; the displayed total excludes any applicable taxes."} SnapInk does not receive or store your card details.`,attachments });
    await env.DB.prepare("UPDATE retail_orders SET payment_email_status='sent',updated_at=? WHERE id=? AND status='AWAITING_PAYMENT'").bind(now(),order.id).run();
    return { sent:true };
  } catch (error) {
    await env.DB.prepare("UPDATE retail_orders SET payment_email_status='failed',updated_at=? WHERE id=? AND status='AWAITING_PAYMENT'").bind(now(),order.id).run();
    console.error("Retail payment-link email failed",{orderNumber:order.orderNumber,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"});
    return { sent:false,error:"The order is approved and the secure checkout is saved, but the payment email could not be sent. Retry the email from the admin dashboard." };
  }
}

async function createCheckoutSession(env, order, attempt) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) throw new Error("Payment links are disabled until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are configured in Cloudflare Pages secrets.");
  if (env.RETAIL_PAYMENT_LINKS_ENABLED !== "true") throw new Error("Retail order payment links are not enabled yet.");
  const address = safeOrderJson(order.shippingAddressJson);
  const pricing = calculateRetailPricing(order.size,order.quantity);
  if (Number(order.unitPriceCents)!==pricing.unitPriceCents
    || Number(order.merchandiseSubtotalCents)!==pricing.merchandiseSubtotalCents
    || Number(order.discountCents)!==pricing.discountCents
    || Number(order.shippingCents)!==pricing.shippingCents
    || Number(order.totalBeforeTaxCents)!==pricing.totalBeforeTaxCents) {
    throw new Error("The saved order pricing does not match the current server price. Refresh the retail order and investigate before approval.");
  }
  const form = new URLSearchParams();
  form.set("mode","payment");
  setSnapInkCheckoutPaymentMethods(form);
  form.set("success_url",`${SITE}/customize.html?retailPayment=return&order=${encodeURIComponent(order.orderNumber)}`);
  form.set("cancel_url",`${SITE}/customize.html?retailPayment=cancelled&order=${encodeURIComponent(order.orderNumber)}`);
  form.set("customer_email",order.customerEmail);
  form.set("client_reference_id",order.orderNumber);
  form.set("metadata[order_id]",order.id);
  form.set("metadata[order_number]",order.orderNumber);
  form.set("payment_intent_data[metadata][order_id]",order.id);
  form.set("payment_intent_data[metadata][order_number]",order.orderNumber);
  const useAutomaticTax = stripeAutomaticTaxEnabled(env);
  if (useAutomaticTax) form.set("automatic_tax[enabled]","true");
  form.set("shipping_address_collection[allowed_countries][0]",address.country);
  form.set("line_items[0][quantity]","1");
  form.set("line_items[0][price_data][currency]","usd");
  form.set("line_items[0][price_data][unit_amount]",String(pricing.discountedMerchandiseCents));
  if (useAutomaticTax) form.set("line_items[0][price_data][tax_behavior]","exclusive");
  form.set("line_items[0][price_data][product_data][name]",`SnapInk ${order.variant} Sleeve · Size ${order.size} · ${order.quantity} sleeve${order.quantity===1?"":"s"}`);
  if (pricing.shippingCents > 0) {
    form.set("shipping_options[0][shipping_rate_data][type]","fixed_amount");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]",String(pricing.shippingCents));
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]","usd");
    form.set("shipping_options[0][shipping_rate_data][display_name]","Flat-rate shipping");
    if (useAutomaticTax) form.set("shipping_options[0][shipping_rate_data][tax_behavior]","exclusive");
  }
  let response;
  try {
    response=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`snapink-retail-${order.id}-payment-${attempt}`},body:form.toString()});
  } catch { throw new Error("Stripe could not be reached. The order remains pending review; retry approval after checking Stripe availability."); }
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result?.id||!result?.url||result.currency!=="usd") {
    const code=result?.error?.code?` (${result.error.code})`:"";
    console.error("Stripe Checkout session creation failed",{orderNumber:order.orderNumber,status:response.status,code:result?.error?.code||"unknown"});
    throw new Error(`Stripe did not create a checkout session${code}. Confirm the Stripe API key and Checkout settings, then retry.`);
  }
  const tax = stripeSessionTax(result, useAutomaticTax);
  if(!tax||result.amount_subtotal!==pricing.discountedMerchandiseCents
    || Number(result.total_details?.amount_shipping||0)!==pricing.shippingCents
    || Number(result.amount_total||0)!==pricing.totalBeforeTaxCents+tax.taxCents) {
    throw new Error("Stripe returned a checkout breakdown that does not match the approved order total. No payment link was saved.");
  }
  return result;
}

export async function onRequestGet({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN)) return json({error:"Unauthorized"},401);
  if(!env.DB) return json({error:"Retail order storage is unavailable."},503);
  try {
    const url=new URL(request.url),status=url.searchParams.get("status")||"",q=(url.searchParams.get("q")||"").trim().slice(0,120);
    if(status&&!STATUSES.includes(status)) return json({error:"Choose a valid retail order status."},400);
    const result=await env.DB.prepare(`SELECT id,order_number AS orderNumber,status,customer_name AS customerName,customer_email AS customerEmail,customer_phone AS customerPhone,
      shipping_address_json AS shippingAddressJson,quantity,variant,size,draft_json AS draftJson,artwork_key AS artworkKey,preview_key AS previewKey,source_artwork_key AS sourceArtworkKey,
      unit_price_cents AS unitPriceCents,merchandise_subtotal_cents AS merchandiseSubtotalCents,discount_cents AS discountCents,shipping_cents AS shippingCents,total_before_tax_cents AS totalBeforeTaxCents,
      tax_cents AS taxCents,total_paid_cents AS totalPaidCents,currency,owner_email_status AS ownerEmailStatus,customer_email_status AS customerEmailStatus,payment_email_status AS paymentEmailStatus,
      payment_confirmation_status AS paymentConfirmationStatus,owner_payment_notice_status AS ownerPaymentNoticeStatus,stripe_session_id AS stripeSessionId,stripe_payment_intent_id AS stripePaymentIntentId,checkout_url AS checkoutUrl,
      checkout_expires_at AS checkoutExpiresAt,payment_attempts AS paymentAttempts,admin_notes AS adminNotes,approved_at AS approvedAt,paid_at AS paidAt,created_at AS createdAt,updated_at AS updatedAt
      FROM retail_orders WHERE (?='' OR status=?) AND (?='' OR order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?) ORDER BY created_at DESC LIMIT 250`)
      .bind(status,status,q,`%${q}%`,`%${q}%`,`%${q}%`).all();
    return json({orders:(result.results||[]).map(rowOrder)});
  } catch(error) {
    console.error("Admin retail order list failed",error instanceof Error?error.message:"unknown");
    return json({error:"Retail order storage is not initialized. Apply the retail-order D1 migration."},503);
  }
}

export async function onRequestPatch({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN)) return json({error:"Unauthorized"},401);
  if(!env.DB) return json({error:"Retail order storage is unavailable."},503);
  try {
    const body=await request.json();
    if(typeof body.id!=="string"||!/^[a-f0-9]{32}$/.test(body.id)||typeof body.action!=="string") return json({error:"Choose a valid retail order action."},400);
    let order=await loadOrder(env.DB,body.id);
    if(!order) return json({error:"Retail order not found."},404);
    if(body.action==="approve") {
      if(order.status==="AWAITING_PAYMENT"&&order.checkoutUrl) return json({ok:true,orderNumber:order.orderNumber,status:order.status,checkoutUrl:order.checkoutUrl,existing:true});
      if(!["PENDING_REVIEW","CHANGES_REQUESTED","APPROVED"].includes(order.status)) return json({error:`This order cannot be approved from ${order.status}.`},409);
      const attempt=Number(order.paymentAttempts||0)+1;
      const session=await createCheckoutSession(env,order,attempt);
      const created=now();
      const updated=await env.DB.prepare(`UPDATE retail_orders SET status='AWAITING_PAYMENT',stripe_session_id=?,stripe_payment_intent_id=?,checkout_url=?,checkout_expires_at=?,payment_attempts=?,payment_email_status='pending',approved_at=?,updated_at=?
        WHERE id=? AND status=? AND payment_attempts=?`)
        .bind(session.id,typeof session.payment_intent==="string"?session.payment_intent:null,session.url,new Date(Number(session.expires_at)*1000).toISOString(),attempt,created,created,order.id,order.status,Number(order.paymentAttempts||0)).run();
      if(!updated.meta?.changes) {
        order=await loadOrder(env.DB,body.id);
        if(order?.status==="AWAITING_PAYMENT"&&order.checkoutUrl) return json({ok:true,orderNumber:order.orderNumber,status:order.status,checkoutUrl:order.checkoutUrl,existing:true});
        return json({error:"Order changed during approval. Refresh the retail order list and retry."},409);
      }
      await env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)")
        .bind(order.id,"admin","approved_for_production",JSON.stringify({stripeSessionId:session.id,totalBeforeTaxCents:calculateRetailPricing(order.size,order.quantity).totalBeforeTaxCents}),created).run();
      order=await loadOrder(env.DB,body.id);
      const emailed=await sendPaymentLinkEmail(env,order);
      return json({ok:true,orderNumber:order.orderNumber,status:order.status,checkoutUrl:order.checkoutUrl,emailStatus:emailed.sent?"sent":"failed",warning:emailed.error||null});
    }
    if(body.action==="request_changes"||body.action==="decline") {
      if(!["PENDING_REVIEW","CHANGES_REQUESTED"].includes(order.status)) return json({error:`This order cannot be updated from ${order.status}.`},409);
      const note=typeof body.note==="string"?body.note.trim().slice(0,1000):"";
      if(!note) return json({error:"Add a brief note explaining the requested changes or decline."},400);
      const status=body.action==="request_changes"?"CHANGES_REQUESTED":"DECLINED";
      const emailStatus=await emailStatusUpdate(env,order,status,note);
      return json({ok:true,orderNumber:order.orderNumber,status,emailStatus});
    }
    if(body.action==="resend_payment_email") {
      if(order.status!=="AWAITING_PAYMENT") return json({error:"A payment link can be emailed only for an order awaiting payment."},409);
      const sent=await sendPaymentLinkEmail(env,order);
      if(!sent.sent) return json({error:sent.error||"A payment email is already being sent."},sent.skipped?409:503);
      return json({ok:true,status:order.status,emailStatus:"sent"});
    }
    if(body.action==="resend_payment_notices") {
      if(!["PAID","IN_PRODUCTION","SHIPPED","COMPLETED"].includes(order.status)) return json({error:"Payment notices can be retried only after payment is confirmed."},409);
      const paid=await env.DB.prepare("SELECT tax_cents AS taxCents,total_paid_cents AS totalPaidCents FROM retail_orders WHERE id=?").bind(order.id).first();
      if(!paid?.totalPaidCents) return json({error:"Verified Stripe payment details are not available for this order."},409);
      const price=calculateRetailPricing(order.size,order.quantity);
      const summary=`Order ${order.orderNumber}\n${order.variant} sleeve · Size ${order.size} · Quantity ${order.quantity}\nMerchandise subtotal: ${usd(price.merchandiseSubtotalCents)}\nQuantity discount: ${price.discountCents?`-${usd(price.discountCents)}`:"$0.00"}\nShipping: ${usd(price.shippingCents)}\nTax: ${usd(paid.taxCents)}\nPaid total: ${usd(paid.totalPaidCents)}`;
      const results={owner:order.ownerPaymentNoticeStatus,customer:order.paymentConfirmationStatus};
      for(const recipient of ["owner","customer"]) {
        const column=recipient==="owner"?"owner_payment_notice_status":"payment_confirmation_status";
        if(results[recipient]==="sent") continue;
        const claim=await env.DB.prepare(`UPDATE retail_orders SET ${column}='sending',updated_at=? WHERE id=? AND status IN ('PAID','IN_PRODUCTION','SHIPPED','COMPLETED') AND ${column} IN ('pending','failed')`).bind(now(),order.id).run();
        if(!claim.meta?.changes) continue;
        try {
          await sendSnapInkEmail(env,{to:recipient==="owner"?"partners@snapbacksleeves.com":order.customerEmail,replyTo:recipient==="owner"?order.customerEmail:undefined,subject:recipient==="owner"?`Payment received for ${order.orderNumber}`:`Payment confirmed for SnapInk order ${order.orderNumber}`,text:`${recipient==="owner"?"Stripe confirmed payment for a retail order. It has not been automatically sent to production.":"Your payment was received. Thank you for your SnapInk order."}\n\n${summary}`});
          results[recipient]="sent";
        } catch(error) { results[recipient]="failed"; console.error("Retail payment notice retry failed",{orderNumber:order.orderNumber,recipient,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"}); }
        await env.DB.prepare(`UPDATE retail_orders SET ${column}=?,updated_at=? WHERE id=?`).bind(results[recipient],now(),order.id).run();
      }
      return json({ok:true,notifications:results});
    }
    if(body.action==="resend_order_emails") {
      if(!["PENDING_REVIEW","CHANGES_REQUESTED","DECLINED","APPROVED","AWAITING_PAYMENT"].includes(order.status)) return json({error:"Order notifications cannot be resent for this status."},409);
      const draft=orderDraft(order), address=orderShipping(order), price=calculateRetailPricing(order.size,order.quantity);
      const results={owner:order.ownerEmailStatus,customer:order.customerEmailStatus};
      for(const key of ["owner","customer"]) {
        if(results[key]==="sent") continue;
        const to=key==="owner"?"mikejstpierre@gmail.com":order.customerEmail;
        const summary=`Order ${order.orderNumber}\nSleeve: ${order.variant} · Size ${order.size}\nQuantity: ${order.quantity}\nMerchandise subtotal: ${usd(price.merchandiseSubtotalCents)}\nQuantity discount: ${price.discountCents?`-${usd(price.discountCents)}`:"$0.00"}\nShipping: ${usd(price.shippingCents)}\nTotal before applicable taxes: ${usd(price.totalBeforeTaxCents)}`;
        try { const customerNote=order.status==="DECLINED"?`We are unable to proceed with custom order ${order.orderNumber}.\n\n${order.adminNotes||"Please contact SnapInk if you have questions."}\n\nNo payment was collected.`:order.status==="CHANGES_REQUESTED"?`SnapInk needs a small design update before approving order ${order.orderNumber}.\n\n${order.adminNotes||"Please reply to coordinate the requested change."}\n\nNo payment has been collected.`:"Thanks for your SnapInk order request. We will email your secure payment link after production review. No payment has been collected."; const attachments=await designAttachments(env,order); const attachmentNote=attachments.length?"A copy of the submitted design is attached as a PNG.":"The design preview remains saved securely with the order."; await sendSnapInkEmail(env,{to,replyTo:key==="owner"?order.customerEmail:undefined,subject:`SnapInk order ${order.orderNumber} update`,text:`${key==="owner"?"A retail order is ready for review in the admin dashboard: "+SITE+"/admin.html\n\n":customerNote+"\n\n"}${summary}\n\nCustomer: ${order.customerName}\nShip to: ${address.line1}, ${address.city}, ${address.region} ${address.postalCode}, ${address.country}\nDesign: ${draft.text||"Uploaded artwork"}\n\n${attachmentNote}`,attachments});results[key]="sent"; }
        catch(error){results[key]="failed";console.error("Retail order notification retry failed",{orderNumber:order.orderNumber,type:key,error:error instanceof EmailDeliveryError?error.message:"Unexpected email error"});}
      }
      await env.DB.prepare("UPDATE retail_orders SET owner_email_status=?,customer_email_status=?,updated_at=? WHERE id=?").bind(results.owner,results.customer,now(),order.id).run();
      return json({ok:true,notifications:results});
    }
    if(body.action==="set_fulfillment_status") {
      const next=body.status;
      const allowed={PAID:["IN_PRODUCTION"],IN_PRODUCTION:["SHIPPED"],SHIPPED:["COMPLETED"]};
      if(!allowed[order.status]?.includes(next)) return json({error:`Cannot move this order from ${order.status} to ${String(next)}.`},409);
      const time=now();
      const result=await env.DB.prepare("UPDATE retail_orders SET status=?,updated_at=? WHERE id=? AND status=?").bind(next,time,order.id,order.status).run();
      if(!result.meta?.changes) return json({error:"Order status changed elsewhere. Refresh and retry."},409);
      await env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(order.id,"admin","fulfillment_status_changed",JSON.stringify({from:order.status,to:next}),time).run();
      return json({ok:true,status:next});
    }
    return json({error:"Unsupported retail order action."},400);
  } catch(error) {
    console.error("Admin retail order action failed",{message:error instanceof Error?error.message.slice(0,220):"unknown"});
    return json({error:error instanceof Error?error.message:"Unable to complete the retail order action."},503);
  }
}
