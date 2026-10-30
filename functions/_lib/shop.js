import { json } from "./orders.js";

export function parseShopJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function readShopProducts(db, { includeInactive = false } = {}) {
  const rows = await db.prepare(`SELECT product_id AS productId,slug,name,description,image_url AS imageUrl,image_alt AS imageAlt,prices_json AS pricesJson,active
    FROM shop_products ${includeInactive ? "" : "WHERE active=1"} ORDER BY name`).all();
  const products = [];
  for (const row of rows.results || []) {
    const prices = parseShopJson(row.pricesJson, null);
    if (!Array.isArray(prices) || prices.length !== 6 || prices.some((price) => !Number.isSafeInteger(price) || price < 1)) continue;
    const variantsResult = await db.prepare(`SELECT variant_id AS variantId,variant_name AS name,sleeve_color AS sleeveColor,artwork_color AS artworkColor,available_sizes_json AS availableSizesJson,active
      FROM shop_product_variants WHERE product_id=? ${includeInactive ? "" : "AND active=1"} ORDER BY variant_id`).bind(row.productId).all();
    const variants = [];
    for (const variant of variantsResult.results || []) {
      const sizes = parseShopJson(variant.availableSizesJson, []);
      const inventoryResult = await db.prepare("SELECT size,available_quantity AS availableQuantity,reserved_quantity AS reservedQuantity FROM shop_inventory WHERE product_id=? AND variant_id=?").bind(row.productId,variant.variantId).all();
      const inventory = new Map((inventoryResult.results || []).map((entry) => [Number(entry.size), Math.max(0,Number(entry.availableQuantity)-Number(entry.reservedQuantity))]));
      const configuredSizes = (Array.isArray(sizes) ? sizes : []).filter((size) => Number.isInteger(size) && size >= 0 && size <= 5);
      const availableSizes = includeInactive ? configuredSizes : configuredSizes.filter((size) => !inventory.has(size) || inventory.get(size) > 0);
      variants.push({ variantId:variant.variantId,name:variant.name,sleeveColor:variant.sleeveColor,artworkColor:variant.artworkColor,active:Boolean(variant.active),availableSizes,inventory:inventoryResult.results || [] });
    }
    products.push({productId:row.productId,slug:row.slug,name:row.name,description:row.description,imageUrl:row.imageUrl,imageAlt:row.imageAlt,prices,active:Boolean(row.active),variants});
  }
  return products;
}

export function publicShopProduct(product) {
  return {...product,variants:product.variants.filter((variant) => variant.active && variant.availableSizes.length).map(({inventory,...variant})=>variant)};
}

export function checkoutUnavailable(env) {
  if (env.SHOP_ORDERS_ENABLED !== "true") return "Shop checkout is not enabled yet.";
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return "Secure checkout is being configured. Please try again later.";
  if (env.STRIPE_AUTOMATIC_TAX_ENABLED !== "true") return "Secure checkout is unavailable until sales-tax settings are verified.";
  return null;
}

export function checkShopRequest(request, env, dbRequired = true) {
  if (dbRequired && !env.DB) return json({error:"Shop catalog and order storage are unavailable."},503);
  if (!env.PRIVATE_ASSETS) return json({error:"Private order storage is unavailable."},503);
  return null;
}
