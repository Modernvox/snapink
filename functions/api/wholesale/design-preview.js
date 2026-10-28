import { json } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private design storage is unavailable." }, 503);
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{8,100}$/.test(id)) return json({ error: "Design reference is invalid." }, 400);
  try {
    const design = await env.DB.prepare("SELECT preview_key AS previewKey,preview_sha256 AS previewSha256 FROM wholesale_designs WHERE partner_id=? AND id=?").bind(partner.id,id).first();
    if (!design) return json({ error: "Saved design not found." }, 404);
    const object = await env.PRIVATE_ASSETS.get(design.previewKey);
    if (!object) return json({ error: "Saved preview is unavailable." }, 404);
    const headers = new Headers({ "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
    return new Response(object.body,{headers});
  } catch { return json({ error: "Could not retrieve the private design preview." }, 503); }
}
