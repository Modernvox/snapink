import { bearer, json } from "../../_lib/orders.js";

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private design storage is unavailable." }, 503);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  if (!id || !/^[a-f0-9]{32}$/.test(id) || !["preview", "artwork", "source"].includes(kind)) return json({ error: "Provide a valid draft ID and file kind." }, 400);
  const draft = await env.DB.prepare("SELECT preview_key,artwork_key,source_artwork_key FROM design_drafts WHERE id=?").bind(id).first();
  if (!draft) return json({ error: "Design draft not found." }, 404);
  const key = kind === "preview" ? draft.preview_key : kind === "artwork" ? draft.artwork_key : draft.source_artwork_key;
  if (!key) return json({ error: "No source artwork was uploaded for this draft." }, 404);
  const object = await env.PRIVATE_ASSETS.get(key);
  if (!object) return json({ error: "Design file not found." }, 404);
  const extension = kind === "preview" ? "png" : kind === "artwork" ? "svg" : key.split(".").pop();
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || (kind === "preview" ? "image/png" : "image/svg+xml"), "Content-Disposition": `attachment; filename="${id}-${kind}.${extension}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
