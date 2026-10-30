import test from "node:test";
import assert from "node:assert/strict";
import { calculateRetailPricing } from "../functions/_lib/retail-pricing.mjs";

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

test("invalid size and quantities are rejected", () => {
  for (const [size, quantity] of [[-1, 1], [6, 1], [0, 0], [0, 1.5], [0, 101]]) {
    assert.throws(() => calculateRetailPricing(size, quantity), RangeError);
  }
});
