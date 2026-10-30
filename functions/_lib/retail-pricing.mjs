export const RETAIL_MAX_QUANTITY = 100;
export const RETAIL_SHIPPING_CENTS = 399;
export const RETAIL_DISCOUNT_THRESHOLD = 10;
export const RETAIL_DISCOUNT_PERCENT = 10;
export const RETAIL_FREE_SHIPPING_THRESHOLD_CENTS = 3600;
export const SHOP_PRODUCT_CATALOG = Object.freeze({
  lift: Object.freeze({ slug: "lift", name: "LIFT", description: "A clean, raised LIFT statement for the back of your snapback.", image: "/images/product_images/lift_sleeve_on%20_snapback.png", alt: "Black snapback with a black SnapInk sleeve featuring raised white LIFT lettering", variants: Object.freeze([{ id: "black-white", name: "Black sleeve / white artwork", sleeveColor: "Black", artworkColor: "White" }]), prices: Object.freeze([1599,1599,1599,1599,1899,1899]) }),
  "three-star": Object.freeze({ slug: "three-star", name: "THREE STAR", description: "Three raised white stars in the approved SnapInk arrangement.", image: "/images/product_images/three_star_sleeve_on_snapback.png", alt: "Black snapback with a black SnapInk sleeve featuring three raised white stars", variants: Object.freeze([{ id: "black-white", name: "Black sleeve / white stars", sleeveColor: "Black", artworkColor: "White" }]), prices: Object.freeze([1599,1599,1599,1599,1899,1899]) }),
});

export function calculateShopCartPricing(items, products = SHOP_PRODUCT_CATALOG) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new RangeError("Cart must contain 1 to 50 product lines.");
  let quantity = 0;
  let merchandiseSubtotalCents = 0;
  const normalized = items.map((item) => {
    const product = products[item.productId];
    const size = Number(item.size), count = Number(item.quantity);
    if (!product || !Number.isInteger(size) || size < 0 || size > 5) throw new RangeError("Choose a valid exclusive product and size.");
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
