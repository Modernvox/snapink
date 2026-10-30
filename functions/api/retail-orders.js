import { calculateRetailPricing, RETAIL_MAX_QUANTITY } from "../_lib/retail-pricing.mjs";
import { digest, json, now, randomId } from "../_lib/orders.js";
import { validDraft } from "../_lib/draft.js";
import { EmailDeliveryError, enforcePublicFormRateLimit, sendSnapInkEmail } from "../_lib/snapink-email.js";
import { cleanRetailCustomer, cleanShippingAddress, decodeRetailFiles, RetailOrderValidationError, sourceArtworkExtension } from "../_lib/retail-order-utils.js";

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const ADMIN_URL = "https://snapbacksleeves.com/admin.html";

function usd(cents) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }

function describeDesign(draft) { return `Design: ${draft.text?.trim() ? `“${draft.text.trim()}”` : draft.logoName ? `Uploaded artwork (${draft.logoName})` : "Custom sleeve colors / blank artwork"}` + `\nColors: sleeve ${draft.backgroundColor}, text ${draft.fill}, outline ${draft.stroke}`; }
async function notifyOrder(env, order, draft, address, price) {
  const summary = `Order ${order.orderNumber}\nSleeve: ${draft.variant} / Size ${draft.size}\n${describeDesign(draft)}\nQuantity: ${order.quantity}\nUnit price: ${usd(price.unitPriceCents)}\nMerchandise subtotal: ${usd(price.merchandiseSubtotalCents)}\nQuantity discount: ${price.discountCents ? `-${usd(price.discountCents)}` : "$0.00"}\nShipping: ${usd(price.shippingCents)}\nTotal before applicable taxes: ${usd(price.totalBeforeTaxCents)}\n\nName: ${order.customerName}\nEmail: ${order.customerEmail}\nPhone: ${order.customerPhone || "Not provided"}\nShip to: ${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.region} ${address.postalCode}, ${address.country}`;
  const results = { owner: "failed", customer: "failed" };
  try {
    await sendSnapInkEmail(env, { to: "partners@snapbacksleeves.com", replyTo: order.customerEmail, subject: `Retail custom order ${order.orderNumber} received`, text: `A new SnapInk retail order is waiting for production review.\n\n${summary}\n\nReview the design and order securely: ${ADMIN_URL}` });
    results.owner = "sent";
  } catch (error) {
    console.error("Retail order owner notification failed", { orderNumber: order.orderNumber, error: error instanceof EmailDeliveryError ? error.message : "Unexpected email error" });
  }
  try {
    await sendSnapInkEmail(env, { to: order.customerEmail, subject: `SnapInk order ${order.orderNumber} received`, text: `Thanks for designing with SnapInk. Your custom order request has been received and is pending production review. No payment has been collected.\n\n${summary}\n\nSnapInk will confirm the design can be produced and, once approved, email you a secure Stripe payment link. This amount is before any applicable taxes.` });
    results.customer = "sent";
  } catch (error) {
    console.error("Retail order customer confirmation failed", { orderNumber: order.orderNumber, error: error instanceof EmailDeliveryError ? error.message : "Unexpected email error" });
  }
  return results;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Custom order intake is temporarily unavailable." }, 503);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BYTES) return json({ error: "The design upload is too large. Please reduce the artwork file size." }, 413);
  let uploaded = [];
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) return json({ error: "The design upload is too large. Please reduce the artwork file size." }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: "Review the order form and try again." }, 400); }
    const customer = cleanRetailCustomer(data.customer);
    const shipping = cleanShippingAddress(data.shippingAddress);
    const quantity = Number(data.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY) return json({ error: `Quantity must be between 1 and ${RETAIL_MAX_QUANTITY}.` }, 400);
    if (typeof data.idempotencyKey !== "string" || !/^[\w-]{16,80}$/.test(data.idempotencyKey)) return json({ error: "Refresh the page and submit your order again." }, 400);
    const draft = data.draft;
    if (!draft || !["standard", "billboard"].includes(draft.variant) || !Number.isInteger(draft.size) || draft.size < 0 || draft.size > 5 || !validDraft(draft)) return json({ error: "Choose a valid sleeve style and size, then review your design." }, 400);
    const price = calculateRetailPricing(draft.size, quantity);

    const existing = await env.DB.prepare(`SELECT id,order_number AS orderNumber,status,quantity,variant,size,unit_price_cents AS unitPriceCents,merchandise_subtotal_cents AS merchandiseSubtotalCents,
      discount_cents AS discountCents,shipping_cents AS shippingCents,total_before_tax_cents AS totalBeforeTaxCents,owner_email_status AS ownerEmailStatus,customer_email_status AS customerEmailStatus
      FROM retail_orders WHERE idempotency_key=?`).bind(data.idempotencyKey).first();
    if (existing) return json({ ok: true, duplicate: true, order: { ...existing, ...calculateRetailPricing(existing.size, existing.quantity) } }, 200);
    if (!(await enforcePublicFormRateLimit(env.DB, request, env.CLOUDFLARE_EMAIL_API_TOKEN || env.ADMIN_REVIEW_TOKEN || "snapink-retail-order-rate-limit", "retail-order", 5))) {
      return json({ error: "Too many order attempts from this connection. Please wait and try again." }, 429);
    }
    const { artwork, preview, source } = decodeRetailFiles(data.files || {});
    const id = randomId(16);
    const createdAt = now();
    const orderNumber = `SI-${createdAt.slice(0,10).replaceAll("-","")}-${randomId(4).slice(0,8).toUpperCase()}`;
    const artworkKey = `retail-orders/${id}/artwork.svg`;
    const previewKey = `retail-orders/${id}/preview.png`;
    const sourceArtworkKey = source ? `retail-orders/${id}/source-artwork.${sourceArtworkExtension(source)}` : null;
    const puts = await Promise.allSettled([
      env.PRIVATE_ASSETS.put(artworkKey, artwork.bytes, { httpMetadata: { contentType: artwork.mime } }),
      env.PRIVATE_ASSETS.put(previewKey, preview.bytes, { httpMetadata: { contentType: preview.mime } }),
      ...(source ? [env.PRIVATE_ASSETS.put(sourceArtworkKey, source.bytes, { httpMetadata: { contentType: source.mime } })] : []),
    ]);
    uploaded = [artworkKey, previewKey, ...(sourceArtworkKey ? [sourceArtworkKey] : [])];
    const failedPut = puts.find((put) => put.status === "rejected");
    if (failedPut) throw failedPut.reason;

    const draftJson = JSON.stringify({ ...draft, submittedAt: createdAt, shippingAddress: shipping, pricing: price });
    const insert = env.DB.prepare(`INSERT INTO retail_orders
      (id,order_number,idempotency_key,customer_name,customer_email,customer_phone,shipping_address_json,quantity,variant,size,status,draft_json,
       artwork_key,artwork_sha256,preview_key,preview_sha256,source_artwork_key,source_artwork_sha256,unit_price_cents,merchandise_subtotal_cents,discount_cents,shipping_cents,total_before_tax_cents,currency,owner_email_status,customer_email_status,payment_email_status,payment_confirmation_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING_REVIEW',?,?,?,?,?,?,?,?,?,?,?,?,'usd','pending','pending','pending','pending',?,?)`)
      .bind(id,orderNumber,data.idempotencyKey,customer.name,customer.email,customer.phone,JSON.stringify(shipping),quantity,draft.variant,draft.size,draftJson,
        artworkKey,await digest(artwork.bytes),previewKey,await digest(preview.bytes),sourceArtworkKey,source ? await digest(source.bytes) : null,
        price.unitPriceCents,price.merchandiseSubtotalCents,price.discountCents,price.shippingCents,price.totalBeforeTaxCents,createdAt,createdAt);
    const event = env.DB.prepare("INSERT INTO retail_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)")
      .bind(id,"customer","order_submitted",JSON.stringify({ quantity, variant: draft.variant, size: draft.size, totalBeforeTaxCents: price.totalBeforeTaxCents }),createdAt);
    try { await env.DB.batch([insert,event]); }
    catch (error) {
      const duplicate = await env.DB.prepare("SELECT id,order_number AS orderNumber,status,quantity,variant,size,unit_price_cents AS unitPriceCents,merchandise_subtotal_cents AS merchandiseSubtotalCents,discount_cents AS discountCents,shipping_cents AS shippingCents,total_before_tax_cents AS totalBeforeTaxCents,owner_email_status AS ownerEmailStatus,customer_email_status AS customerEmailStatus FROM retail_orders WHERE idempotency_key=?").bind(data.idempotencyKey).first();
      if (duplicate) { await Promise.allSettled(uploaded.map((key) => env.PRIVATE_ASSETS.delete(key))); uploaded=[]; return json({ ok: true, duplicate: true, order: { ...duplicate, ...calculateRetailPricing(duplicate.size, duplicate.quantity) } }, 200); }
      throw error;
    }
    const order = { id, orderNumber, customerName: customer.name, customerEmail: customer.email, customerPhone: customer.phone, quantity };
    const notifications = await notifyOrder(env, order, draft, shipping, price);
    await env.DB.prepare("UPDATE retail_orders SET owner_email_status=?,customer_email_status=?,updated_at=? WHERE id=?")
      .bind(notifications.owner,notifications.customer,now(),id).run();
    uploaded=[];
    return json({ ok: true, order: { id, orderNumber, status: "PENDING_REVIEW", quantity, variant: draft.variant, size: draft.size, ...price, notifications } }, 201);
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => env.PRIVATE_ASSETS.delete(key)));
    if (error instanceof RetailOrderValidationError || error instanceof RangeError) return json({ error: error.message }, 400);
    if (error instanceof Error && /no such table:\s*retail_(orders|order_events)/i.test(error.message)) {
      console.error("Retail order intake is unavailable because its D1 migration has not been applied.");
      return json({ error: "Retail custom orders are not enabled yet. Please contact SnapInk while the order system is being configured." }, 503);
    }
    console.error("Retail order submission failed", { message: error instanceof Error ? error.message.slice(0,180) : "unknown" });
    return json({ error: "We could not save the order request. Please try again." }, 500);
  }
}
