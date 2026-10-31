import { bearer, json } from "../../_lib/orders.js";

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private photo storage is unavailable." }, 503);
  const id = new URL(request.url).searchParams.get("id");
  const kind = new URL(request.url).searchParams.get("kind") || "output";
  if (!['output','original'].includes(kind)) return json({ error: "Invalid private photo file kind." },400);
  const job = await env.DB.prepare("SELECT output_key,original_key,original_name FROM photo_render_jobs WHERE id=? AND (status='completed' OR ?='original')").bind(id,kind).first();
  const key = kind === "original" ? job?.original_key : job?.output_key;
  if (!key) return json({ error: "Private photo file not found." }, 404);
  const object = await env.PRIVATE_ASSETS.get(key);
  if (!object) return json({ error: "Private photo file is unavailable." }, 404);
  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "bin";
  const name = `${job.original_name.replace(/\.[^.]+$/,"").replace(/[^a-z0-9_-]/gi,"_")}-snapink.${extension}`;
  return new Response(object.body, { headers: { "Content-Type": contentType, "Content-Disposition": `${kind === "output" ? "inline" : "attachment"}; filename="${kind === "output" ? name : job.original_name.replace(/[^a-z0-9_.-]/gi,"_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
