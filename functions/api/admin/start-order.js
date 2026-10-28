import { bearer, digest, json, now, randomId } from "../../_lib/orders.js";

import productionManifest from "../../../scripts/production-model-manifest.json" assert { type: "json" };
import releaseState from "../../../scripts/production-release-state.json" assert { type: "json" };

export async function onRequestPost({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (releaseState.productionOrdersEnabled !== true && env.SNAPINK_LOCAL_E2E !== "true") return json({ error: "Production dispatch is paused until blank-flap templates and CAD-centering validation pass." }, 503);
  if (!env.DB || !env.PRIVATE_ASSETS || !env.MODEL_BUCKET || !env.BACKUP_BUCKET) return json({ error: "Order storage or private production model storage is not configured." }, 503);
  try {
    const { orderId } = await request.json();
    const order = await env.DB.prepare("SELECT id,order_number,status,variant,size,quantity,artwork_key,preview_key,source_artwork_key,artwork_sha256,preview_sha256,draft_json FROM orders WHERE id=?").bind(orderId).first();
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.status !== "ready") return json({ error: "Set the order to Ready after owner review before starting production." }, 409);
    let orderDraft;
    try { orderDraft = JSON.parse(order.draft_json); } catch { return json({ error: "Order uses an obsolete or invalid positioning specification. Recreate it in the current Studio." }, 409); }
    if (orderDraft.productionGeometryVersion !== releaseState.geometryVersion || orderDraft.positioningVersion !== releaseState.positioningVersion) return json({ error: "Order uses an obsolete geometry or centering coordinate system. Recreate it in the current Studio." }, 409);
    const existing = await env.DB.prepare("SELECT id,status,attempt FROM production_jobs WHERE order_id=?").bind(orderId).first();
    if (existing && existing.status !== "failed") return json({ ok: true, duplicate: true, job: existing });
    const modelKey = `models/${order.variant}/${order.size}.3mf`;
    const approved = productionManifest.models.find((entry) => entry.variant === order.variant && entry.size === order.size);
    if (!approved || productionManifest.geometryVersion !== releaseState.geometryVersion) return json({ error: "This order does not match the current blank-flap production configuration." }, 409);
    const model = await env.MODEL_BUCKET.get(modelKey);
    if (!model) return json({ error: `Approved ${order.variant} size ${order.size} Orca project is not installed in private model storage.` }, 503);
    const modelBytes = new Uint8Array(await model.arrayBuffer());
    if (modelBytes.length < 128 || modelBytes[0] !== 0x50 || modelBytes[1] !== 0x4b) return json({ error: "The private production asset is not a valid 3MF ZIP project." }, 409);
    const modelSha256 = await digest(modelBytes);
    if (modelSha256 !== approved.sha256) return json({ error: `The private ${order.variant} Size ${order.size} model does not match the approved production catalog. No job was queued.` }, 409);
    const backupModel = await env.BACKUP_BUCKET.head(modelKey);
    if (!backupModel) return json({ error: "The approved production model backup is unavailable." }, 503);
    const backupArtwork = await env.BACKUP_BUCKET.head(order.artwork_key);
    const backupPreview = await env.BACKUP_BUCKET.head(order.preview_key);
    const backupSource = await env.BACKUP_BUCKET.head(order.source_artwork_key);
    if (!backupArtwork || !backupPreview || !backupSource) return json({ error: "An order file backup is unavailable." }, 409);
    const artwork = await env.PRIVATE_ASSETS.head(order.artwork_key);
    const preview = await env.PRIVATE_ASSETS.head(order.preview_key);
    if (!artwork || !preview) return json({ error: "The approved artwork or preview is unavailable." }, 409);
    const time = now();
    const id = existing?.id || randomId(16);
    const attempt = (existing?.attempt || 0) + 1;
    if (existing) {
      await env.DB.prepare("UPDATE production_jobs SET status='queued',model_key=?,model_sha256=?,error=NULL,attempt=?,claim_device=NULL,claim_expires=NULL,updated_at=? WHERE id=?").bind(modelKey,modelSha256,attempt,time,id).run();
    } else {
      await env.DB.prepare("INSERT INTO production_jobs(id,order_id,status,model_key,model_sha256,attempt,created_at,updated_at) VALUES(?,?,'queued',?,?,1,?,?)").bind(id,orderId,modelKey,modelSha256,time,time).run();
    }
    await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(id,"queued",`Attempt ${attempt} queued for ${order.order_number}`,time).run();
    await env.DB.prepare("INSERT INTO production_job_progress(job_id,stage,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET stage=excluded.stage,message=excluded.message,updated_at=excluded.updated_at").bind(id,"transferring_to_companion","Waiting for the paired Windows companion to receive this verified job.",time).run();
    await env.DB.prepare("INSERT INTO order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(orderId,"admin","production_job_queued",JSON.stringify({ jobId:id,modelKey,attempt }),time).run();
    return json({ ok: true, job: { id,status:"queued",attempt,modelKey,modelSha256,orderNumber:order.order_number } }, 202);
  } catch (error) {
    console.error("Start order failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Could not queue production. Confirm migrations and private model storage, then retry." }, 503);
  }
}
