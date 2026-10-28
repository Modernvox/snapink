import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function loadFunction(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
}

const adminModule = await loadFunction("../functions/api/admin/photo-studio.js");
const fileModule = await loadFunction("../functions/api/photo-render/file.js");
const nextModule = await loadFunction("../functions/api/photo-render/next.js");
const adminFileModule = await loadFunction("../functions/api/admin/photo-file.js");
const resultModule = await loadFunction("../functions/api/photo-render/result.js");
const token = "local-photo-device-token-0123456789-0123456789";
const adminToken = "local-photo-admin-token-0123456789-0123456789";
const jobs = new Map(), batches = new Map(), objects = new Map(), devices = new Map();
const tokenHash = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
devices.set(await tokenHash(token), { id: "device-1", name: "local", active: 1 });

class Db {
  prepare(sql) {
    return { all: async () => ({ results: [...jobs.values()].map((job)=>({...job,batchId:job.batch_id,sourceSha256:job.source_sha256,outputSha256:job.output_sha256,outputBytes:job.output_bytes,originalName:job.original_name,settingsJson:job.settings_json,assetValidationStatus:job.asset_validation_status,progress:job.progress_pct,createdAt:job.created_at,updatedAt:job.updated_at})) }), first: async () => null, bind: (...args) => ({
      run: async () => {
        if (sql.includes("INSERT INTO photo_render_batches")) { const [id, design_count, settings_json, asset_validation_status, render_mode, created_at] = args; batches.set(id, { id, design_count, settings_json, asset_validation_status, render_mode, created_at }); }
        else if (sql.includes("INSERT INTO photo_render_jobs")) { const [id,batch_id,source_key,original_key,source_sha256,original_name,settings_json,asset_validation_status,render_mode,created_at,updated_at] = args; jobs.set(id, { id,batch_id,status:"queued",source_key,original_key,source_sha256,original_name,settings_json,asset_validation_status,render_mode,attempt:1,progress_pct:0,stage:"queued",created_at,updated_at }); }
        else if (sql.includes("UPDATE photo_render_jobs SET status='rendering'")) { const [worker_device,lease_expires,updated_at,id] = args; const job=jobs.get(id);if(job){Object.assign(job,{status:"rendering",worker_device,lease_expires,updated_at});} }
        else if (sql.includes("UPDATE photo_render_jobs SET status='completed'")) { const [output_key,output_sha256,output_bytes,render_engine,render_duration_ms,peak_gpu_memory_mb,gpu_warning,updated_at,id,worker_device] = args; const job=jobs.get(id);if(job?.worker_device===worker_device)Object.assign(job,{status:"completed",stage:"complete",progress_pct:100,output_key,output_sha256,output_bytes,render_engine,render_duration_ms,peak_gpu_memory_mb,gpu_warning,updated_at}); }
        else if (sql.includes("DELETE FROM photo_render_jobs")) jobs.delete(args[0]);
        else if (sql.includes("UPDATE photo_render_jobs SET status='queued'")) { const job=jobs.get(args[1]);if(job)Object.assign(job,{status:"queued",error:null,attempt:job.attempt+1,worker_device:null,lease_expires:null,updated_at:args[0]}); }
        return { meta: { changes: 1 } };
      },
      first: async () => {
        if (sql.includes("FROM production_devices WHERE token_sha256")) return devices.get(args[0]) || null;
        if (sql.includes("FROM photo_render_batches WHERE id")) return batches.get(args[0]) || null;
        if (sql.includes("COUNT(*) AS count")) return { count: [...jobs.values()].filter((job) => job.batch_id === args[0]).length };
        if (sql.includes("SELECT id,status FROM photo_render_jobs WHERE source_sha256")) return [...jobs.values()].find((job) => job.source_sha256 === args[0] && job.settings_json === args[1] && ["queued","rendering","completed"].includes(job.status)) || null;
        if (sql.includes("FROM photo_render_jobs WHERE id=? AND status='rendering'")) { const job=jobs.get(args[0]);return job?.worker_device===args[1]?{...job,render_mode:job.render_mode,settings_json:job.settings_json}:null; }
        if (sql.includes("WHERE status='queued' OR (status='rendering'")) { const job=[...jobs.values()].find((value) => value.status === "queued" || (value.status === "rendering" && value.lease_expires < args[0]));return job?{...job,batchId:job.batch_id,sourceKey:job.source_key,sourceSha256:job.source_sha256,originalName:job.original_name,settingsJson:job.settings_json,assetValidationStatus:job.asset_validation_status}:null; }
        if (sql.includes("FROM photo_render_jobs WHERE id=? AND status='completed'")) return jobs.get(args[0]) || null;
        if (sql.includes("SELECT output_key,original_key")) return jobs.get(args[0]) || null;
        return null;
      },
    }) };
  }
}
const bucket = { put: async (key, bytes, options) => objects.set(key, { bytes: Buffer.from(bytes), httpMetadata: options?.httpMetadata }), delete: async (key) => objects.delete(key), get: async (key) => { const object=objects.get(key);return object?{body:new Blob([object.bytes]).stream(),httpMetadata:object.httpMetadata}:null; } };
const env={DB:new Db(),PRIVATE_ASSETS:bucket,ADMIN_REVIEW_TOKEN:adminToken};
const settings={variant:"standard",size:4,template:"marketplace",renderMode:"fast",resolution:1600,material:"#111111",artColor:"#ffffff",geometryLengthMm:119.005,geometryCenterXmm:46.7775,artworkWidthMm:20,artworkHeightMm:10,artworkAspectRatio:2,artworkCenterXmm:50,artworkCenterYmm:0};
const req=(url,method,body,auth=adminToken,headers={})=>new Request("https://studio.test"+url,{method,headers:{...(auth?{Authorization:"Bearer "+auth}:{}),...headers},body});

