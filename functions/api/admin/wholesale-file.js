import { bearer, json } from "../../_lib/orders.js";

export async function onRequestGet({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB||!env.PRIVATE_ASSETS)return json({error:"Private artwork storage is unavailable."},503);
  const url=new URL(request.url),id=url.searchParams.get("id"),kind=url.searchParams.get("kind")==="preview"?"preview":"artwork";
  if(typeof id!=="string"||id.length>80)return json({error:"Wholesale artwork not found."},404);
  try{
    const item=await env.DB.prepare("SELECT artwork_key AS artworkKey,artwork_name AS artworkName,preview_key AS previewKey FROM wholesale_order_items WHERE id=?").bind(id).first();
    const key=kind==="preview"?item?.previewKey:item?.artworkKey;
    if(!key)return json({error:"Wholesale private file not found."},404);
    const object=await env.PRIVATE_ASSETS.get(key);if(!object)return json({error:"Wholesale private file not found."},404);
    const name=String(item.artworkName||"artwork").replace(/[^a-zA-Z0-9._-]/g,"_");
    return new Response(object.body,{headers:{"Content-Type":kind==="preview"?"image/png":object.httpMetadata?.contentType||"application/octet-stream","Content-Disposition":kind==="preview"?"inline":`attachment; filename="${name}"`,"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"}});
  }catch(error){console.error("Admin wholesale artwork download failed",error instanceof Error?error.message:"unknown");return json({error:"Could not retrieve wholesale artwork."},503)}
}
