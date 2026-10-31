import { deviceFor, digest, json, now } from "../../_lib/orders.js";
import assetCatalog from "../../../scripts/photo-render/cad-assets.json" assert { type: "json" };
import masterManifest from "../../../scripts/photo-render/on-hat-rear-reference.json" assert { type: "json" };

function parseGenerationMetadata(request) {
  const value = request.headers.get("X-SnapInk-Output-Metadata");
  if (!value || value.length > 4096) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function validPng(bytes) {
  if (bytes.length < 45) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16));
  const end = String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4));
  return ihdr === "IHDR" && end === "IEND" && view.getUint32(16) === 1536 && view.getUint32(20) === 1024;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Photo output storage is unavailable." }, 503);
  const device = await deviceFor(request, env.DB);
  if (!device) return json({ error: "Companion is not paired." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  const job = await env.DB.prepare("SELECT id,batch_id,render_mode,settings_json,source_sha256 FROM photo_render_jobs WHERE id=? AND status='rendering' AND worker_device=?").bind(id,device.id).first();
  if (!job) return json({ error: "Photo job is not assigned to this paired companion." }, 409);
  let settings;
  try { settings = JSON.parse(job.settings_json); } catch { return json({ error: "Photo job settings are invalid." }, 409); }
  const onHat = settings.scene === "on-hat-rear";
  const type = request.headers.get("content-type");
  if (onHat ? type !== "image/png" : type !== "image/jpeg") return json({ error: onHat ? "Locked-master output must be a native-resolution PNG." : "Renderer output must be JPEG." }, 415);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 28 * 1024 * 1024 || (onHat ? !validPng(bytes) : !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9))) return json({ error: "Renderer output is invalid, has the wrong dimensions, or exceeds 28 MB." }, 400);
  const generation = onHat ? parseGenerationMetadata(request) : null;
  if (onHat) {
    const asset = assetCatalog.configurations.find((entry) => entry.variant === settings.variant && entry.size === settings.size);
    if (!generation || generation.masterImageId !== masterManifest.masterImageId || generation.masterImageSha256 !== masterManifest.masterImageSha256 || generation.calibrationVersion !== masterManifest.calibrationVersion || generation.artworkSha256 !== job.source_sha256 || generation.cadSha256 !== asset?.sha256 || generation.outsideMaskUnchanged !== true || generation.width !== masterManifest.masterCanvasPx[0] || generation.height !== masterManifest.masterCanvasPx[1] || generation.outputFormat !== "image/png" || generation.artworkReliefMm !== masterManifest.referenceCad.reliefMm) return json({ error: "Locked-master generation proof is missing or does not match the private job." }, 400);
  }
  const renderMode=request.headers.get("X-SnapInk-Render-Mode"),renderEngine=request.headers.get("X-SnapInk-Render-Engine"),duration=Number(request.headers.get("X-SnapInk-Render-Duration-Ms")),memoryHeader=request.headers.get("X-SnapInk-Peak-Gpu-Memory-Mb"),memoryMissing=memoryHeader===null||memoryHeader===""||memoryHeader==="unknown",memory=memoryMissing?null:Number(memoryHeader),warning=(request.headers.get("X-SnapInk-Gpu-Warning")||"").slice(0,400);
  const expectedEngine=renderMode==="fast"?"BLENDER_EEVEE_NEXT":"CYCLES";
  if(renderMode!==job.render_mode||renderMode!==settings.renderMode||renderEngine!==expectedEngine||!Number.isFinite(duration)||duration<1||duration>25*60*1000||(!memoryMissing&&(!Number.isFinite(memory)||memory<0||memory>131072)))return json({error:"Render metrics do not match the queued quality mode."},400);
  const sha = await digest(bytes), extension = onHat ? ".png" : ".jpg", contentType = onHat ? "image/png" : "image/jpeg", key = `private-photo-renders/${job.batch_id}/${job.id}${extension}`, time = now();
  await env.PRIVATE_ASSETS.put(key,bytes,{httpMetadata:{contentType}});
  const storedSettings = onHat ? JSON.stringify({ ...settings, generationMetadata: generation }) : job.settings_json;
  await env.DB.prepare("UPDATE photo_render_jobs SET status='completed',stage='complete',progress_pct=100,output_key=?,output_sha256=?,output_bytes=?,render_engine=?,render_duration_ms=?,peak_gpu_memory_mb=?,gpu_warning=?,settings_json=?,error=NULL,lease_expires=NULL,updated_at=? WHERE id=? AND worker_device=?").bind(key,sha,bytes.length,renderEngine,duration,memory,warning||null,storedSettings,time,job.id,device.id).run();
  return json({ ok:true, id:job.id, sha256:sha, bytes:bytes.length, contentType, generationMetadata:generation },201);
}
