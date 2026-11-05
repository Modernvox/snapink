import { json } from "./orders.js";

export const DEFAULT_STANDARD_SHOP_PRICES = [1599,1599,1599,1599,1899,1899];
export const PREMIUM_EXTENDED_SHOP_PRICES = [2499,2499,2499,2999,2999,2999];

export async function readStandardShopPrices(db, excludeProductId = "") {
  const row = await db.prepare("SELECT prices_json AS pricesJson FROM shop_products WHERE artwork_tier='standard' AND product_id<>? ORDER BY active DESC,created_at LIMIT 1").bind(excludeProductId).first().catch(()=>null);
  const prices = parseShopJson(row?.pricesJson,DEFAULT_STANDARD_SHOP_PRICES);
  return Array.isArray(prices)&&prices.length===6&&prices.every((price)=>Number.isSafeInteger(price)&&price>0)?prices:DEFAULT_STANDARD_SHOP_PRICES;
}

export function parseShopJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function parseShopGallery(value) {
  let gallery = value;
  for (let depth = 0; depth < 2 && typeof gallery === "string"; depth++) {
    try { gallery = JSON.parse(gallery); } catch { return []; }
  }
  if (!Array.isArray(gallery)) return [];
  return gallery.filter((image) => image && typeof image === "object" && !Array.isArray(image) && typeof image.url === "string" && image.url.trim());
}

export async function readShopProducts(db, { includeInactive = false } = {}) {
  let rows;
  try {
    rows = await db.prepare(`SELECT product_id AS productId,slug,name,description,card_description AS cardDescription,image_url AS imageUrl,image_alt AS imageAlt,prices_json AS pricesJson,artwork_tier AS artworkTier,production_metadata_json AS productionMetadataJson,active
      FROM shop_products ${includeInactive ? "" : "WHERE active=1"} ORDER BY name`).all();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such column:\s*(?:card_description|artwork_tier|production_metadata_json)/i.test(message)) throw error;
    rows = await db.prepare(`SELECT product_id AS productId,slug,name,description,image_url AS imageUrl,image_alt AS imageAlt,prices_json AS pricesJson,active
      FROM shop_products ${includeInactive ? "" : "WHERE active=1"} ORDER BY name`).all();
  }
  const standardRow = (rows.results || []).find((row) => row.artworkTier === "standard");
  const standardPrices = parseShopJson(standardRow?.pricesJson, DEFAULT_STANDARD_SHOP_PRICES);
  const validStandardPrices = Array.isArray(standardPrices) && standardPrices.length === 6 && standardPrices.every((price) => Number.isSafeInteger(price) && price > 0) ? standardPrices : DEFAULT_STANDARD_SHOP_PRICES;
  const products = [];
  for (const row of rows.results || []) {
    const artworkTier = ["standard","premium","review"].includes(row.artworkTier) ? row.artworkTier : "review";
    const prices = artworkTier === "premium" ? PREMIUM_EXTENDED_SHOP_PRICES : artworkTier === "standard" ? parseShopJson(row.pricesJson, null) : validStandardPrices;
    if (!Array.isArray(prices) || prices.length !== 6 || prices.some((price) => !Number.isSafeInteger(price) || price < 1)) continue;
    const variantsResult = await db.prepare(`SELECT variant_id AS variantId,variant_name AS name,sleeve_color AS sleeveColor,artwork_color AS artworkColor,available_sizes_json AS availableSizesJson,sleeve_image_url AS sleeveImageUrl,sleeve_image_alt AS sleeveImageAlt,active
      FROM shop_product_variants WHERE product_id=? ${includeInactive ? "" : "AND active=1"} ORDER BY variant_id`).bind(row.productId).all();
    const variants = [];
    for (const variant of variantsResult.results || []) {
      const sizes = parseShopJson(variant.availableSizesJson, []);
      const inventoryResult = await db.prepare("SELECT size,available_quantity AS availableQuantity,reserved_quantity AS reservedQuantity FROM shop_inventory WHERE product_id=? AND variant_id=?").bind(row.productId,variant.variantId).all();
      const inventory = new Map((inventoryResult.results || []).map((entry) => [Number(entry.size), Math.max(0,Number(entry.availableQuantity)-Number(entry.reservedQuantity))]));
      const configuredSizes = (Array.isArray(sizes) ? sizes : []).filter((size) => Number.isInteger(size) && size >= 0 && size <= 5);
      const availableSizes = includeInactive ? configuredSizes : configuredSizes.filter((size) => !inventory.has(size) || inventory.get(size) > 0);
      variants.push({ variantId:variant.variantId,name:variant.name,sleeveColor:variant.sleeveColor,artworkColor:variant.artworkColor,sleeveImageUrl:variant.sleeveImageUrl,sleeveImageAlt:variant.sleeveImageAlt,active:Boolean(variant.active),availableSizes,inventory:inventoryResult.results || [] });
    }
    const galleryRow = await db.prepare("SELECT gallery_json AS galleryJson FROM shop_product_galleries WHERE product_id=?").bind(row.productId).first().catch(()=>null);
    products.push({productId:row.productId,slug:row.slug,name:row.name,description:row.description,cardDescription:row.cardDescription?.trim()||row.description,imageUrl:row.imageUrl,imageAlt:row.imageAlt,gallery:parseShopGallery(galleryRow?.galleryJson),prices,artworkTier,productionMetadata:parseShopJson(row.productionMetadataJson,{}),active:Boolean(row.active),variants});
  }
  return products;
}

