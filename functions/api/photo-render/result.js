import { deviceFor, digest, json, now } from "../../_lib/orders.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Photo output storage is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  const job = await env.DB.prepare("SELECT id,batch_id,render_mode,settings_json FROM photo_render_jobs WHERE id=? AND status='rendering' AND worker_device=?").bind(id,device.id).first();
  if (!job) return json({ error: "Photo job is not assigned to this paired companion." }, 409);
  const type = request.headers.get("content-type");
  if (type !== "image/jpeg") return json({ error: "Renderer output must be JPEG." }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 28 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return json({ error: "Renderer output is invalid or exceeds 28 MB." }, 400);
  const renderMode=request.headers.get("X-SnapInk-Render-Mode"),renderEngine=request.headers.get("X-SnapInk-Render-Engine"),duration=Number(request.headers.get("X-SnapInk-Render-Duration-Ms")),memoryHeader=request.headers.get("X-SnapInk-Peak-Gpu-Memory-Mb"),memoryMissing=memoryHeader===null||memoryHeader===""||memoryHeader==="unknown",memory=memoryMissing?null:Number(memoryHeader),warning=(request.headers.get("X-SnapInk-Gpu-Warning")||"").slice(0,400);
  let settings;try{settings=JSON.parse(job.settings_json)}catch{return json({error:"Photo job settings are invalid."},409)}
  const expectedEngine=renderMode==="fast"?"BLENDER_EEVEE_NEXT":"CYCLES";
  if(renderMode!==job.render_mode||renderMode!==settings.renderMode||renderEngine!==expectedEngine||!Number.isFinite(duration)||duration<1||duration>25*60*1000||(!memoryMissing&&(!Number.isFinite(memory)||memory<0||memory>131072)))return json({error:"Render metrics do not match the queued quality mode."},400);
  const sha = await digest(bytes), key = `private-photo-renders/${job.batch_id}/${job.id}.jpg`, time = now();
  await env.PRIVATE_ASSETS.put(key,bytes,{httpMetadata:{contentType:"image/jpeg"}});
  await env.DB.prepare("UPDATE photo_render_jobs SET status='completed',stage='complete',progress_pct=100,output_key=?,output_sha256=?,output_bytes=?,render_engine=?,render_duration_ms=?,peak_gpu_memory_mb=?,gpu_warning=?,error=NULL,lease_expires=NULL,updated_at=? WHERE id=? AND worker_device=?").bind(key,sha,bytes.length,renderEngine,duration,memory,warning||null,time,job.id,device.id).run();
  return json({ ok:true, id:job.id, sha256:sha, bytes:bytes.length },201);
}
