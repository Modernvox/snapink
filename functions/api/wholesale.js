import { json } from "../_lib/orders.js";
import { APPROVED_WHOLESALE_DESIGNS, CUSTOM_WHOLESALE_PRICE_TIERS, WHOLESALE_LEAD_TIMES, WHOLESALE_PRICE_TIERS } from "../_lib/wholesale.js";
import { partnerUnauthorized, wholesalePartnerFor } from "../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  try {
    const colors = env.DB ? await env.DB.prepare(`SELECT id,manufacturer,official_color_name AS name,
      manufacturer_sku AS sku,preview_hex AS hex,material_type AS materialType,finish
      FROM wholesale_color_catalog WHERE availability_status='available' AND admin_enabled=1
      AND lower(material_type) LIKE '%tpu%' AND lower(finish)='matte' ORDER BY manufacturer,official_color_name`).all() : {results:[]};
    return json({ ok:true, partner, pricing:{ currency:"USD", minimumQuantity:50, customMinimumQuantity:20, tiers:WHOLESALE_PRICE_TIERS, blankTiers:WHOLESALE_PRICE_TIERS, customTiers:CUSTOM_WHOLESALE_PRICE_TIERS }, leadTimes:WHOLESALE_LEAD_TIMES, approvedDesigns:APPROVED_WHOLESALE_DESIGNS, colors:colors.results||[] });
  } catch (error) {
    console.error("Wholesale color catalog load failed",error instanceof Error?error.message:"unknown");
    return json({ error:"Wholesale catalog is unavailable. Apply migration 0008 before using color options." },503);
  }
}
