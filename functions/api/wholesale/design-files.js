import { json } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private design files are unavailable." }, 503);
  const url = new URL(request.url), id = url.searchParams.get("id"), kind = url.searchParams.get("kind");
  if (!id || !["source", "svg"].includes(kind)) return json({ error: "Choose a saved design file." }, 400);
  try {
    const row = await env.DB.prepare(`SELECT ${kind === "source" ? "source_artwork_key" : "artwork_svg_key"} AS objectKey
      FROM wholesale_designs WHERE partner_id=? AND id=?`).bind(partner.id,id).first();
    if (!row?.objectKey) return json({ error: "Saved design file not found." },404);
    const object = await env.PRIVATE_ASSETS.get(row.objectKey);
    if (!object) return json({ error: "Saved design file is unavailable." },404);
    const mime = object.httpMetadata?.contentType || (kind === "svg" ? "image/svg+xml" : "application/octet-stream");
    return new Response(object.body,{headers:{"Content-Type":mime,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"attachment"}});
  } catch { return json({ error: "Could not retrieve the saved private file." },503); }
}
