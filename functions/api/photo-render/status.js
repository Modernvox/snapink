import { deviceFor, json, now } from "../../_lib/orders.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Photo render queue is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const body = await request.json().catch(() => ({}));
  if (typeof body.jobId !== "string" || !["rendering", "failed"].includes(body.status)) return json({ error: "Invalid photo job update." }, 400);
  const progress = Math.max(1, Math.min(99, Math.trunc(Number(body.progress) || 1)));
  const stage = typeof body.stage === "string" ? body.stage.slice(0,80) : "rendering";
  const message = typeof body.message === "string" ? body.message.slice(0,500) : null;
  const time = now();
  const job = await env.DB.prepare("SELECT id FROM photo_render_jobs WHERE id=? AND status='rendering' AND worker_device=?").bind(body.jobId,device.id).first();
  if (!job) return json({ error: "Photo job is not assigned to this paired companion." }, 409);
  const lease = body.status === "rendering" ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
  await env.DB.prepare("UPDATE photo_render_jobs SET status=?,stage=?,progress_pct=?,error=?,lease_expires=?,updated_at=? WHERE id=? AND worker_device=?").bind(body.status,stage,body.status==="failed"?0:progress,body.status==="failed"?message:null,lease,time,job.id,device.id).run();
  const workerState = body.status === "failed" ? "idle" : stage === "Uploading" ? "uploading" : "rendering";
  await env.DB.prepare("INSERT INTO photo_renderer_heartbeats(device_id,state,current_job_id,message,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET state=excluded.state,current_job_id=excluded.current_job_id,message=excluded.message,updated_at=excluded.updated_at")
    .bind(device.id,workerState,body.status === "failed" ? null : job.id,message||"",time).run();
  return json({ ok: true });
}
