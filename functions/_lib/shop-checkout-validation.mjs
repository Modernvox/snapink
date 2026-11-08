export const SHOP_SIZE_IDS = [0, 1, 2, 3, 4, 5];

export function shopCheckoutProductError(product, { requireEverySize = false } = {}) {
  if (!product || typeof product.productId !== "string" || !product.productId.trim()) return "A catalog product ID is required.";
  if (product.active !== true) return "The product must be active before it can be purchased.";
  if (!Array.isArray(product.prices) || product.prices.length !== SHOP_SIZE_IDS.length || product.prices.some((price) => !Number.isSafeInteger(price) || price < 1)) return "Checkout requires a valid trusted price for every size from 0 through 5.";
  const variants = (Array.isArray(product.variants) ? product.variants : []).filter((variant) => variant?.active === true);
  if (!variants.length) return "At least one active product variant is required.";
  const sizes = new Set(variants.flatMap((variant) => Array.isArray(variant.availableSizes) ? variant.availableSizes : []));
  if (requireEverySize && SHOP_SIZE_IDS.some((size) => !sizes.has(size))) return "Studio products must publish all six checkout sizes, 0 through 5.";
  if (!requireEverySize && !SHOP_SIZE_IDS.some((size) => sizes.has(size))) return "At least one active size from 0 through 5 is required.";
  return "";
}
