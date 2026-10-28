import { bearer, json, now } from "../../_lib/orders.js";

export async function onRequestPatch({ request, env }) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Wholesale partner storage is unavailable."},503);
  try{
    const body=await request.json();
    if(typeof body.partnerId!=="string"||!["active","suspended","revoked"].includes(body.accessStatus))return json({error:"Provide a partner and active, suspended, or revoked access status."},400);
    const current=await env.DB.prepare("SELECT access_status AS accessStatus FROM wholesale_partners WHERE id=?").bind(body.partnerId).first();
    if(!current)return json({error:"Wholesale partner not found."},404);
    if(current.accessStatus==="revoked"&&body.accessStatus!=="revoked")return json({error:"Revoked access cannot be restored. Issue a new credential from the approved pilot application."},409);
    if(current.accessStatus===body.accessStatus)return json({ok:true,partnerId:body.partnerId,accessStatus:current.accessStatus});
    const time=now();
    const update=await env.DB.prepare("UPDATE wholesale_partners SET access_status=?,updated_at=? WHERE id=? AND access_status=?")
      .bind(body.accessStatus,time,body.partnerId,current.accessStatus).run();
    if(!update.meta?.changes)return json({error:"Partner access changed in another session. Refresh and retry."},409);
    await env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,?,?,?,?)")
      .bind(body.partnerId,"admin",`access_${body.accessStatus}`,current.accessStatus,body.accessStatus,time).run();
    return json({ok:true,partnerId:body.partnerId,accessStatus:body.accessStatus});
  }catch(error){
    console.error("Wholesale partner access update failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not update partner access."},500);
  }
}
