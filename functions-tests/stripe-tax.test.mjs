import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function loadFunction(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
}

const { stripeAutomaticTaxEnabled, stripeSessionTax } = await loadFunction("../functions/_lib/stripe-tax.js");
const { checkoutUnavailable } = await loadFunction("../functions/_lib/shop.js");
const { setSnapInkCheckoutPaymentMethods } = await loadFunction("../functions/_lib/stripe-payment-methods.js");

test("Stripe Tax disabled is valid for checkout when payment and shop gates are explicitly enabled", () => {
  assert.equal(stripeAutomaticTaxEnabled({ STRIPE_AUTOMATIC_TAX_ENABLED: "false" }), false);
  assert.equal(checkoutUnavailable({
    LIVE_CHECKOUT_ENABLED: "true",
    SHOP_ORDERS_ENABLED: "true",
    STRIPE_SECRET_KEY: "configured",
    STRIPE_WEBHOOK_SECRET: "configured",
    STRIPE_AUTOMATIC_TAX_ENABLED: "false",
  }), null);
});

test("live and public Shop checkout gates remain independently disabled", () => {
  const secrets = { STRIPE_SECRET_KEY: "configured", STRIPE_WEBHOOK_SECRET: "configured", STRIPE_AUTOMATIC_TAX_ENABLED: "false" };
  assert.equal(checkoutUnavailable({ ...secrets, SHOP_ORDERS_ENABLED: "false" }), "Shop checkout is not enabled yet.");
  assert.equal(checkoutUnavailable({ ...secrets, SHOP_ORDERS_ENABLED: "true" }), null);
});

test("SnapInk Checkout Sessions allow only card and Cash App Pay", () => {
  const form = new URLSearchParams();
  setSnapInkCheckoutPaymentMethods(form);
  assert.deepEqual([...form.entries()], [["allowed_payment_method_types[0]", "card"], ["allowed_payment_method_types[1]", "cashapp"]]);
});

test("no-tax Checkout Sessions reconcile only with zero tax", () => {
  assert.deepEqual(stripeSessionTax({ total_details: {}, automatic_tax: { enabled: false, status: null } }, false), { enabled: false, taxCents: 0 });
  assert.deepEqual(stripeSessionTax({ total_details: { amount_tax: 0 } }, false), { enabled: false, taxCents: 0 });
  assert.equal(stripeSessionTax({ total_details: { amount_tax: 25 }, automatic_tax: { enabled: false } }, false), null);
  assert.equal(stripeSessionTax({ total_details: {}, automatic_tax: { enabled: true, status: "failed" } }, true), null);
});

test("automatic-tax sessions require a completed Stripe tax calculation", () => {
  assert.deepEqual(stripeSessionTax({ total_details: { amount_tax: 87 }, automatic_tax: { enabled: true, status: "complete" } }, true), { enabled: true, taxCents: 87 });
  assert.equal(stripeSessionTax({ total_details: { amount_tax: 0 }, automatic_tax: { enabled: false } }, true), null);
});
