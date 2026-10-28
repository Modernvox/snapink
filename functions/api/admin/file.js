import { bearer, json } from "../../_lib/orders.js";

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private artwork storage is unavailable." }, 503);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  if (!id || !["artwork", "preview", "source"].includes(kind)) return json({ error: "Provide an order ID and file kind." }, 400);
  const order = await env.DB.prepare("SELECT artwork_key,preview_key,source_artwork_key FROM orders WHERE id=?").bind(id).first();
  if (!order) return json({ error: "Order not found." }, 404);
  const object = await env.PRIVATE_ASSETS.get(kind === "artwork" ? order.artwork_key : kind === "source" ? order.source_artwork_key : order.preview_key);
  if (!object) return json({ error: "File not found." }, 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || (kind === "artwork" ? "image/svg+xml" : "image/png"), "Content-Disposition": `attachment; filename="${id}-${kind}.${kind === "artwork" || (kind === "source" && object.httpMetadata?.contentType === "image/svg+xml") ? "svg" : kind === "preview" ? "png" : object.httpMetadata?.contentType?.split("/")[1] || "img"}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
