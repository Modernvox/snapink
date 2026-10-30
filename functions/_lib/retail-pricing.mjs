export const RETAIL_MAX_QUANTITY = 100;
export const RETAIL_SHIPPING_CENTS = 399;
export const RETAIL_DISCOUNT_THRESHOLD = 10;
export const RETAIL_DISCOUNT_PERCENT = 10;
export const RETAIL_FREE_SHIPPING_THRESHOLD_CENTS = 3600;

export function calculateRetailPricing(size, quantity) {
  if (!Number.isInteger(size) || size < 0 || size > 5) throw new RangeError("Choose a sleeve size from 0 to 5.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY) {
    throw new RangeError(`Quantity must be between 1 and ${RETAIL_MAX_QUANTITY}.`);
  }
  const unitPriceCents = size <= 3 ? 1599 : 1899;
  const merchandiseSubtotalCents = unitPriceCents * quantity;
  const discountCents = quantity >= RETAIL_DISCOUNT_THRESHOLD
    ? Math.round((merchandiseSubtotalCents * RETAIL_DISCOUNT_PERCENT) / 100)
    : 0;
  const discountedMerchandiseCents = merchandiseSubtotalCents - discountCents;
  const shippingCents = discountedMerchandiseCents > RETAIL_FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : RETAIL_SHIPPING_CENTS;
  return {
    currency: "usd",
    unitPriceCents,
    merchandiseSubtotalCents,
    discountCents,
    discountedMerchandiseCents,
    shippingCents,
    totalBeforeTaxCents: discountedMerchandiseCents + shippingCents,
  };
}