// Product records retain complete production notes. This projection removes
// measurement-bearing clauses only when they are sent to public shop clients.
export function removeExtendedArtworkCopy(value) {
  return String(value || "").split(/(\r?\n)/).map((line) => {
    if (line === "\n" || line === "\r\n") return line;
    return line.split(/(?<=[.!?])(?=\s+)/).filter((sentence) => !/\bextended\s+artwork\b|\bpremium\s+(?:extended\s+)?design\s+pric|\bfinal\s+production\s+feasibility\b|\bsubject\s+to\s+production\s+review\b|\bproduction\s+approval\s+is\s+required\b/i.test(sentence)).join("");
  }).join("").trim();
}

export function customerShopDescription(value, artworkTier = "standard") {
  const source = artworkTier === "premium" ? String(value || "") : removeExtendedArtworkCopy(value);
  const withoutTechnicalMeasurements = source.split(/(\r?\n)/).map((line) => {
    if (line === "\n" || line === "\r\n") return line;
    return line.split(/(?<=[.!?])(?=\s+)/).filter((sentence) => {
      const technical = /\b(?:artwork|logo|design|graphic|extension|height\s*scale|scale|position|coordinates?|dimensions?)\b/i.test(sentence);
      const measurement = /\b\d+(?:\.\d+)?\s*(?:mm|millimeters?|cm|centimeters?|inches?|in\.?)(?![a-z])|\b\d+(?:\.\d+)?\s*%(?![a-z])/i.test(sentence)
        || /\b\d+(?:\.\d+)?\s*[×x]\s*\d+(?:\.\d+)?\b/i.test(sentence)
        || /\bposition\s*[XY]\s*[:=]?\s*-?\d/i.test(sentence)
        || /\b(?:top|bottom)\s+extension\b/i.test(sentence);
      return !(technical && measurement);
    }).join("");
  }).join("");
  return withoutTechnicalMeasurements.trim();
}

export function publicShopProduct(product) {
  const {productionMetadata,artworkTier,...publicProduct}=product;
  return {...publicProduct,description:customerShopDescription(product.description,product.artworkTier),cardDescription:customerShopDescription(product.cardDescription,product.artworkTier),variants:product.variants.filter((variant) => variant.active && variant.availableSizes.length).map(({inventory,...variant})=>variant)};
}

export function checkoutUnavailable(env) {
  if (env.SHOP_ORDERS_ENABLED !== "true") return "Shop checkout is not enabled yet.";
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return "Secure checkout is being configured. Please try again later.";
  return null;
}

export function checkShopRequest(request, env, dbRequired = true) {
  if (dbRequired && !env.DB) return json({error:"Shop catalog and order storage are unavailable."},503);
  if (!env.PRIVATE_ASSETS) return json({error:"Private order storage is unavailable."},503);
  return null;
}