test("owner photo API validates ownership and blocks CAD validation-hold configurations",async()=>{
  const denied=await adminModule.onRequest({request:req("/api/admin/photo-studio","GET",undefined,""),env});assert.equal(denied.status,401);
  const held=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,variant:"billboard",size:2}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(held.status,400);assert.match((await held.json()).error,/validation hold/i);
  const tooLargeBatch=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(tooLargeBatch.status,201);const {batchId:tooLargeBatchId}=await tooLargeBatch.json();const tooLargeSettings={...settings,artworkWidthMm:100,artworkHeightMm:50};const oversizedForm=new FormData();oversizedForm.set("batchId",tooLargeBatchId);oversizedForm.set("settings",JSON.stringify(tooLargeSettings));oversizedForm.set("file",new File([new Uint8Array([137,80,78,71,13,10,26,10])],"oversized.png",{type:"image/png"}));oversizedForm.set("original",new File([new Uint8Array([1,2,3])],"oversized.png",{type:"image/png"}));const tooLarge=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",oversizedForm),env});assert.equal(tooLarge.status,400);assert.match((await tooLarge.json()).error,/clearance/i);
  const fastUpscale=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,resolution:2400}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(fastUpscale.status,400);assert.match((await fastUpscale.json()).error,/Fast mode/i);
  const premiumBatch=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,renderMode:"premium",resolution:2400}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(premiumBatch.status,201);
  const onHat=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,scene:"on-hat-rear",relief:"raised"}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(onHat.status,201);
  const unknownScene=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,scene:"generated-hat"}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(unknownScene.status,400);assert.match((await unknownScene.json()).error,/Sleeve Only/i);
  const flatOnHat=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:{...settings,scene:"on-hat-rear",relief:"flat"}}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(flatOnHat.status,400);assert.match((await flatOnHat.json()).error,/raised artwork relief/i);
});

