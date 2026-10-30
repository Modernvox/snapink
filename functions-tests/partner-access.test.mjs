import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(entry){const result=await build({entryPoints:[fileURLToPath(new URL(entry,import.meta.url))],bundle:true,write:false,platform:"node",format:"esm"});return import("data:text/javascript;base64,"+Buffer.from(result.outputFiles[0].contents).toString("base64"))}
const portal=await load("../functions/api/partner-portal.js");
const admin=await load("../functions/api/admin/wholesale-partners.js");
const reissue=await load("../functions/api/admin/wholesale-partners/reissue.js");
const {wholesalePartnerFor}=await load("../functions/_lib/wholesale-auth.js");
const partners=new Map(),sessions=new Map(),attempts=new Map(),events=[];
class FakeDb{
  prepare(sql){return{bind:(...args)=>({
    first:async()=>{
      if(sql.includes("RETURNING failed_attempts")){const key=args.join(":");const count=(attempts.get(key)||0)+1;attempts.set(key,count);return{failed_attempts:count}}
      if(sql.includes("SELECT failed_attempts AS failedAttempts"))return{failedAttempts:attempts.get(args.join(":"))||0};
      if(sql.includes("FROM wholesale_partner_sessions s JOIN wholesale_partners p")){const session=sessions.get(args[0]);const partner=session&&partners.get(session.partner_id);return session&&partner&&session.expires_at>args[1]&&partner.access_status==="active"&&(!partner.credential_expires_at||partner.credential_expires_at>args[2])?{id:partner.id,pilotApplicationId:partner.pilot_application_id,businessName:partner.business_name,contactName:partner.contact_name,email:partner.email,phone:partner.phone,accessStatus:partner.access_status}:null}
      if(sql.includes("FROM wholesale_partners WHERE token_sha256")){const partner=[...partners.values()].find((item)=>item.token_sha256===args[0]);return partner?{id:partner.id,businessName:partner.business_name,contactName:partner.contact_name,email:partner.email,phone:partner.phone,accessStatus:partner.access_status,credentialExpiresAt:partner.credential_expires_at}:null}
      if(sql.includes("SELECT access_status AS accessStatus FROM wholesale_partners WHERE id=?")){const partner=partners.get(args[0]);return partner?{accessStatus:partner.access_status}:null}
      if(sql.includes("SELECT access_status AS accessStatus,credential_expires_at AS credentialExpiresAt")){const partner=partners.get(args[0]);return partner?{accessStatus:partner.access_status,credentialExpiresAt:partner.credential_expires_at}:null}
      return null;
    },
    run:async()=>{
      if(sql.includes("INSERT INTO wholesale_partners")){const[id,pilotId,businessName,contactName,email,hash,createdAt,updatedAt,expiresAt]=args;if([...partners.values()].some((item)=>item.pilot_application_id===pilotId))throw new Error("UNIQUE pilot_application_id");partners.set(id,{id,pilot_application_id:pilotId,business_name:businessName,contact_name:contactName,email,phone:null,token_sha256:hash,access_status:"active",credential_expires_at:expiresAt,last_login_at:null,last_seen_at:null,origin:"admin",created_at:createdAt,updated_at:updatedAt})}
      else if(sql.includes("INSERT INTO wholesale_partner_sessions")){const[hash,partnerId,createdAt,lastSeenAt,expiresAt]=args;sessions.set(hash,{session_sha256:hash,partner_id:partnerId,created_at:createdAt,last_seen_at:lastSeenAt,expires_at:expiresAt})}
      else if(sql.includes("UPDATE wholesale_partners SET last_login_at")){const[loginAt,lastSeenAt,id]=args;const partner=partners.get(id);if(partner)Object.assign(partner,{last_login_at:loginAt,last_seen_at:lastSeenAt})}
      else if(sql.includes("UPDATE wholesale_partner_sessions SET last_seen_at")){const[seenAt,hash]=args;const session=sessions.get(hash);if(session)session.last_seen_at=seenAt}
      else if(sql.includes("UPDATE wholesale_partners SET last_seen_at")){const[seenAt,id]=args;const partner=partners.get(id);if(partner)partner.last_seen_at=seenAt}
      else if(sql.includes("UPDATE wholesale_partners SET access_status=?,credential_expires_at=?,updated_at=?")){const[status,expiresAt,updatedAt,id,oldStatus]=args,partner=partners.get(id);if(partner&&partner.access_status===oldStatus)Object.assign(partner,{access_status:status,credential_expires_at:expiresAt,updated_at:updatedAt});else return{meta:{changes:0}}}
      else if(sql.includes("UPDATE wholesale_partners SET token_sha256=?,access_status='active'")){const[hash,expiresAt,updatedAt,id]=args,partner=partners.get(id);if(partner)Object.assign(partner,{token_sha256:hash,access_status:"active",credential_expires_at:expiresAt,updated_at:updatedAt})}
      else if(sql.includes("DELETE FROM wholesale_partner_sessions WHERE partner_id=?")){for(const[key,value]of sessions)if(value.partner_id===args[0])sessions.delete(key)}
      else if(sql.includes("DELETE FROM wholesale_partner_sessions WHERE session_sha256=?"))sessions.delete(args[0]);
      else if(sql.includes("INSERT INTO wholesale_partner_events"))events.push(args);
      return{meta:{changes:1}};
    },
    all:async()=>({results:[...partners.values()].map((p)=>({id:p.id,businessName:p.business_name,contactName:p.contact_name,email:p.email,accessStatus:p.access_status,credentialExpiresAt:p.credential_expires_at,lastLoginAt:p.last_login_at,origin:p.origin,createdAt:p.created_at,status:p.access_status==="revoked"?"revoked":p.credential_expires_at&&p.credential_expires_at<=new Date().toISOString()?"expired":p.access_status==="suspended"?"inactive":p.last_login_at?"active":"pending"}))})
  })}}
  async batch(statements){const out=[];for(const statement of statements)out.push(await statement.run());return out}
}
const db=new FakeDb(),env={DB:db,ADMIN_REVIEW_TOKEN:"synthetic-admin-review-token"};
const adminRequest=(path,method="GET",body)=>new Request("https://snapbacksleeves.test"+path,{method,headers:{Authorization:"Bearer "+env.ADMIN_REVIEW_TOKEN,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
const codeLogin=(code,ip="192.0.2.20")=>new Request("https://snapbacksleeves.test/api/partner-portal",{method:"POST",headers:{Origin:"https://snapbacksleeves.test","Content-Type":"application/json","CF-Connecting-IP":ip},body:JSON.stringify({code})});
const json=async response=>response.json();
async function createPartner(name,email,expirationDate=null){const response=await admin.onRequestPost({request:adminRequest("/api/admin/wholesale-partners","POST",{businessName:name,email,expirationDate}),env});assert.equal(response.status,201);return response.json()}
function requestWithCookie(cookie,path="/api/partner-portal"){return new Request("https://snapbacksleeves.test"+path,{headers:{Cookie:cookie}})}

test("admin-created one-time code authenticates a session without storing the plaintext code",async()=>{
  const created=await createPartner("Synthetic Test Partner","synthetic@example.test");const partner=partners.get(created.partner.id);
  assert.match(created.accessCode,/^snp_[a-f0-9]{64}$/);assert.notEqual(partner.token_sha256,created.accessCode);assert.equal(partner.token_sha256.length,64);
  const list=await json(await admin.onRequestGet({request:adminRequest("/api/admin/wholesale-partners"),env}));assert.equal(list.partners[0].status,"pending");assert.equal(JSON.stringify(list).includes(created.accessCode),false);assert.equal(JSON.stringify(list).includes("token_sha256"),false);
  const login=await portal.onRequestPost({request:codeLogin(created.accessCode),env});assert.equal(login.status,200);const cookie=login.headers.get("set-cookie");assert.match(cookie,/__Host-snapink_partner=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Path=\//);
  const value=cookie.split(";")[0],session=list=>(list.split("=")[1]);assert.ok(session(value).length>=64);
  const auth=await wholesalePartnerFor(requestWithCookie(value),env);assert.equal(auth.id,created.partner.id);assert.equal(partner.last_login_at!==null,true);
  const status=await json(await portal.onRequestGet({request:requestWithCookie(value),env}));assert.equal(status.authenticated,true);assert.equal(status.partner.businessName,"Synthetic Test Partner");
  const forbidden=await admin.onRequestGet({request:requestWithCookie(value,"/api/admin/wholesale-partners"),env});assert.equal(forbidden.status,401);
  const other=await createPartner("Synthetic Isolated Partner","other@example.test"),otherLogin=await portal.onRequestPost({request:codeLogin(other.accessCode,"192.0.2.28"),env}),otherCookie=otherLogin.headers.get("set-cookie").split(";")[0];assert.equal((await wholesalePartnerFor(requestWithCookie(otherCookie),env)).id,other.partner.id);assert.notEqual((await wholesalePartnerFor(requestWithCookie(otherCookie),env)).id,auth.id);
});

test("generic rejection, expiry, rotation, deactivation, revocation and logout invalidate sessions",async()=>{
  const created=await createPartner("Synthetic Rotation Partner","rotation@example.test");const id=created.partner.id,oldCode=created.accessCode;
  const invalid=await portal.onRequestPost({request:codeLogin("snp_"+"0".repeat(64),"192.0.2.21"),env});assert.equal(invalid.status,401);assert.equal((await json(invalid)).error,"Access code not recognized or inactive.");
  const login=await portal.onRequestPost({request:codeLogin(oldCode,"192.0.2.22"),env});const oldCookie=login.headers.get("set-cookie").split(";")[0];assert.ok(await wholesalePartnerFor(requestWithCookie(oldCookie),env));
  const replacement=await reissue.onRequestPost({request:adminRequest("/api/admin/wholesale-partners/reissue","POST",{partnerId:id}),env});assert.equal(replacement.status,200);const newCode=(await json(replacement)).accessCode;assert.notEqual(newCode,oldCode);assert.equal(await wholesalePartnerFor(requestWithCookie(oldCookie),env),null);
  assert.equal((await portal.onRequestPost({request:codeLogin(oldCode,"192.0.2.23"),env})).status,401);
  const nextLogin=await portal.onRequestPost({request:codeLogin(newCode,"192.0.2.24"),env});const newCookie=nextLogin.headers.get("set-cookie").split(";")[0];assert.ok(await wholesalePartnerFor(requestWithCookie(newCookie),env));
  await admin.onRequestPatch({request:adminRequest("/api/admin/wholesale-partners","PATCH",{partnerId:id,accessStatus:"suspended"}),env});assert.equal(await wholesalePartnerFor(requestWithCookie(newCookie),env),null);
  assert.equal((await portal.onRequestPost({request:codeLogin(newCode,"192.0.2.25"),env})).status,401);
  const revokedReplacement=await admin.onRequestPost({request:adminRequest("/api/admin/wholesale-partners/reissue","POST",{partnerId:id}),env});const revokedCode=(await json(revokedReplacement)).accessCode;
  await admin.onRequestPatch({request:adminRequest("/api/admin/wholesale-partners","PATCH",{partnerId:id,accessStatus:"revoked"}),env});
  const list=await admin.onRequestGet({request:adminRequest("/api/admin/wholesale-partners"),env});assert.equal((await json(list)).partners.find((p)=>p.id===id).status,"revoked");
  const revokedLogin=await portal.onRequestPost({request:codeLogin(revokedCode,"192.0.2.26"),env});assert.equal(revokedLogin.status,401);
  const third=await createPartner("Synthetic Logout Partner","logout@example.test");const successful=await portal.onRequestPost({request:codeLogin(third.accessCode,"192.0.2.27"),env}),cookie=successful.headers.get("set-cookie").split(";")[0];
  assert.ok(await wholesalePartnerFor(requestWithCookie(cookie),env));const logout=await portal.onRequestDelete({request:new Request("https://snapbacksleeves.test/api/partner-portal",{method:"DELETE",headers:{Origin:"https://snapbacksleeves.test",Cookie:cookie}}),env});assert.equal(logout.status,200);assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);assert.equal(await wholesalePartnerFor(requestWithCookie(cookie),env),null);
});

test("expired access code and rate-limited guesses are rejected",async()=>{
  const created=await createPartner("Synthetic Expiry Partner","expiry@example.test");partners.get(created.partner.id).credential_expires_at="2000-01-01T00:00:00.000Z";
  assert.equal((await portal.onRequestPost({request:codeLogin(created.accessCode,"192.0.2.30"),env})).status,401);
  const live=await createPartner("Synthetic Session Expiry Partner","session-expiry@example.test"),liveLogin=await portal.onRequestPost({request:codeLogin(live.accessCode,"192.0.2.32"),env}),liveCookie=liveLogin.headers.get("set-cookie").split(";")[0];assert.ok(await wholesalePartnerFor(requestWithCookie(liveCookie),env));partners.get(live.partner.id).credential_expires_at="2000-01-01T00:00:00.000Z";assert.equal(await wholesalePartnerFor(requestWithCookie(liveCookie),env),null);
  for(let index=0;index<10;index++)await portal.onRequestPost({request:codeLogin("bad-code-"+index,"192.0.2.31"),env});
  const limited=await portal.onRequestPost({request:codeLogin("bad-code-final","192.0.2.31"),env});assert.equal(limited.status,429);
});
