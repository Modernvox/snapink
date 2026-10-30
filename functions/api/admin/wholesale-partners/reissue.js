import { bearer, digest, json, now, randomId } from "../../../_lib/orders.js";

function expiryFrom(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a valid expiration date.");
  const date=new Date(`${value}T23:59:59.999Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getTime()<=Date.now())throw new Error("Choose a future expiration date.");
  return date.toISOString();
}

export async function onRequestPost({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Partner access storage is unavailable."},503);
  try {
    const body=await request.json();
    if(typeof body.partnerId!=="string"||!/^[a-f0-9]{32}$/.test(body.partnerId))return json({error:"Choose a valid partner record."},400);
    let credentialExpiresAt;
    try{credentialExpiresAt=expiryFrom(body.expirationDate)}catch(error){return json({error:error.message},400)}
    const current=await env.DB.prepare("SELECT access_status AS accessStatus FROM wholesale_partners WHERE id=?").bind(body.partnerId).first();
    if(!current)return json({error:"Partner not found."},404);
    const accessCode=`snp_${randomId(32)}`,hash=await digest(accessCode),time=now();
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE wholesale_partners SET token_sha256=?,access_status='active',credential_expires_at=?,updated_at=? WHERE id=?")
        .bind(hash,credentialExpiresAt,time,body.partnerId),
      env.DB.prepare("DELETE FROM wholesale_partner_sessions WHERE partner_id=?").bind(body.partnerId),
      env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,?,?,'active',?)")
        .bind(body.partnerId,"admin",current.accessStatus==="revoked"?"credential_reissued":"credential_rotated",current.accessStatus,time),
    ]);
    if(!results?.[0]?.meta?.changes)return json({error:"Partner access changed in another session. Refresh and retry."},409);
    return json({ok:true,partnerId:body.partnerId,accessStatus:"active",credentialExpiresAt,accessCode});
  }catch(error){
    console.error("Partner code reissue failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not generate a replacement access code."},500);
  }
}
