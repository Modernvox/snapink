import { json } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({request,env}){
  const partner=await wholesalePartnerFor(request,env);
  if(!partner)return partnerUnauthorized();
  if(!env.DB||!env.PRIVATE_ASSETS)return json({error:"Private artwork storage is unavailable."},503);
  const id=new URL(request.url).searchParams.get("id");
  if(typeof id!=="string"||id.length>80)return json({error:"Artwork not found."},404);
  try{
    const item=await env.DB.prepare(`SELECT i.artwork_key AS artworkKey,i.artwork_name AS artworkName
      FROM wholesale_order_items i JOIN wholesale_orders o ON o.id=i.order_id
      WHERE i.id=? AND o.partner_id=?`).bind(id,partner.id).first();
    if(!item?.artworkKey)return json({error:"Artwork not found."},404);
    const object=await env.PRIVATE_ASSETS.get(item.artworkKey);
    if(!object)return json({error:"Artwork not found."},404);
    const name=String(item.artworkName||"artwork").replace(/[^a-zA-Z0-9._-]/g,"_");
    return new Response(object.body,{headers:{"Content-Type":object.httpMetadata?.contentType||"application/octet-stream","Content-Disposition":`attachment; filename="${name}"`,"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"}});
  }catch(error){console.error("Wholesale partner artwork copy failed",error instanceof Error?error.message:"unknown");return json({error:"Could not retrieve artwork for this request."},503)}
}
