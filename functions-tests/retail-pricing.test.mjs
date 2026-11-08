import test from "node:test";
import assert from "node:assert/strict";
import { calculateRetailPricing, calculateShopCartPricing } from "../functions/_lib/retail-pricing.mjs";
import { SHOP_SIZE_IDS, shopCheckoutProductError } from "../functions/_lib/shop-checkout-validation.mjs";

test("retail price and flat shipping for sizes 0 through 3", () => {
  for (let size = 0; size <= 3; size++) {
    assert.deepEqual(calculateRetailPricing(size, 1), {
      currency: "usd", unitPriceCents: 1599, merchandiseSubtotalCents: 1599, discountCents: 0,
      discountedMerchandiseCents: 1599, shippingCents: 399, totalBeforeTaxCents: 1998,
    });
  }
});

test("sizes 4 and 5 use the premium price", () => {
  for (let size = 4; size <= 5; size++) {
    const result = calculateRetailPricing(size, 1);
    assert.equal(result.unitPriceCents, 1899);
    assert.equal(result.shippingCents, 399);
    assert.equal(result.totalBeforeTaxCents, 2298);
  }
});

test("10 percent quantity discount applies at ten and discounted merchandise determines free shipping", () => {
  const discounted = calculateRetailPricing(0, 10);
  assert.equal(discounted.merchandiseSubtotalCents, 15990);
  assert.equal(discounted.discountCents, 1599);
  assert.equal(discounted.discountedMerchandiseCents, 14391);
  assert.equal(discounted.shippingCents, 0);
  assert.equal(discounted.totalBeforeTaxCents, 14391);
});

test("free shipping applies only when discounted merchandise is strictly over $36", () => {
  assert.equal(calculateRetailPricing(4, 2).discountedMerchandiseCents, 3798);
  assert.equal(calculateRetailPricing(4, 2).shippingCents, 0);
  assert.equal(calculateRetailPricing(0, 2).discountedMerchandiseCents, 3198);
  assert.equal(calculateRetailPricing(0, 2).shippingCents, 399);
});

test("exclusive shop uses approved size prices and calculates mixed-product discounts", () => {
  const products={lift:{prices:[1599,1599,1599,1599,1899,1899]},"three-star":{prices:[1599,1599,1599,1599,1899,1899]}};
  const cart = calculateShopCartPricing([
    { productId:"lift", variantId:"black-white", size:0, quantity:5 },
    { productId:"three-star", variantId:"black-white", size:4, quantity:5 },
  ],products);
  assert.equal(cart.quantity,10);
  assert.equal(cart.merchandiseSubtotalCents,5*1599+5*1899);
  assert.equal(cart.discountCents,Math.round((5*1599+5*1899)*0.1));
  assert.equal(cart.shippingCents,0);
  assert.equal(calculateShopCartPricing([{productId:"lift",variantId:"black-white",size:4,quantity:1}],products).items[0].unitPriceCents,1899);
});

test("active D1 catalog maps Studio product IDs and preserves approved premium prices for sizes 0 through 5", () => {
  const products = new Map([
    ["studio-apex-uuid", { productId:"studio-apex-uuid", artworkTier:"standard", prices:[1599,1599,1599,1599,1899,1899] }],
    ["studio-premium-uuid", { productId:"studio-premium-uuid", artworkTier:"premium", prices:[2499,2499,2499,2999,2999,2999] }],
  ]);
  for (let size = 0; size <= 5; size++) {
    assert.equal(calculateShopCartPricing([{productId:"studio-apex-uuid",variantId:"studio",size,quantity:1}],products).items[0].unitPriceCents, size <= 3 ? 1599 : 1899);
    assert.equal(calculateShopCartPricing([{productId:"studio-premium-uuid",variantId:"studio",size,quantity:1}],products).items[0].unitPriceCents, size <= 2 ? 2499 : 2999);
  }
});

test("Studio-published Standard and Billboard products meet the shared checkout contract", () => {
  const product = {
    productId: "studio-angel-uuid", active: true, artworkTier: "standard",
    prices: [1599,1599,1599,1599,1899,1899],
    variants: [{ variantId: "studio", active: true, availableSizes: SHOP_SIZE_IDS }],
  };
  assert.equal(shopCheckoutProductError(product, { requireEverySize: true }), "");
  for (const size of SHOP_SIZE_IDS) {
    assert.equal(calculateShopCartPricing([{ productId: product.productId, variantId: "studio", size, quantity: 1 }], new Map([[product.productId, product]])).items[0].size, size);
  }
});

test("Studio publication readiness rejects missing trusted prices, sizes, or inactive products", () => {
  const base = { productId: "studio-test", active: true, prices: [1599,1599,1599,1599,1899,1899], variants: [{ variantId: "studio", active: true, availableSizes: SHOP_SIZE_IDS }] };
  assert.match(shopCheckoutProductError({ ...base, prices: [1599] }, { requireEverySize: true }), /valid trusted price/);
  assert.match(shopCheckoutProductError({ ...base, variants: [{ ...base.variants[0], availableSizes: [0,1,2,3,4] }] }, { requireEverySize: true }), /all six checkout sizes/);
  assert.match(shopCheckoutProductError({ ...base, active: false }), /must be active/);
});

test("shop shipping threshold is checked after the mixed-cart discount and is strictly over $36", () => {
  const products={a:{prices:[400,400,400,400,400,400]},b:{prices:[400,400,400,400,400,400]}};
  const exactly36=calculateShopCartPricing([{productId:"a",size:0,quantity:5},{productId:"b",size:0,quantity:5}],products);
  assert.equal(exactly36.discountedMerchandiseCents,3600);
  assert.equal(exactly36.shippingCents,399);
  const above36=calculateShopCartPricing([{productId:"a",size:0,quantity:6},{productId:"b",size:0,quantity:4}],{a:{prices:[410,410,410,410,410,410]},b:{prices:[410,410,410,410,410,410]}});
  assert.ok(above36.discountedMerchandiseCents>3600);
  assert.equal(above36.shippingCents,0);
});

test("invalid size and quantities are rejected", () => {
  for (const [size, quantity] of [[-1, 1], [6, 1], [0, 0], [0, 1.5], [0, 101]]) {
    assert.throws(() => calculateRetailPricing(size, quantity), RangeError);
  }
});
