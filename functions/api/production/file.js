import { deviceFor, json, now } from "../../_lib/orders.js";
export async function onRequestGet({request,env}) {
  if(!env.DB||!env.PRIVATE_ASSETS||!env.MODEL_BUCKET)return json({error:"Private job storage is unavailable."},503);
  const device=await deviceFor(request,env.DB); if(!device)return json({error:"Companion is not paired."},401);
  const url=new URL(request.url),jobId=url.searchParams.get("jobId"),kind=url.searchParams.get("kind");
  if(!jobId||!["model","artwork","source","preview"].includes(kind))return json({error:"Invalid file request."},400);
  const job=await env.DB.prepare("SELECT j.model_key,o.artwork_key,o.source_artwork_key,o.preview_key FROM production_jobs j JOIN orders o ON o.id=j.order_id WHERE j.id=? AND j.status IN ('queued','downloaded')").bind(jobId).first();
  if(!job)return json({error:"Active production job not found."},404);
  const bucket=kind==="model"?env.MODEL_BUCKET:env.PRIVATE_ASSETS;
  const key=kind==="model"?job.model_key:kind==="artwork"?job.artwork_key:kind==="source"?job.source_artwork_key:job.preview_key;
  const object=await bucket.get(key); if(!object)return json({error:"Production file is missing."},404);
  const type=kind==="model"?"model/3mf":kind==="artwork"?"image/svg+xml":object.httpMetadata?.contentType||"image/png";
  return new Response(object.body,{headers:{"Content-Type":type,"Content-Disposition":`attachment; filename="${jobId}-${kind}.${kind==="model"?"3mf":kind==="artwork"||type==="image/svg+xml"?"svg":kind==="preview"?"png":type.split("/")[1]||"img"}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({error:"Production queue is unavailable."},503);
  const device=await deviceFor(request,env.DB); if(!device)return json({error:"Companion is not paired."},401);
  const {jobId,status,message,stage}=await request.json().catch(()=>({}));
  const stages=["preparing_artwork","generating_production_geometry","validating_production_project","ready_for_orca","transferring_to_companion","opening_in_orca","awaiting_owner_review"];
  if(typeof jobId!=="string"||(!["downloaded","opened","failed"].includes(status)&&!stages.includes(stage)))return json({error:"Invalid job update."},400);
  const job=await env.DB.prepare("SELECT status FROM production_jobs WHERE id=?").bind(jobId).first();
  if(!job||!["queued","downloaded","failed"].includes(job.status))return json({error:"Job is not in an updateable state."},409);
  const time=now();
  const cleanMessage=typeof message==="string"?message.slice(0,500):null;
  if(stage){
    await env.DB.prepare("INSERT INTO production_job_progress(job_id,stage,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET stage=excluded.stage,message=excluded.message,updated_at=excluded.updated_at").bind(jobId,stage,cleanMessage,time).run();
    await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(jobId,stage,cleanMessage,time).run();
    return json({ok:true,stage});
  }
  await env.DB.prepare("UPDATE production_jobs SET status=?,error=?,updated_at=?,claim_expires=NULL WHERE id=?").bind(status,status==="failed"?(cleanMessage||"Companion reported failure."):null,time,jobId).run();
  await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(jobId,status,cleanMessage,time).run();
  if(status==="opened"){
    await env.DB.prepare("INSERT INTO production_job_progress(job_id,stage,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET stage=excluded.stage,message=excluded.message,updated_at=excluded.updated_at").bind(jobId,"awaiting_owner_review",cleanMessage,time).run();
    await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(jobId,"awaiting_owner_review",cleanMessage,time).run();
  }
  return json({ok:true,status});
}
