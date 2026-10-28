import { deviceFor, json } from "../../_lib/orders.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Photo storage is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  const job = await env.DB.prepare("SELECT source_key,source_sha256 FROM photo_render_jobs WHERE id=? AND status='rendering' AND worker_device=?").bind(id,device.id).first();
  if (!job) return json({ error: "Photo job is not assigned to this paired companion." }, 404);
  const object = await env.PRIVATE_ASSETS.get(job.source_key);
  if (!object) return json({ error: "Private photo artwork is unavailable." }, 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-SnapInk-SHA256": job.source_sha256 } });
}
