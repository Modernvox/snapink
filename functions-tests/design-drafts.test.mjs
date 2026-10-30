import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function loadFunction(entry) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
}
const { onRequestPost } = await loadFunction("../functions/api/design-drafts.js");
const { onRequestGet: listDrafts } = await loadFunction("../functions/api/admin/design-drafts.js");
const { onRequestGet: getDraftFile } = await loadFunction("../functions/api/admin/design-draft-file.js");
const drafts = new Map(), limits = new Map(), files = new Map();
class FakeDb {
  prepare(sql) {
    return { bind: (...args) => ({
      first: async () => {
        if (sql.includes("INSERT INTO design_draft_rate_limits")) { const key = args.join(":"); const count = (limits.get(key) || 0) + 1; limits.set(key,count); return {request_count:count}; }
        if (sql.includes("FROM design_drafts WHERE idempotency_key")) return [...drafts.values()].find((draft) => draft.idempotency_key === args[0]) || null;
        if (sql.includes("FROM design_drafts WHERE id=?")) return drafts.get(args[0]) || null;
        return null;
      },
      run: async () => {
        if (sql.includes("INSERT INTO design_drafts")) {
          const [id,reference,idempotency_key,customer_name,customer_email,customer_phone,quantity,variant,size,draft_json,artwork_key,preview_key,source_artwork_key,,created_at,updated_at] = args;
          if ([...drafts.values()].some((draft) => draft.idempotency_key === idempotency_key)) throw new Error("UNIQUE constraint failed: design_drafts.idempotency_key");
          drafts.set(id,{id,reference,idempotency_key,customer_name,customer_email,customer_phone,quantity,variant,size,status:"pending_review",draft_json,artwork_key,preview_key,source_artwork_key,notification_status:"pending",created_at,updated_at});
        } else if (sql.includes("UPDATE design_drafts SET notification_status='sent'")) {
          const [updated_at,id] = args; const draft=drafts.get(id);if(draft)Object.assign(draft,{notification_status:"sent",notification_error:null,updated_at});
        } else if (sql.includes("UPDATE design_drafts SET notification_status='failed'")) {
          const [notification_error,updated_at,id] = args; const draft=drafts.get(id);if(draft)Object.assign(draft,{notification_status:"failed",notification_error,updated_at});
        } else if (sql.includes("DELETE FROM design_draft_rate_limits")) { /* cleanup */ }
        return {meta:{changes:1}};
      },
      all: async () => ({results:[...drafts.values()].map((draft)=>({id:draft.id,reference:draft.reference,customerName:draft.customer_name,customerEmail:draft.customer_email,customerPhone:draft.customer_phone,quantity:draft.quantity,variant:draft.variant,size:draft.size,status:draft.status,draftJson:draft.draft_json,previewKey:draft.preview_key,artworkKey:draft.artwork_key,sourceArtworkKey:draft.source_artwork_key,notificationStatus:draft.notification_status,notificationError:draft.notification_error,createdAt:draft.created_at,updatedAt:draft.updated_at}))})
    })};
  }
}
const bucket = {
  put: async(key,value,options={})=>files.set(key,{bytes:Buffer.from(value),httpMetadata:options.httpMetadata}),
  delete: async(key)=>files.delete(key),
  get: async(key)=>{const file=files.get(key);return file?{body:new Blob([file.bytes]).stream(),httpMetadata:file.httpMetadata}:null;}
};
const env={DB:new FakeDb(),PRIVATE_ASSETS:bucket,ADMIN_REVIEW_TOKEN:"admin-test-token"};
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="1" y="20">Test</text></svg>';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const toData=(mime,bytes)=>`data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
function payload({key="draft-idempotency-key-0001",name="Test Customer",variant="standard",size=0}={}){
  const edge=[71.52,80.21,88.9,97.59,106.28,114.97][size],center=(-3.2+edge)/2,posX=(center+12.725)/(edge+12.725)*100,usableMin=-3.2+0.4+1.05,usableMax=edge-1.05,logoX=(center-usableMin)/(usableMax-usableMin)*100;
  const draft={size,variant,text:"Sample",font:"Impact, Arial Black, system-ui, sans-serif",fontSize:396,fontWeight:300,tracking:0,lineHeight:1,fill:"#FFFFFF",stroke:"#000000",strokeWidth:0,styleMode:"emboss",arc:0,posX,posY:50,align:"center",safeMargin:6,bgType:"vector",backgroundColor:"#000000",logoX,logoY:50,logoScale:100,logoOpacity:100,productionGeometryVersion:"blank-flap-candidate-v1",positioningVersion:"cad-flap-valley-to-right-edge-v1",brandingCenterXmm:center,artworkCenterXmm:center,hasCustomArtwork:true};
  return {customer:{name,email:"customer@example.test",phone:""},quantity:1,draft,files:{artworkSvg:toData("image/svg+xml",svg),previewPng:toData("image/png",png),sourceArtwork:toData("image/png",png)},submittedAt:new Date().toISOString(),idempotencyKey:key};
}
function request(data,{ip="192.0.2.1",auth}={}) { return new Request("https://snapbacksleeves.com/api/design-drafts",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":ip},body:JSON.stringify(data)}); }

 test("public draft intake saves review-only draft and assets when notification is unavailable",async()=>{
  const response=await onRequestPost({request:request(payload()),env}),data=await response.json();
  assert.equal(response.status,201);assert.match(data.draft.reference,/^SD-\d{8}-[A-F0-9]{12}$/);assert.equal(data.draft.status,"pending_review");assert.equal(data.notificationStatus,"failed");
  const saved=[...drafts.values()][0];assert.equal(saved.status,"pending_review");assert.equal(saved.quantity,1);assert.ok(files.has(saved.artwork_key));assert.ok(files.has(saved.preview_key));assert.ok(files.has(saved.source_artwork_key));assert.equal(saved.notification_status,"failed");
 });

test("owner email is sent only after storage and its success state is recorded",async()=>{
  const previousFetch=globalThis.fetch;let emailPayload=null;globalThis.fetch=async(url,options)=>{emailPayload=JSON.parse(options.body);return new Response(JSON.stringify({success:true,result:{delivered:["partners@snapbacksleeves.com"]}}),{status:200,headers:{"Content-Type":"application/json"}})};
  try{
    const configuredEnv={...env,CLOUDFLARE_EMAIL_API_TOKEN:"test-only-token"};const response=await onRequestPost({request:request(payload({key:"draft-email-success-key-001",size:2,variant:"billboard"}),{ip:"192.0.2.77"}),env:configuredEnv});const data=await response.json();
    assert.equal(response.status,201);assert.equal(data.notificationStatus,"sent");assert.equal(emailPayload.to[0],"partners@snapbacksleeves.com");assert.match(emailPayload.text,/design review request, not a production order/);assert.match(emailPayload.text,/admin.html/);
    const saved=[...drafts.values()].find((draft)=>draft.idempotency_key==="draft-email-success-key-001");assert.equal(saved.notification_status,"sent");assert.equal(saved.status,"pending_review");
  }finally{globalThis.fetch=previousFetch}
});

test("draft intake rejects invalid customer, sleeve, artwork and oversized submissions",async()=>{
  const invalidCustomer=payload({key:"draft-idempotency-key-0002"});invalidCustomer.customer.name="   ";
  assert.equal((await onRequestPost({request:request(invalidCustomer,{ip:"192.0.2.2"}),env})).status,400);
  const invalidSize=payload({key:"draft-idempotency-key-0003"});invalidSize.draft.size=6;
  assert.equal((await onRequestPost({request:request(invalidSize,{ip:"192.0.2.3"}),env})).status,400);
  const invalidArtwork=payload({key:"draft-idempotency-key-0004"});invalidArtwork.files.artworkSvg=toData("image/svg+xml","<svg><script>alert(1)</script></svg>");
  assert.equal((await onRequestPost({request:request(invalidArtwork,{ip:"192.0.2.4"}),env})).status,400);
  const tooLarge=new Request("https://snapbacksleeves.com/api/design-drafts",{method:"POST",headers:{"Content-Length":"30000000"}});
  assert.equal((await onRequestPost({request:tooLarge,env})).status,413);
});

test("admin draft list and private downloads require admin credentials",async()=>{
  assert.equal((await listDrafts({request:new Request("https://snapink.test/api/admin/design-drafts"),env})).status,401);
  const response=await listDrafts({request:new Request("https://snapink.test/api/admin/design-drafts",{headers:{Authorization:"Bearer admin-test-token"}}),env});
  assert.equal(response.status,200);assert.ok((await response.json()).drafts.length>0);
  const saved=[...drafts.values()][0];
  const denied=await getDraftFile({request:new Request(`https://snapink.test/api/admin/design-draft-file?id=${saved.id}&kind=preview`),env});assert.equal(denied.status,401);
  const allowed=await getDraftFile({request:new Request(`https://snapink.test/api/admin/design-draft-file?id=${saved.id}&kind=preview`,{headers:{Authorization:"Bearer admin-test-token"}}),env});assert.equal(allowed.status,200);assert.equal(allowed.headers.get("content-type"),"image/png");
});

test("draft intake applies a per-IP rolling-window limit",async()=>{
  for(let index=0;index<8;index++){const data=payload({key:`draft-rate-limit-key-${String(index).padStart(4,"0")}`});const response=await onRequestPost({request:request(data,{ip:"192.0.2.88"}),env});assert.notEqual(response.status,429);}
  const blocked=await onRequestPost({request:request(payload({key:"draft-rate-limit-key-over"}),{ip:"192.0.2.88"}),env});assert.equal(blocked.status,429);
});
