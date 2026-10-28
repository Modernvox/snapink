import { deviceFor, json, now } from "../../_lib/orders.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Photo renderer status storage is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const body = await request.json().catch(() => ({}));
  const states = new Set(["idle", "paused_orca", "rendering", "uploading"]);
  if (!states.has(body.state)) return json({ error: "Invalid photo renderer status." }, 400);
  const currentJobId = typeof body.currentJobId === "string" ? body.currentJobId.slice(0, 64) : null;
  const message = typeof body.message === "string" ? body.message.slice(0, 300) : "";
  const updatedAt = now();
  try {
    await env.DB.prepare("INSERT INTO photo_renderer_heartbeats(device_id,state,current_job_id,message,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET state=excluded.state,current_job_id=excluded.current_job_id,message=excluded.message,updated_at=excluded.updated_at")
      .bind(device.id, body.state, currentJobId, message, updatedAt).run();
    return json({ ok: true, state: body.state, updatedAt });
  } catch {
    return json({ error: "Photo renderer status storage is not initialized." }, 503);
  }
}