test("owner batches queue artwork, paired renderer claims only a photo job, and gallery keeps CAD status",async()=>{
  const batchResponse=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(batchResponse.status,201);const {batchId}=await batchResponse.json();
  const form=new FormData();form.set("batchId",batchId);form.set("settings",JSON.stringify(settings));form.set("file",new File([new Uint8Array([137,80,78,71,13,10,26,10])],"normalized.png",{type:"image/png"}));form.set("original",new File([new Uint8Array([1,2,3])],"logo.png",{type:"image/png"}));
  const queued=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",form),env});assert.equal(queued.status,202);const {job}=await queued.json();
  const unpaired=await nextModule.onRequestGet({request:req("/api/photo-render/next","GET",undefined,"wrong-token-000000000000000000000"),env});assert.equal(unpaired.status,401);
  const claimed=await nextModule.onRequestGet({request:req("/api/photo-render/next","GET",undefined,token),env});assert.equal(claimed.status,200);assert.equal((await claimed.json()).job.id,job.id);
  const privateFile=await fileModule.onRequestGet({request:req("/api/photo-render/file?id="+job.id,"GET",undefined,token),env});assert.equal(privateFile.status,200);assert.equal(privateFile.headers.get("cache-control"),"private, no-store");
  const gallery=await adminModule.onRequest({request:req("/api/admin/photo-studio","GET",undefined,adminToken),env});assert.equal(gallery.status,200);const row=(await gallery.json()).jobs[0];assert.match(row.assetValidationStatus,/manual orca load/i);assert.equal(row.status,"rendering");
  const exposed=await adminFileModule.onRequestGet({request:req("/api/admin/photo-file?id="+job.id,"GET",undefined,""),env});assert.equal(exposed.status,401);
  const jpeg=new Uint8Array(1200);jpeg[0]=0xff;jpeg[1]=0xd8;jpeg[jpeg.length-2]=0xff;jpeg[jpeg.length-1]=0xd9;
  const uploaded=await resultModule.onRequestPost({request:req("/api/photo-render/result?id="+job.id,"POST",jpeg,token,{"Content-Type":"image/jpeg","X-SnapInk-Render-Mode":"fast","X-SnapInk-Render-Engine":"BLENDER_EEVEE_NEXT","X-SnapInk-Render-Duration-Ms":"12345","X-SnapInk-Peak-Gpu-Memory-Mb":"1024"}),env});assert.equal(uploaded.status,201);assert.equal(jobs.get(job.id).render_engine,"BLENDER_EEVEE_NEXT");assert.equal(jobs.get(job.id).render_duration_ms,12345);assert.equal(jobs.get(job.id).peak_gpu_memory_mb,1024);
  const galleryFile=await adminFileModule.onRequestGet({request:req("/api/admin/photo-file?id="+job.id,"GET",undefined,adminToken),env});assert.equal(galleryFile.status,200);assert.equal(galleryFile.headers.get("cache-control"),"private, no-store");
});

test("On-Hat Rear View settings persist in a private queued job without affecting the sleeve-only default",async()=>{
  const onHatSettings={...settings,scene:"on-hat-rear",relief:"raised",artColor:"#111111"};
  const batchResponse=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",JSON.stringify({action:"createBatch",designCount:1,settings:onHatSettings}),adminToken,{"Content-Type":"application/json"}),env});assert.equal(batchResponse.status,201);const {batchId}=await batchResponse.json();
  const form=new FormData();form.set("batchId",batchId);form.set("settings",JSON.stringify(onHatSettings));form.set("file",new File([new Uint8Array([137,80,78,71,13,10,26,10])],"TEST-ONLY-font.svg-normalized.png",{type:"image/png"}));form.set("original",new File(["<svg xmlns=\"http://www.w3.org/2000/svg\"><text font-family=\"Georgia\">TEST ONLY</text></svg>"],"TEST-ONLY-Georgia.svg",{type:"image/svg+xml"}));
  const queued=await adminModule.onRequest({request:req("/api/admin/photo-studio","POST",form),env});assert.equal(queued.status,202);const {job}=await queued.json();assert.equal(jobs.get(job.id).settings_json,JSON.stringify(onHatSettings));
});
