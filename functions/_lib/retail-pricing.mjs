export const RETAIL_MAX_QUANTITY = 100;
export const RETAIL_SHIPPING_CENTS = 399;
export const RETAIL_DISCOUNT_THRESHOLD = 10;
export const RETAIL_DISCOUNT_PERCENT = 10;
export const RETAIL_FREE_SHIPPING_THRESHOLD_CENTS = 3600;
export function calculateShopCartPricing(items, products) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new RangeError("Cart must contain 1 to 50 product lines.");
  if (!Array.isArray(products) && !(products instanceof Map) && (!products || typeof products !== "object")) throw new RangeError("The active Shop product catalog is unavailable.");
  let quantity = 0;
  let merchandiseSubtotalCents = 0;
  const normalized = items.map((item) => {
    const product = Array.isArray(products) ? products.find((entry) => entry?.productId === item.productId) : products instanceof Map ? products.get(item.productId) : Object.hasOwn(products,item.productId) ? products[item.productId] : null;
    const size = Number(item.size), count = Number(item.quantity);
    if (!product) throw new RangeError("This Shop product is not in the active catalog.");
    if (!Number.isInteger(size) || size < 0 || size > 5) throw new RangeError("Choose a valid Shop size from 0 through 5.");
    if (!Array.isArray(product.prices) || product.prices.length !== 6 || !Number.isSafeInteger(product.prices[size]) || product.prices[size] < 1) throw new RangeError("Trusted Shop pricing is unavailable for this product and size.");
    if (!Number.isInteger(count) || count < 1 || count > RETAIL_MAX_QUANTITY) throw new RangeError(`Quantity must be between 1 and ${RETAIL_MAX_QUANTITY} per line.`);
    quantity += count;
    const unitPriceCents = product.prices[size];
    const lineSubtotalCents = unitPriceCents * count;
    merchandiseSubtotalCents += lineSubtotalCents;
    return { productId: item.productId, variantId: item.variantId, size, quantity: count, unitPriceCents, lineSubtotalCents };
  });
  if (quantity > RETAIL_MAX_QUANTITY) throw new RangeError(`Combined cart quantity cannot exceed ${RETAIL_MAX_QUANTITY}.`);
  return { currency:"usd", quantity, items:normalized, ...calculateShopTotals(merchandiseSubtotalCents, quantity) };
}

export function calculateShopTotals(merchandiseSubtotalCents, quantity) {
  if (!Number.isSafeInteger(merchandiseSubtotalCents) || merchandiseSubtotalCents < 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY) throw new RangeError("Shop order totals are invalid.");
  const discountCents = quantity >= RETAIL_DISCOUNT_THRESHOLD ? Math.round(merchandiseSubtotalCents * RETAIL_DISCOUNT_PERCENT / 100) : 0;
  const discountedMerchandiseCents = merchandiseSubtotalCents - discountCents;
  const shippingCents = discountedMerchandiseCents > RETAIL_FREE_SHIPPING_THRESHOLD_CENTS ? 0 : RETAIL_SHIPPING_CENTS;
  return { merchandiseSubtotalCents, discountCents, discountedMerchandiseCents, shippingCents, totalBeforeTaxCents: discountedMerchandiseCents + shippingCents };
}

export function calculateRetailPricing(size, quantity, extendedArtwork = false) {
  if (!Number.isInteger(size) || size < 0 || size > 5) throw new RangeError("Choose a sleeve size from 0 to 5.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > RETAIL_MAX_QUANTITY) {
    throw new RangeError(`Quantity must be between 1 and ${RETAIL_MAX_QUANTITY}.`);
  }
  const unitPriceCents = extendedArtwork
    ? size <= 2 ? 2499 : 2999
    : size <= 3 ? 1599 : 1899;
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
