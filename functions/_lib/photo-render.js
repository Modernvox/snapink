import { digest, json, now, randomId } from "./orders.js";
import assetCatalog from "../../scripts/photo-render/cad-assets.json" with { type: "json" };
import { maximumContainedLogoHeightMm, geometryFor, brandingRegionFor, surfaceBounds } from "../../src/config/sleeveGeometry.ts";

export const PHOTO_PRESETS = new Set(["cinematic", "marketplace", "studio"]);
export const PHOTO_SCENES = new Set(["sleeve", "on-hat-rear"]);
const IMAGE_TYPES = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);

export function validatePhotoSettings(value, { placementRequired = true } = {}) {
  if (!value || typeof value !== "object") return "Photo settings are required.";
  if (value.scene != null && !PHOTO_SCENES.has(value.scene)) return "Select Sleeve Only or On-Hat Rear View.";
  if (value.scene === "on-hat-rear" && value.relief !== "raised") return "On-Hat Rear View requires the approved raised artwork relief.";
  if (!["standard", "billboard"].includes(value.variant) || !Number.isInteger(value.size) || value.size < 0 || value.size > 5) return "Unsupported sleeve configuration.";
  const asset = assetCatalog.configurations.find((entry) => entry.variant === value.variant && entry.size === value.size);
  if (!asset || !asset.renderEligible) return "This sleeve mesh is missing or on CAD validation hold and cannot be selected for rendering.";
  if (!PHOTO_PRESETS.has(value.template)) return "Select Cinematic Hero, Marketplace, or Premium Studio.";
  if (!["fast", "premium"].includes(value.renderMode)) return "Select Fast or Premium rendering quality.";
  if (![1600, 2400, 3000].includes(value.resolution) || (value.renderMode === "fast" && value.resolution !== 1600)) return "Fast mode uses 1600 × 1600 output; choose Premium for higher resolution.";
  if (!/^#[0-9a-f]{6}$/i.test(value.material) || !["original", "#000000", "#111111", "#ffffff"].includes(String(value.artColor).toLowerCase())) return "Unsupported material or artwork color.";
  // A batch is configured before individual uploads have been decoded and
  // cropped. Validate its shared rendering choices here; enforce exact
  // artwork dimensions, centering, and the 1 mm CAD clearance on each file.
  if (!placementRequired) return null;
  if (!Number.isFinite(value.artworkWidthMm) || !Number.isFinite(value.artworkHeightMm) || !Number.isFinite(value.artworkAspectRatio) || !Number.isFinite(value.artworkCenterXmm) || !Number.isFinite(value.artworkCenterYmm) || value.artworkWidthMm <= 0 || value.artworkHeightMm <= 0 || value.artworkAspectRatio <= 0) return "Studio artwork placement data is missing.";
  if (Math.abs(value.artworkWidthMm / value.artworkHeightMm - value.artworkAspectRatio) > 0.002) return "Artwork aspect ratio must remain proportional.";
  try {
    const geom=geometryFor(value.variant,value.size),face=brandingRegionFor(value.variant,value.size),bounds=surfaceBounds(value.variant,value.size);
    const maxHeight=maximumContainedLogoHeightMm(value.variant,value.size,value.artworkCenterXmm,value.artworkCenterYmm,value.artworkAspectRatio,1);
    if (maxHeight <= 0 || value.artworkHeightMm > maxHeight + 0.01) return "Artwork exceeds the Studio CAD branding face or its 1 mm clearance.";
    if(value.artworkCenterXmm<face.grooveXmm+0.4+1-0.01||value.artworkCenterXmm>face.rightEdgeXmm-1+0.01||value.artworkCenterYmm<bounds.minY+1||value.artworkCenterYmm>bounds.maxY-1)return "Artwork center is outside the validated Studio branding area.";
    if(Math.abs(value.geometryLengthMm-(geom.overallMaxXmm-geom.overallMinXmm))>0.02||Math.abs(value.geometryCenterXmm-(geom.overallMaxXmm+geom.overallMinXmm)/2)>0.02)return "Render camera dimensions do not match the selected CAD size.";
  }catch{return "Selected Studio sleeve geometry is unavailable.";}
  return null;
}

export async function createPhotoBatch({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private photo storage is unavailable." }, 503);
  if (request.method === "GET") {
    const [rows, heartbeat] = await Promise.all([
      env.DB.prepare("SELECT id,batch_id AS batchId,status,source_sha256 AS sourceSha256,output_sha256 AS outputSha256,output_bytes AS outputBytes,original_name AS originalName,settings_json AS settingsJson,asset_validation_status AS assetValidationStatus,render_mode AS renderMode,render_engine AS renderEngine,render_duration_ms AS renderDurationMs,peak_gpu_memory_mb AS peakGpuMemoryMb,gpu_warning AS gpuWarning,error,attempt,progress_pct AS progress,stage,created_at AS createdAt,updated_at AS updatedAt FROM photo_render_jobs ORDER BY created_at DESC LIMIT 500").all(),
      env.DB.prepare("SELECT h.device_id AS deviceId,d.name AS deviceName,h.state,h.current_job_id AS currentJobId,h.message,h.updated_at AS lastSeenAt FROM photo_renderer_heartbeats h JOIN production_devices d ON d.id=h.device_id WHERE d.active=1 ORDER BY h.updated_at DESC LIMIT 1").first().catch(() => null)
    ]);
    const heartbeatAgeMs = heartbeat?.lastSeenAt ? Date.now() - Date.parse(heartbeat.lastSeenAt) : Infinity;
    const rendererConnected = heartbeatAgeMs >= 0 && heartbeatAgeMs <= 30000;
    const renderer = rendererConnected
      ? { connected: true, state: heartbeat.state, message: heartbeat.message, deviceName: heartbeat.deviceName, lastSeenAt: heartbeat.lastSeenAt, currentJobId: heartbeat.currentJobId }
      : { connected: false, state: "waiting", message: "Waiting for renderer. Start the paired SnapInk Photo Renderer on the Windows PC.", deviceName: heartbeat?.deviceName || null, lastSeenAt: heartbeat?.lastSeenAt || null, currentJobId: null };
    return json({ jobs: (rows.results || []).map((r) => ({ ...r, settings: JSON.parse(r.settingsJson) })), renderer });
  }
  if (request.method === "PATCH" || request.method === "DELETE") {
    const body = await request.json().catch(() => ({}));
    if (typeof body.id !== "string") return json({ error: "Photo job id is required." }, 400);
    const job = await env.DB.prepare("SELECT * FROM photo_render_jobs WHERE id=?").bind(body.id).first();
    if (!job) return json({ error: "Photo job not found." }, 404);
    if (request.method === "DELETE" || body.action === "delete") {
      await Promise.all([job.source_key, job.original_key, job.output_key].filter(Boolean).map((key) => env.PRIVATE_ASSETS.delete(key)));
      await env.DB.prepare("DELETE FROM photo_render_jobs WHERE id=?").bind(job.id).run();
      return json({ ok: true, deleted: job.id });
    }
    if (body.action !== "retry" || job.status !== "failed") return json({ error: "Only failed photo jobs can be retried." }, 409);
    await env.DB.prepare("UPDATE photo_render_jobs SET status='queued',error=NULL,attempt=attempt+1,worker_device=NULL,lease_expires=NULL,updated_at=? WHERE id=?").bind(now(), job.id).run();
    return json({ ok: true, id: job.id, status: "queued" }, 202);
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    if (body.action !== "createBatch" || !Number.isInteger(body.designCount) || body.designCount < 1 || body.designCount > 100) return json({ error: "Invalid batch request." }, 400);
    const id = randomId(16), time = now();
    const error = validatePhotoSettings(body.settings, { placementRequired: false });
    if (error) return json({ error }, 400);
    const asset = assetCatalog.configurations.find((entry) => entry.variant === body.settings.variant && entry.size === body.settings.size);
    await env.DB.prepare("INSERT INTO photo_render_batches(id,design_count,settings_json,asset_validation_status,render_mode,created_at) VALUES(?,?,?,?,?,?)").bind(id, body.designCount, JSON.stringify(body.settings), asset.validationStatus, body.settings.renderMode, time).run();
    return json({ ok: true, batchId: id, designCount: body.designCount }, 201);
  }

  let form;
  try { form = await request.formData(); } catch { return json({ error: "Send multipart artwork data." }, 400); }
  const file = form.get("file"), original = form.get("original"), batchId = form.get("batchId");
  let settings;
  try { settings = JSON.parse(String(form.get("settings") || "")); } catch { return json({ error: "Invalid photo settings." }, 400); }
  const error = validatePhotoSettings(settings);
  if (error) return json({ error }, 400);
  if (!(file instanceof File) || !IMAGE_TYPES.has(file.type) || file.size < 1 || file.size > 12 * 1024 * 1024) return json({ error: "Artwork must be PNG, JPEG, or WebP and no larger than 12 MB." }, 400);
  const batch = await env.DB.prepare("SELECT id,design_count,settings_json FROM photo_render_batches WHERE id=?").bind(batchId).first();
  if (!batch) return json({ error: "Photo batch not found." }, 404);
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM photo_render_jobs WHERE batch_id=?").bind(batchId).first();
  if (count.count >= batch.design_count) return json({ error: "This batch already contains the declared number of designs." }, 409);
  if (!(original instanceof File) || original.size < 1 || original.size > 12 * 1024 * 1024 || ![...IMAGE_TYPES.keys(),"image/svg+xml"].includes(original.type)) return json({ error: "Original artwork must be PNG, JPEG, WebP, or SVG and no larger than 12 MB." }, 400);
  if (original.type === "image/svg+xml") {
    const svg = await original.text();
    if (/<\s*(script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#)[^"']+|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|url\s*\(\s*(?!#)|@import/i.test(svg)) return json({ error: "SVG contains active or external content and was blocked." },400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer()), originalBytes = new Uint8Array(await original.arrayBuffer());
  const sourceSha = await digest(bytes);
  const existing = await env.DB.prepare("SELECT id,status FROM photo_render_jobs WHERE source_sha256=? AND settings_json=? AND status IN ('queued','rendering','completed') ORDER BY created_at DESC LIMIT 1").bind(sourceSha, JSON.stringify(settings)).first();
  if (existing) return json({ ok: true, duplicate: true, job: existing }, 200);
  const id = randomId(16), time = now(), sourceKey = `private-photo-sources/${batchId}/${id}.png`, originalKey = `private-photo-originals/${batchId}/${id}${original.type === "image/svg+xml" ? ".svg" : IMAGE_TYPES.get(original.type)}`;
  await Promise.all([env.PRIVATE_ASSETS.put(sourceKey, bytes, { httpMetadata: { contentType: file.type } }), env.PRIVATE_ASSETS.put(originalKey, originalBytes, { httpMetadata: { contentType: original.type } })]);
  try {
    const asset = assetCatalog.configurations.find((entry) => entry.variant === settings.variant && entry.size === settings.size);
    await env.DB.prepare("INSERT INTO photo_render_jobs(id,batch_id,status,source_key,original_key,source_sha256,original_name,settings_json,asset_validation_status,render_mode,created_at,updated_at) VALUES(?,?,'queued',?,?,?,?,?,?,?,?,?)").bind(id,batchId,sourceKey,originalKey,sourceSha,original.name.slice(0,180),JSON.stringify(settings),asset.validationStatus,settings.renderMode,time,time).run();
  } catch (cause) { await Promise.all([env.PRIVATE_ASSETS.delete(sourceKey),env.PRIVATE_ASSETS.delete(originalKey)]); throw cause; }
  return json({ ok: true, duplicate: false, job: { id, batchId, status: "queued", attempt: 1 } }, 202);
}
