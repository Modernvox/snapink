import { json, now, randomId } from "../../_lib/orders.js";
import { cleanRetailCustomer, cleanShippingAddress } from "../../_lib/retail-order-utils.js";
import { calculateShopCartPricing, RETAIL_MAX_QUANTITY } from "../../_lib/retail-pricing.mjs";
import { EmailDeliveryError, enforcePublicFormRateLimit, sendSnapInkEmail } from "../../_lib/snapink-email.js";
import { readShopProducts, checkoutUnavailable } from "../../_lib/shop.js";

const SITE = "https://snapbacksleeves.com";
const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const validLine = (item) => item && typeof item.productId === "string" && typeof item.variantId === "string" && Number.isInteger(item.size) && Number.isInteger(item.quantity);

async function releaseReservations(db, items, time) {
  for (const item of items) await db.prepare("UPDATE shop_inventory SET reserved_quantity=MAX(0,reserved_quantity-?),updated_at=? WHERE product_id=? AND variant_id=? AND size=?")
    .bind(item.quantity, time, item.productId, item.variantId, item.size).run();
}

async function notifyOrder(env, order, items, shipping) {
  const lines = items.map((item) => `${item.quantity} x ${item.name} / ${item.variantName} / Size ${item.size} — ${usd(item.lineSubtotalCents)}`).join("\n");
  const summary = `Order ${order.orderNumber}\n${lines}\nMerchandise subtotal: ${usd(order.merchandiseSubtotalCents)}\nQuantity discount: ${order.discountCents ? `-${usd(order.discountCents)}` : "$0.00"}\nShipping: ${usd(order.shippingCents)}\nTax: calculated by Stripe at checkout\nTotal before tax: ${usd(order.totalBeforeTaxCents)}\n\nShip to: ${shipping.line1}${shipping.line2 ? `, ${shipping.line2}` : ""}, ${shipping.city}, ${shipping.region} ${shipping.postalCode}, ${shipping.country}`;
  const results = { customer: "failed", owner: "failed" };
  for (const recipient of ["customer", "owner"]) {
    const to = recipient === "customer" ? order.customerEmail : "mikejstpierre@gmail.com";
    try {
      await sendSnapInkEmail(env, { to, replyTo: recipient === "owner" ? order.customerEmail : undefined, subject: recipient === "customer" ? `SnapInk Shop order ${order.orderNumber}` : `New SnapInk Shop order ${order.orderNumber}`, text: `${recipient === "customer" ? "Thanks for your order. Stripe will email your payment confirmation after payment succeeds." : "An exclusive Shop order is awaiting payment/fulfillment in the admin dashboard."}\n\n${summary}\n\nSecure Stripe checkout: ${order.checkoutUrl}` });
      results[recipient] = "sent";
    } catch (error) {
      console.error("Exclusive shop order email failed", { orderNumber: order.orderNumber, recipient, error: error instanceof EmailDeliveryError ? error.message : "Unexpected email error" });
    }
  }
  try { await env.DB.prepare("UPDATE shop_orders SET customer_email_status=?,owner_email_status=?,updated_at=? WHERE id=?").bind(results.customer, results.owner, now(), order.id).run(); }
  catch (error) { console.error("Shop order email status could not be saved", { orderNumber: order.orderNumber, message: error instanceof Error ? error.message : "unknown" }); }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Shop ordering storage is unavailable." }, 503);
  const unavailable = checkoutUnavailable(env);
  if (unavailable) return json({ error: unavailable }, 503);
  let body;
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 128 * 1024) return json({ error: "The checkout request is too large." }, 413);
    body = await request.json();
    if (JSON.stringify(body).length > 128 * 1024) return json({ error: "The checkout request is too large." }, 413);
  } catch { return json({ error: "Enter your contact and shipping details, then try again." }, 400); }
  if (typeof body.idempotencyKey !== "string" || !/^[a-f0-9-]{16,64}$/i.test(body.idempotencyKey)) return json({ error: "Refresh the cart and try checkout again." }, 400);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50 || !body.items.every(validLine)) return json({ error: "Add a valid product, size, and quantity to the cart." }, 400);
  if (!(await enforcePublicFormRateLimit(env.DB, request, env.CLOUDFLARE_EMAIL_API_TOKEN || env.ADMIN_REVIEW_TOKEN || "snapink-shop-checkout-rate-limit", "shop-checkout", 12))) return json({ error: "Too many checkout attempts. Please wait before trying again." }, 429);
  let customer, shipping;
  try { customer = cleanRetailCustomer(body.customer); shipping = cleanShippingAddress(body.shippingAddress); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Check your checkout details." }, 400); }

  const time = now();
  let reserved = [];
  let createdOrderId = null;
  try {
    const duplicate = await env.DB.prepare("SELECT order_number AS orderNumber,status,checkout_url AS checkoutUrl FROM shop_orders WHERE idempotency_key=?").bind(body.idempotencyKey).first();
    if (duplicate) {
      if (duplicate.checkoutUrl && ["AWAITING_PAYMENT", "PAID"].includes(duplicate.status)) return json({ ok: true, duplicate: true, orderNumber: duplicate.orderNumber, checkoutUrl: duplicate.checkoutUrl });
      return json({ error: "This checkout is already being prepared. Refresh your cart in a moment." }, 409);
    }
    const products = await readShopProducts(env.DB);
    const productMap = Object.fromEntries(products.map((product) => [product.productId, product]));
    const normalizedMap = new Map();
    for (const line of body.items) {
      const product = products.find((entry) => entry.productId === line.productId && entry.active);
      const variant = product?.variants.find((entry) => entry.variantId === line.variantId && entry.active);
      if (!product || !variant || !variant.availableSizes.includes(line.size)) return json({ error: "One of the selected products, colors, or sizes is no longer available." }, 409);
      const key = `${line.productId}:${line.variantId}:${line.size}`;
      const existing = normalizedMap.get(key);
      if (existing) existing.quantity += line.quantity;
      else normalizedMap.set(key, { ...line, name: product.name, variantName: variant.name, imageUrl: variant.sleeveImageUrl, imageAlt: variant.sleeveImageAlt });
    }
    const normalized = [...normalizedMap.values()];
    if (normalized.reduce((sum, line) => sum + line.quantity, 0) > RETAIL_MAX_QUANTITY) return json({ error: `Combined cart quantity cannot exceed ${RETAIL_MAX_QUANTITY}.` }, 400);
    const pricing = calculateShopCartPricing(normalized, productMap);
    for (const line of pricing.items) {
      const update = await env.DB.prepare("UPDATE shop_inventory SET reserved_quantity=reserved_quantity+?,updated_at=? WHERE product_id=? AND variant_id=? AND size=? AND available_quantity-reserved_quantity>=?")
        .bind(line.quantity, time, line.productId, line.variantId, line.size, line.quantity).run();
      if (update.meta?.changes) { reserved.push(line); continue; }
      const inventory = await env.DB.prepare("SELECT size FROM shop_inventory WHERE product_id=? AND variant_id=? AND size=?").bind(line.productId, line.variantId, line.size).first();
      if (inventory) {
        await releaseReservations(env.DB, reserved, time);
        reserved = [];
        return json({ error: "A selected size has just sold out. Update your cart and try again." }, 409);
      }
    }

    const id = randomId(16);
    const orderNumber = `SI-SHOP-${time.slice(0, 10).replaceAll("-", "")}-${randomId(4).slice(0, 8).toUpperCase()}`;
    createdOrderId = id;
    const items = pricing.items.map((line, index) => ({ ...line, name: normalized[index].name, variantName: normalized[index].variantName, imageUrl: normalized[index].imageUrl, imageAlt: normalized[index].imageAlt }));
    const insert = await env.DB.prepare(`INSERT INTO shop_orders(id,order_number,idempotency_key,customer_name,customer_email,customer_phone,shipping_address_json,items_json,quantity,merchandise_subtotal_cents,discount_cents,shipping_cents,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'CHECKOUT_PENDING',?,?)`).bind(id, orderNumber, body.idempotencyKey, customer.name, customer.email, customer.phone, JSON.stringify(shipping), JSON.stringify(items), pricing.quantity, pricing.merchandiseSubtotalCents, pricing.discountCents, pricing.shippingCents, time, time).run();
    void insert;
    await env.DB.prepare("INSERT INTO shop_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(id, "customer", "checkout_started", JSON.stringify({ quantity: pricing.quantity, totalBeforeTaxCents: pricing.totalBeforeTaxCents }), time).run();

    let couponId = null;
    if (pricing.discountCents) {
      const couponForm = new URLSearchParams({ amount_off: String(pricing.discountCents), currency: "usd", duration: "once", name: `SnapInk ${orderNumber} quantity discount` });
      const couponResponse = await fetch("https://api.stripe.com/v1/coupons", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `snapink-shop-${id}-coupon` }, body: couponForm.toString() });
      const coupon = await couponResponse.json().catch(() => null);
      if (!couponResponse.ok || !coupon?.id) throw new Error("Stripe could not prepare the approved quantity discount.");
      couponId = coupon.id;
    }
    const customerForm = new URLSearchParams({ email: customer.email, name: customer.name, "shipping[name]": customer.name,
      "shipping[address][line1]": shipping.line1, "shipping[address][city]": shipping.city, "shipping[address][state]": shipping.region,
      "shipping[address][postal_code]": shipping.postalCode, "shipping[address][country]": shipping.country });
    if (customer.phone) customerForm.set("phone", customer.phone);
    if (shipping.line2) customerForm.set("shipping[address][line2]", shipping.line2);
    const customerResponse = await fetch("https://api.stripe.com/v1/customers", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `snapink-shop-${id}-customer` }, body: customerForm.toString() });
    const stripeCustomer = await customerResponse.json().catch(() => null);
    if (!customerResponse.ok || !stripeCustomer?.id) throw new Error("Stripe could not securely prepare the customer checkout profile.");
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${SITE}/shop/complete?order=${encodeURIComponent(orderNumber)}&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${SITE}/shop?checkout=cancelled&order=${encodeURIComponent(orderNumber)}`);
    form.set("customer", stripeCustomer.id);
    form.set("customer_update[shipping]", "auto");
    form.set("client_reference_id", orderNumber);
    form.set("metadata[shop_order_id]", id);
    form.set("metadata[order_number]", orderNumber);
    form.set("payment_intent_data[metadata][shop_order_id]", id);
    form.set("payment_intent_data[metadata][order_number]", orderNumber);
    form.set("automatic_tax[enabled]", "true");
    form.set("shipping_address_collection[allowed_countries][0]", shipping.country);
    pricing.items.forEach((line, index) => {
      const base = `line_items[${index}]`, item = items[index];
      form.set(`${base}[quantity]`, String(line.quantity));
      form.set(`${base}[price_data][currency]`, "usd");
      form.set(`${base}[price_data][unit_amount]`, String(line.unitPriceCents));
      form.set(`${base}[price_data][tax_behavior]`, "exclusive");
      form.set(`${base}[price_data][product_data][name]`, `SnapInk ${item.name} Sleeve · ${item.variantName} · Size ${line.size}`);
    });
    form.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(pricing.shippingCents));
    form.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
    form.set("shipping_options[0][shipping_rate_data][display_name]", "Standard shipping");
    form.set("shipping_options[0][shipping_rate_data][tax_behavior]", "exclusive");
    if (couponId) form.set("discounts[0][coupon]", couponId);
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `snapink-shop-${id}-checkout` }, body: form.toString() });
    const session = await response.json().catch(() => null);
    if (!response.ok || !session?.id || !session.url || session.currency !== "usd") throw new Error("Stripe did not create secure checkout. Your cart was not charged; retry checkout.");
    if (Number(session.amount_subtotal) !== pricing.merchandiseSubtotalCents || Number(session.total_details?.amount_discount || 0) !== pricing.discountCents || Number(session.total_details?.amount_shipping || 0) !== pricing.shippingCents) throw new Error("Stripe's checkout breakdown did not match the verified cart. No checkout link was returned.");
    const update = await env.DB.prepare("UPDATE shop_orders SET status='AWAITING_PAYMENT',stripe_session_id=?,checkout_url=?,updated_at=? WHERE id=? AND status='CHECKOUT_PENDING'").bind(session.id, session.url, now(), id).run();
    if (!update.meta?.changes) throw new Error("The order could not be saved for checkout. Contact SnapInk before retrying.");
    reserved = [];
    try { await env.DB.prepare("INSERT INTO shop_order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(id, "system", "checkout_created", JSON.stringify({ stripeSessionId: session.id }), now()).run(); }
    catch (error) { console.error("Shop checkout event could not be recorded", { orderNumber, message: error instanceof Error ? error.message : "unknown" }); }
    await notifyOrder(env, { id, orderNumber, customerEmail: customer.email, checkoutUrl: session.url, ...pricing }, items, shipping);
    return json({ ok: true, orderNumber, checkoutUrl: session.url, pricing: { ...pricing, items: undefined } }, 201);
  } catch (error) {
    if (reserved.length) await releaseReservations(env.DB, reserved, time).catch(() => {});
    if (createdOrderId) await env.DB.prepare("UPDATE shop_orders SET status='CANCELLED',updated_at=? WHERE id=? AND status='CHECKOUT_PENDING'").bind(now(), createdOrderId).run().catch(() => {});
    console.error("Exclusive shop checkout failed", { message: error instanceof Error ? error.message.slice(0, 180) : "unknown" });
    return json({ error: error instanceof Error ? error.message : "Secure checkout could not be created. Please try again." }, 503);
  }
}
