import { deviceFor, json, now } from "../../_lib/orders.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Photo render queue is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const time = now();
  const job = await env.DB.prepare("SELECT id,batch_id AS batchId,source_key AS sourceKey,source_sha256 AS sourceSha256,original_name AS originalName,settings_json AS settingsJson,asset_validation_status AS assetValidationStatus,attempt FROM photo_render_jobs WHERE status='queued' OR (status='rendering' AND lease_expires < ?) ORDER BY created_at LIMIT 1").bind(time).first();
  if (!job) return json({ job: null });
  const lease = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const claimed = await env.DB.prepare("UPDATE photo_render_jobs SET status='rendering',stage='starting',progress_pct=1,worker_device=?,lease_expires=?,updated_at=? WHERE id=? AND (status='queued' OR (status='rendering' AND lease_expires < ?))").bind(device.id,lease,time,job.id,time).run();
  if (!claimed.meta?.changes) return json({ job: null });
  return json({ job: { ...job, settings: JSON.parse(job.settingsJson), fileUrl: `/api/photo-render/file?id=${encodeURIComponent(job.id)}` } });
}
