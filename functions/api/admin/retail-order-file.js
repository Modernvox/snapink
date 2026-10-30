import { bearer, digest, json } from "../../_lib/orders.js";

export async function onRequestGet({request,env}) {
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN)) return json({error:"Unauthorized"},401);
  if(!env.DB||!env.PRIVATE_ASSETS) return json({error:"Private retail order storage is unavailable."},503);
  const url=new URL(request.url),id=url.searchParams.get("id"),kind=url.searchParams.get("kind");
  if(!id||!/^[a-f0-9]{32}$/.test(id)||!["preview","artwork","source"].includes(kind)) return json({error:"Provide a valid retail order and file type."},400);
  const order=await env.DB.prepare("SELECT preview_key,preview_sha256,artwork_key,artwork_sha256,source_artwork_key,source_artwork_sha256 FROM retail_orders WHERE id=?").bind(id).first();
  if(!order) return json({error:"Retail order not found."},404);
  const key=kind==="preview"?order.preview_key:kind==="artwork"?order.artwork_key:order.source_artwork_key;
  const expected=kind==="preview"?order.preview_sha256:kind==="artwork"?order.artwork_sha256:order.source_artwork_sha256;
  if(!key) return json({error:"No uploaded source artwork is attached to this order."},404);
  const file=await env.PRIVATE_ASSETS.get(key);
  if(!file) return json({error:"Private order file not found."},404);
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!expected||await digest(bytes)!==expected) return json({error:"The stored order file failed its integrity check."},500);
  const extension=kind==="preview"?"png":kind==="artwork"?"svg":key.split(".").pop();
  return new Response(bytes,{headers:{"Content-Type":file.httpMetadata?.contentType||"application/octet-stream","Content-Disposition":`attachment; filename="${id}-${kind}.${extension}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
