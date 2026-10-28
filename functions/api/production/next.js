import { deviceFor, json, now } from "../../_lib/orders.js";

import releaseState from "../../../scripts/production-release-state.json" with { type: "json" };

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "Production queue is unavailable." },503);
  if (releaseState.productionOrdersEnabled !== true && env.SNAPINK_LOCAL_E2E !== "true") return json({ error: "Production dispatch is paused for blank-flap validation." },503);
  const device=await deviceFor(request,env.DB);
  if(!device) return json({ error:"Companion is not paired or its credential was revoked." },401);
  try {
    const job=await env.DB.prepare(`SELECT j.id,j.status,j.attempt,j.model_key AS modelKey,j.model_sha256 AS modelSha256,j.created_at AS createdAt,o.order_number AS orderNumber,o.variant,o.size,o.quantity,o.draft_json AS draftJson,o.artwork_sha256 AS artworkSha256,o.preview_sha256 AS previewSha256,o.source_artwork_sha256 AS sourceArtworkSha256 FROM production_jobs j JOIN orders o ON o.id=j.order_id WHERE j.status='queued' AND (j.claim_expires IS NULL OR j.claim_expires < ?) ORDER BY j.created_at LIMIT 1`).bind(now()).first();
    if(!job) return json({ job:null,device:device.name });
    let draft;
    try { draft=JSON.parse(job.draftJson); } catch { draft=null; }
    if(!draft || draft.productionGeometryVersion!==releaseState.geometryVersion || draft.positioningVersion!==releaseState.positioningVersion) {
      const time=now();
      await env.DB.prepare("UPDATE production_jobs SET status='failed',error=?,claim_device=NULL,claim_expires=NULL,updated_at=? WHERE id=? AND status='queued'").bind("Order has obsolete geometry or centering metadata; it was not sent to the companion.",time,job.id).run();
      await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(job.id,"failed","Obsolete production coordinate/geometry version rejected before companion transfer.",time).run();
      return json({error:"A queued order has obsolete geometry or positioning metadata and was stopped before production."},409);
    }
    const claimUntil=new Date(Date.now()+5*60*1000).toISOString();
    const claimed=await env.DB.prepare("UPDATE production_jobs SET claim_device=?,claim_expires=? WHERE id=? AND status='queued' AND (claim_expires IS NULL OR claim_expires < ?)").bind(device.id,claimUntil,job.id,now()).run();
    if(!claimed.meta?.changes) return json({job:null,device:device.name});
    return json({ job:{...job,files:{model:`/api/production/file?jobId=${encodeURIComponent(job.id)}&kind=model`,artwork:`/api/production/file?jobId=${encodeURIComponent(job.id)}&kind=artwork`,source:`/api/production/file?jobId=${encodeURIComponent(job.id)}&kind=source`,preview:`/api/production/file?jobId=${encodeURIComponent(job.id)}&kind=preview`}} });
  } catch(error) {
    console.error("Companion poll failed",error instanceof Error?error.message:"unknown");
    return json({ error:"Production queue is not initialized." },503);
  }
}
