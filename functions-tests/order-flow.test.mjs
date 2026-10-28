import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
async function loadFunction(entry) { const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" }); return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64")); }
const { onRequestPost: submitOrder } = await loadFunction("../functions/api/orders.js");
const { onRequestPost: startOrder } = await loadFunction("../functions/api/admin/start-order.js");
const { onRequestPatch: updateOrder } = await loadFunction("../functions/api/admin/orders.js");
const { onRequestPost: pairDevice, onRequestDelete: revokeDevice } = await loadFunction("../functions/api/admin/pair-device.js");
const { onRequestGet: pollNext } = await loadFunction("../functions/api/production/next.js");
const { onRequestPost: recordBatch, onRequestGet: listBatches } = await loadFunction("../functions/api/admin/batches.js");
const manifest = JSON.parse(fs.readFileSync(new URL("../scripts/production-model-manifest.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""));

const token = "test-partner-secret-0123456789";
const adminToken = "test-admin-secret-0123456789";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="1" y="20">Test</text></svg>';
const svgData = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const pngData = "data:image/png;base64," + png.toString("base64");
const orders = new Map(), jobs = new Map(), devices = new Map(), productionBatches = new Map(), objects = new Map(), backupObjects = new Map(), events=[];
const modelFiles = new Map(manifest.models.map((m) => {
  const file = path.join(manifest.sourceRoot, m.file.replaceAll("/", "\\"));
  const bytes = fs.readFileSync(file);
  assert.equal(requireHash(bytes), m.sha256, "manifest source checksum");
  return [`models/${m.variant}/${m.size}.3mf`, bytes];
}));
function requireHash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
class FakeDb {
  prepare(sql) {
    return { bind: (...args) => ({
      run: async () => {
        if (sql.includes("INSERT INTO orders")) {
          if ([...orders.values()].some((o) => o.idempotency_key === args[2])) throw new Error("UNIQUE constraint failed: orders.idempotency_key");
          const [id,order_number,idempotency_key,customer_name,customer_email,customer_phone,quantity,variant,size,draft_json,artwork_key,preview_key,source_artwork_key,artwork_sha256,preview_sha256,source_artwork_sha256,created_at,updated_at] = args;
          orders.set(id,{id,order_number,idempotency_key,customer_name,customer_email,customer_phone,quantity,quantity_completed:0,variant,size,status:"new",draft_json,artwork_key,preview_key,source_artwork_key,artwork_sha256,preview_sha256,source_artwork_sha256,created_at,updated_at});
        } else if (sql.includes("INSERT INTO production_batches")) {
          const [id,orderId,,quantity,note,createdAt,guardOrderId,guardQuantity]=args;const order=orders.get(orderId),job=jobs.get(orderId);const produced=[...productionBatches.values()].filter((b)=>b.order_id===orderId).reduce((n,b)=>n+b.quantity,0);
          if(order&&job?.status==="opened"&&order.status==="in_production"&&guardOrderId===orderId&&guardQuantity===quantity&&produced+quantity<=order.quantity){const batchNumber=Math.max(0,...[...productionBatches.values()].filter((b)=>b.order_id===orderId).map((b)=>b.batch_number))+1;productionBatches.set(id,{id,order_id:orderId,batch_number:batchNumber,quantity,note,created_at:createdAt});}
          else return {meta:{changes:0}};
        } else if (sql.includes("INSERT INTO production_jobs")) {
          const [id,order_id,model_key,model_sha256,created_at,updated_at]=args;
          jobs.set(order_id,{id,order_id,status:"queued",model_key,model_sha256,attempt:1,created_at,updated_at});
        } else if (sql.includes("INSERT INTO production_devices")) { const [id,name,token_sha256,paired_at]=args; devices.set(id,{id,name,token_sha256,active:1,paired_at,last_seen_at:null}); }
        else if (sql.includes("UPDATE production_devices SET active=0")) { const d=devices.get(args[0]); if(d)d.active=0; }
        else if (sql.includes("UPDATE production_devices SET last_seen_at")) { const d=devices.get(args[1]); if(d)d.last_seen_at=args[0]; }
        else if (sql.includes("INSERT INTO order_events") || sql.includes("INSERT INTO production_events")) events.push({sql,args});
        else if (sql.includes("UPDATE orders SET quantity_completed=(SELECT")) { const [orderId,,guardOrderId,batchId]=args;const o=orders.get(orderId);if(o&&guardOrderId===orderId&&productionBatches.has(batchId))o.quantity_completed=[...productionBatches.values()].filter((b)=>b.order_id===orderId).reduce((n,b)=>n+b.quantity,0);else return {meta:{changes:0}}; }
        else if (sql.includes("UPDATE orders SET quantity_completed")) { const o=orders.get(args[2]); if(o && o.status===args[3])o.quantity_completed=args[0];else return {meta:{changes:0}}; }
        else if (sql.includes("UPDATE orders SET status")) { const o=orders.get(args[2]); if(o && o.status===args[3]){o.status=args[0];}else return {meta:{changes:0}}; }
        else if (sql.includes("UPDATE production_jobs SET status='completed'")) { const j=[...jobs.values()].find((item)=>item.id===args[1]); if(j)j.status="completed"; }
        else if (sql.includes("UPDATE production_jobs SET status='queued'")) { const j=[...jobs.values()].find((item)=>item.id===args[4]); Object.assign(j,{model_key:args[0],model_sha256:args[1],status:"queued",attempt:args[2]}); }
        return {meta:{changes:1}};
      },
      first: async () => {
        if (sql.includes("FROM production_batches WHERE id=?")) { const b=productionBatches.get(args[0]);return b?{id:b.id,batchNumber:b.batch_number,quantity:b.quantity,note:b.note,createdAt:b.created_at}:null; }
        if (sql.includes("FROM production_batches WHERE order_id=? GROUP BY")) { const o=orders.get(args[0]);const total=[...productionBatches.values()].filter((b)=>b.order_id===args[0]).reduce((n,b)=>n+b.quantity,0);return o?{quantity:o.quantity,quantityProduced:total}:null; }
        if (sql.includes("LEFT JOIN production_batches b ON b.order_id=o.id") && sql.includes("GROUP BY o.id")) { const o=orders.get(args[0]);const total=[...productionBatches.values()].filter((b)=>b.order_id===args[0]).reduce((n,b)=>n+b.quantity,0);return o?{quantity:o.quantity,quantityProduced:total}:null; }
        if (sql.includes("SELECT quantity,quantity_completed AS quantityProduced FROM orders WHERE id=?")) { const o=orders.get(args[0]);return o?{quantity:o.quantity,quantityProduced:o.quantity_completed}:null; }
        if (sql.includes("SELECT COALESCE(SUM(quantity),0) AS produced FROM production_batches")) return {produced:[...productionBatches.values()].filter((b)=>b.order_id===args[0]).reduce((n,b)=>n+b.quantity,0)};
        if (sql.includes("FROM orders o LEFT JOIN production_jobs")) { const o=orders.get(args[0]);const j=jobs.get(args[0]);const total=[...productionBatches.values()].filter((b)=>b.order_id===args[0]).reduce((n,b)=>n+b.quantity,0);return o?{status:o.status,quantity:o.quantity,job_status:j?.status,produced:total}:null; }
        if (sql.includes("FROM orders WHERE idempotency_key")) return [...orders.values()].find((o)=>o.idempotency_key===args[0]) || null;
        if (sql.includes("FROM orders WHERE id=?")) return orders.get(args[0]) || null;
        if (sql.includes("FROM production_jobs WHERE order_id")) return jobs.get(args[0]) || null;
        if (sql.includes("FROM production_devices WHERE token_sha256")) return [...devices.values()].find((d)=>d.token_sha256===args[0]&&d.active===1) || null;
        if (sql.includes("SELECT status,quantity,quantity_completed FROM orders")) { const o=orders.get(args[0]); return o ? {status:o.status,quantity:o.quantity,quantity_completed:o.quantity_completed}:null; }
        if (sql.includes("SELECT status FROM orders")) return orders.has(args[0]) ? {status:orders.get(args[0]).status} : null;
        return null;
      },
      all: async () => ({results:sql.includes("FROM production_devices")?[...devices.values()]:sql.includes("FROM production_batches WHERE order_id=?")?[...productionBatches.values()].filter((b)=>b.order_id===args[0]).sort((a,b)=>a.batch_number-b.batch_number).map((b)=>({batchNumber:b.batch_number,quantity:b.quantity,note:b.note,createdAt:b.created_at})):[]})
    })};
  }
  async batch(statements) { const results=[];for(const statement of statements)results.push(await statement.run());return results; }
}
const db = new FakeDb();
const r2 = {
  put: async (key, value, options={}) => objects.set(key,{bytes:Buffer.from(value),httpMetadata:options.httpMetadata}),
  delete: async (key) => objects.delete(key),
  head: async (key) => objects.has(key) ? {etag:"test"} : null,
  get: async (key) => {
    const object=objects.get(key);
    if(object)return {arrayBuffer:async()=>object.bytes.buffer.slice(object.bytes.byteOffset,object.bytes.byteOffset+object.bytes.byteLength),body:new Blob([object.bytes]).stream(),httpMetadata:object.httpMetadata};
    const model=modelFiles.get(key);
    return model ? {arrayBuffer:async()=>model.buffer.slice(model.byteOffset,model.byteOffset+model.byteLength),body:new Blob([model]).stream(),httpMetadata:{contentType:"model/3mf"}} : null;
  }
};
let backupFailNext=false;
const backup = {
  put: async (key,value,options={}) => { if (backupFailNext) { backupFailNext=false; throw new Error("simulated backup write error"); } backupObjects.set(key,{bytes:Buffer.from(value),httpMetadata:options.httpMetadata}); },
  delete: async (key) => backupObjects.delete(key),
  head: async (key) => (backupObjects.has(key)||modelFiles.has(key)) ? {etag:"backup"} : null
};
const env = { DB:db,PRIVATE_ASSETS:r2,MODEL_BUCKET:r2,BACKUP_BUCKET:backup,PARTNER_ORDER_TOKEN:token,ADMIN_REVIEW_TOKEN:adminToken,SNAPINK_LOCAL_E2E:"true" };
function makeRequest(data, auth=token) { return new Request("https://snapink.test/api/orders",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer "+auth}:{})},body:JSON.stringify(data)}); }
function orderPayload(variant,size,key,custom=true) {
  const edge=[71.52,80.21,88.9,97.59,106.28,114.97][size];
  const center=(-3.2+edge)/2;
  const posX=(center+12.725)/(edge+12.725)*100;
  const usableMin=-3.2+0.4+1.05, usableMax=edge-1.05;
  const logoX=(center-usableMin)/(usableMax-usableMin)*100;
  const text=custom?"sample":"";
  return {customer:{name:"E2E Test Partner",email:"test@example.invalid",phone:""},quantity:2,draft:{size,variant,text,font:"Impact, Arial Black, system-ui, sans-serif",fontSize:396,fontWeight:300,tracking:0,lineHeight:1,fill:"#FFFFFF",stroke:"#000000",strokeWidth:0,styleMode:"emboss",arc:0,posX,posY:50,align:"center",safeMargin:6,bgType:"vector",backgroundColor:"#000000",logoX,logoY:50,logoScale:100,logoOpacity:100,productionGeometryVersion:"blank-flap-candidate-v1",positioningVersion:"cad-flap-valley-to-right-edge-v1",brandingCenterXmm:center,artworkCenterXmm:center,hasCustomArtwork:custom},files:{artworkSvg:custom?svgData:"data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>').toString("base64"),previewPng:pngData,sourceArtwork:custom?pngData:"data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>').toString("base64")},idempotencyKey:key};
}
async function jsonResponse(response) { return response.json(); }

test("order submissions remain partner-only and reject malformed production selections", async()=>{
  const unauthorized=await submitOrder({request:makeRequest(orderPayload("standard",0,"unauthorized-key-0001"),null),env});
  assert.equal(unauthorized.status,401);
  for(const payload of [orderPayload("bad",0,"invalid-variant-0001"),orderPayload("standard",6,"invalid-size-000001"),{...orderPayload("standard",0,"invalid-design-0001"),draft:{...orderPayload("standard",0,"invalid-design-000001").draft,fontSize:9999}}]) {
    const response=await submitOrder({request:makeRequest(payload),env});
    assert.equal(response.status,400);
  }
  const obsolete=orderPayload("standard",0,"obsolete-coordinate-system");delete obsolete.draft.positioningVersion;
  assert.equal((await submitOrder({request:makeRequest(obsolete),env})).status,400);
});

test("Studio SVG allows local clip references but rejects remote URL references", async()=>{
  const payload=orderPayload("billboard",0,"svg-reference-check-001");
  payload.files.artworkSvg="data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><clipPath id="clip"><path d="M0 0h10v10H0z"/></clipPath></defs><path d="M0 0h10v10H0z" fill="#ffffff" clip-path="url(#clip)"/></svg>').toString("base64");
  const allowed=await submitOrder({request:makeRequest(payload),env});
  assert.equal(allowed.status,201);
  const unsafe=orderPayload("billboard",0,"svg-external-url-check-01");
  unsafe.files.artworkSvg="data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="url(https://example.invalid/payload.svg#paint)"/></svg>').toString("base64");
  const rejected=await submitOrder({request:makeRequest(unsafe),env});
  assert.equal(rejected.status,400);
});

test("Studio FileReader SVG data URLs with UTF-8 charset metadata are accepted",async()=>{
  const payload=orderPayload("billboard",4,"svg-charset-check-0001");
  const svgBytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><path d="M50 5 L95 55 L5 55 Z" fill="#ffffff" fill-rule="evenodd"/></svg>');
  payload.files.artworkSvg="data:image/svg+xml;charset=utf-8;base64,"+svgBytes.toString("base64");
  payload.files.sourceArtwork=payload.files.artworkSvg;
  const response=await submitOrder({request:makeRequest(payload),env});
  assert.equal(response.status,201);
});


test("an unavailable backup store rejects the order and cleans partial copies",async()=>{
  const beforeOrders=orders.size,beforePrimary=objects.size,beforeBackup=backupObjects.size;
  backupFailNext=true;
  const response=await submitOrder({request:makeRequest(orderPayload("standard",1,"backup-failure-0001")),env});
  assert.equal(response.status,500);
  assert.equal(orders.size,beforeOrders);assert.equal(objects.size,beforePrimary);assert.equal(backupObjects.size,beforeBackup);
});

test("all 12 blank and 12 customized candidate orders map to their matching 3MF", async()=>{
  assert.equal(manifest.models.length,12);
  const ordersAtStart=orders.size,jobsAtStart=jobs.size;
  for(const entry of manifest.models) {
    for(const custom of [false,true]) {
      const key=`integration-${entry.variant}-${entry.size}-${custom?"custom":"blank"}-0001`;
      const payload=orderPayload(entry.variant,entry.size,key,custom);
      const created=await submitOrder({request:makeRequest(payload),env});
      assert.equal(created.status,201);
      const {order}=await jsonResponse(created);const stored=orders.get(order.id);
      assert.equal(stored.variant,entry.variant);assert.equal(stored.size,entry.size);assert.equal(stored.status,"new");
      assert.equal(JSON.parse(stored.draft_json).hasCustomArtwork,custom);
      assert.equal(JSON.parse(stored.draft_json).brandingCenterXmm,(-3.2+[71.52,80.21,88.9,97.59,106.28,114.97][entry.size])/2);
      const before=objects.size,backupBefore=backupObjects.size;
      const duplicate=await submitOrder({request:makeRequest(payload),env});
      assert.equal(duplicate.status,200);assert.equal((await jsonResponse(duplicate)).order.id,order.id);
      assert.equal(objects.size,before);assert.equal(backupObjects.size,backupBefore);
      assert.ok(objects.has(stored.artwork_key)&&objects.has(stored.preview_key)&&objects.has(stored.source_artwork_key));
      assert.ok(backupObjects.has(stored.artwork_key)&&backupObjects.has(stored.preview_key)&&backupObjects.has(stored.source_artwork_key));
      stored.status="ready";
      const request=()=>new Request("https://snapink.test/api/admin/start-order",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({orderId:order.id})});
      const started=await startOrder({request:request(),env});assert.equal(started.status,202);
      const {job}=await jsonResponse(started);assert.equal(job.status,"queued");
      assert.equal(job.modelKey,`models/${entry.variant}/${entry.size}.3mf`);assert.equal(job.modelSha256,entry.sha256);
      assert.equal(jobs.get(order.id).model_sha256,entry.sha256);
      const repeated=await startOrder({request:request(),env});assert.equal(repeated.status,200);
      assert.equal((await jsonResponse(repeated)).job.id,job.id);
    }
  }
  assert.equal(orders.size-ordersAtStart,24);assert.equal(jobs.size-jobsAtStart,24);
});

test("status transitions require review and a manually completed Orca handoff",async()=>{
  const entry=manifest.models[0];
  const created=await submitOrder({request:makeRequest(orderPayload(entry.variant,entry.size,"status-flow-0000001")),env});
  const {order}=await jsonResponse(created);
  async function patch(status){return updateOrder({request:new Request("https://snapink.test/api/admin/orders",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({id:order.id,status})}),env});}
  assert.equal((await patch("in_production")).status,409);
  assert.equal((await patch("in_review")).status,200);
  assert.equal((await patch("ready")).status,200);
  const started=await startOrder({request:new Request("https://snapink.test/api/admin/start-order",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({orderId:order.id})}),env});
  const {job}=await jsonResponse(started); jobs.get(order.id).status="opened";
  assert.equal((await patch("in_production")).status,200);
  assert.equal((await patch("completed")).status,409);
  const account=await updateOrder({request:new Request("https://snapink.test/api/admin/orders",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({id:order.id,quantityCompleted:2})}),env});
  assert.equal(account.status,201);assert.equal(orders.get(order.id).quantity_completed,2);
  assert.equal((await patch("completed")).status,200);
  assert.equal(jobs.get(order.id).status,"completed");
  assert.equal((await patch("shipped")).status,200);
});


test("missing models fail safely and a failed job can be retried without duplicating it",async()=>{
  const entry=manifest.models.find((m)=>m.variant==="billboard"&&m.size===5);
  const created=await submitOrder({request:makeRequest(orderPayload(entry.variant,entry.size,"retry-test-0000001")),env});
  const {order}=await jsonResponse(created);orders.get(order.id).status="ready";
  const adminRequest=(auth=adminToken)=>new Request("https://snapink.test/api/admin/start-order",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer "+auth}:{})},body:JSON.stringify({orderId:order.id})});
  assert.equal((await startOrder({request:adminRequest("wrong"),env})).status,401);
  const modelKey="models/"+entry.variant+"/"+entry.size+".3mf",model=modelFiles.get(modelKey);modelFiles.delete(modelKey);
  assert.equal((await startOrder({request:adminRequest(),env})).status,503);modelFiles.set(modelKey,model);
  const first=await startOrder({request:adminRequest(),env});assert.equal(first.status,202);const job=(await jsonResponse(first)).job;
  jobs.get(order.id).status="failed";
  const retry=await startOrder({request:adminRequest(),env});assert.equal(retry.status,202);const retryJob=(await jsonResponse(retry)).job;
  assert.equal(retryJob.id,job.id);assert.equal(retryJob.attempt,2);assert.equal(jobs.get(order.id).status,"queued");
});


test("companion credentials are one-time, hashed, authenticated, and revocable",async()=>{
  const pair=await pairDevice({request:new Request("https://snapink.test/api/admin/pair-device",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({name:"Test PC"})}),env});
  assert.equal(pair.status,201);const {device,token:deviceToken}=await jsonResponse(pair);
  const saved=devices.get(device.id);assert.equal(saved.name,"Test PC");assert.notEqual(saved.token_sha256,deviceToken);assert.equal(saved.token_sha256,createHash("sha256").update(deviceToken).digest("hex"));
  const poll=await pollNext({request:new Request("https://snapink.test/api/production/next",{headers:{Authorization:"Bearer "+deviceToken}}),env});assert.equal(poll.status,200);assert.equal((await jsonResponse(poll)).device,"Test PC");
  const revoked=await revokeDevice({request:new Request("https://snapink.test/api/admin/pair-device",{method:"DELETE",headers:{"Content-Type":"application/json",Authorization:"Bearer "+adminToken},body:JSON.stringify({id:device.id})}),env});assert.equal(revoked.status,200);
  const denied=await pollNext({request:new Request("https://snapink.test/api/production/next",{headers:{Authorization:"Bearer "+deviceToken}}),env});assert.equal(denied.status,401);
});

test("the active Billboard 3-5 catalog uses corrected continuous-bow/no-cutout projects",()=>{
  const entries=manifest.models.filter((m)=>m.variant==="billboard"&&m.size>=3);
  assert.equal(entries.length,3);
  assert.ok(entries.every((entry)=>entry.file.includes("Blank_Flap_CANDIDATE")));
  assert.ok(entries.every((entry)=>entry.sourceLabel.includes("validation candidate")));
  assert.equal(manifest.geometryVersion,"blank-flap-candidate-v1");
});
