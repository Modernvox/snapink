import { json } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB) return json({ error: "Wholesale color catalog is unavailable." }, 503);
  try {
    const { results } = await env.DB.prepare(`SELECT id,manufacturer,official_color_name AS name,
      manufacturer_sku AS sku,preview_hex AS hex,material_type AS materialType,finish
      FROM wholesale_color_catalog WHERE availability_status='available' AND admin_enabled=1
      AND lower(material_type) LIKE '%tpu%' AND lower(finish)='matte' ORDER BY manufacturer,official_color_name`).all();
    return json({ colors: results || [] });
  } catch (error) {
    console.error("Wholesale color catalog read failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Wholesale color catalog is unavailable. Apply database migration 0008 first." }, 503);
  }
}
