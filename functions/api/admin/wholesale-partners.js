import { bearer, digest, json, now, randomId, validEmail } from "../../_lib/orders.js";

function expiryFrom(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid expiration date.");
  const date = new Date(`${value}T23:59:59.999Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error("Choose a valid expiration date.");
  if (date.getTime() <= Date.now()) throw new Error("Expiration date must be today or later.");
  return date.toISOString();
}

function newAccessCode() { return `snp_${randomId(32)}`; }
function adminAuthorized(request, env) { return bearer(request, env.ADMIN_REVIEW_TOKEN); }

export async function onRequestGet({ request, env }) {
  if (!adminAuthorized(request,env)) return json({error:"Unauthorized"},401);
  if (!env.DB) return json({error:"Partner access storage is unavailable."},503);
  try {
    const {results}=await env.DB.prepare(`SELECT id,business_name AS businessName,contact_name AS contactName,email,
      access_status AS accessStatus,credential_expires_at AS credentialExpiresAt,last_login_at AS lastLoginAt,
      origin,created_at AS createdAt,
      CASE WHEN access_status='revoked' THEN 'revoked'
        WHEN credential_expires_at IS NOT NULL AND credential_expires_at<=? THEN 'expired'
        WHEN access_status='suspended' THEN 'inactive'
        WHEN last_login_at IS NULL THEN 'pending'
        ELSE 'active' END AS status
      FROM wholesale_partners ORDER BY created_at DESC LIMIT 500`).bind(now()).all();
    return json({partners:results||[]});
  } catch(error) {
    console.error("Partner access list failed",error instanceof Error?error.message:"unknown");
    return json({error:"Partner access storage is not initialized. Apply the latest D1 migrations."},503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!adminAuthorized(request,env)) return json({error:"Unauthorized"},401);
  if (!env.DB) return json({error:"Partner access storage is unavailable."},503);
  try {
    const body=await request.json();
    const businessName=typeof body.businessName==="string"?body.businessName.trim().replace(/\s+/g," "):"";
    const email=typeof body.email==="string"?body.email.trim().toLowerCase():"";
    if (!businessName||businessName.length>120||/[<>\u0000-\u001f]/.test(businessName)) return json({error:"Enter a valid company name (up to 120 characters)."},400);
    if (!validEmail(email)) return json({error:"Enter a valid contact email address."},400);
    let credentialExpiresAt;
    try { credentialExpiresAt=expiryFrom(body.expirationDate); } catch(error) { return json({error:error.message},400); }
    const id=randomId(16), accessCode=newAccessCode(), tokenHash=await digest(accessCode), time=now();
    // The legacy partner schema requires a unique application ID. A negative random ID marks this admin-created account without creating a fake public pilot application.
    const randomApplicationId=-(Number.parseInt(randomId(4),16)%2147483646+1);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO wholesale_partners
        (id,pilot_application_id,business_name,contact_name,email,phone,token_sha256,access_status,created_at,updated_at,credential_expires_at,last_login_at,origin)
        VALUES(?,?,?,?,?,NULL,?,'active',?,?,?,NULL,'admin')`)
        .bind(id,randomApplicationId,businessName,businessName,email,tokenHash,time,time,credentialExpiresAt),
      env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,'access_issued',NULL,'active',?)")
        .bind(id,"admin",time),
    ]);
    return json({ok:true,partner:{id,businessName,email,accessStatus:"active",status:"pending",credentialExpiresAt,lastLoginAt:null,origin:"admin"},accessCode},201);
  } catch(error) {
    console.error("Partner creation failed",error instanceof Error?error.message:"unknown");
    return json({error:String(error).includes("pilot_application_id")?"Could not create the partner record. Please try again.":"Could not create partner access."},500);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!adminAuthorized(request,env)) return json({error:"Unauthorized"},401);
  if (!env.DB) return json({error:"Partner access storage is unavailable."},503);
  try {
    const body=await request.json();
    if(typeof body.partnerId!=="string"||!/^[a-f0-9]{32}$/.test(body.partnerId))return json({error:"Choose a valid partner record."},400);
    if(body.accessStatus!=null&&!["active","suspended","revoked"].includes(body.accessStatus))return json({error:"Choose active, deactivated, or revoked access."},400);
    let hasExpiry=Object.prototype.hasOwnProperty.call(body,"expirationDate"),credentialExpiresAt;
    if(hasExpiry){try{credentialExpiresAt=expiryFrom(body.expirationDate)}catch(error){return json({error:error.message},400)}}
    const current=await env.DB.prepare("SELECT access_status AS accessStatus,credential_expires_at AS credentialExpiresAt FROM wholesale_partners WHERE id=?").bind(body.partnerId).first();
    if(!current)return json({error:"Partner not found."},404);
    const nextStatus=body.accessStatus||current.accessStatus;
    if(current.accessStatus==="revoked"&&nextStatus!=="revoked")return json({error:"Revoked codes cannot be reactivated. Generate a replacement code instead."},409);
    const nextExpiry=hasExpiry?credentialExpiresAt:current.credentialExpiresAt;
    if(nextStatus==="active"&&nextExpiry&&Date.parse(nextExpiry)<=Date.now())return json({error:"This code has expired. Generate a replacement code or set a future expiration date first."},409);
    if(nextStatus===current.accessStatus&&nextExpiry===current.credentialExpiresAt)return json({ok:true,partnerId:body.partnerId,accessStatus:nextStatus,credentialExpiresAt:nextExpiry});
    const time=now();
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE wholesale_partners SET access_status=?,credential_expires_at=?,updated_at=? WHERE id=? AND access_status=?")
        .bind(nextStatus,nextExpiry,time,body.partnerId,current.accessStatus),
      env.DB.prepare("DELETE FROM wholesale_partner_sessions WHERE partner_id=?").bind(body.partnerId),
      env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,?,?,?,?)")
        .bind(body.partnerId,"admin",nextStatus!==current.accessStatus?`access_${nextStatus}`:"credential_expiration_updated",current.accessStatus,nextStatus,time),
    ]);
    if(!results?.[0]?.meta?.changes)return json({error:"Partner access changed in another session. Refresh and retry."},409);
    return json({ok:true,partnerId:body.partnerId,accessStatus:nextStatus,credentialExpiresAt:nextExpiry});
  } catch(error) {
    console.error("Partner access update failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not update partner access."},500);
  }
}
