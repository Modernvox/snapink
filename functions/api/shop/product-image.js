import { json } from "../../_lib/orders.js";

export async function onRequestGet({request,env}) {
  if(!env.PRIVATE_ASSETS)return json({error:"Product image storage is unavailable."},503);
  const url=new URL(request.url),key=url.searchParams.get("key")||"",wantThumbnail=url.searchParams.get("variant")==="thumbnail";
  // Studio stores generated galleries with ordered numeric keys; keep the original
  // named keys readable so already-published products continue to load.
  if(!/^shop-products\/studio-[a-f0-9-]{36}\/(?:[1-5]|on-hat|packaging|on-desk)\.png$/.test(key))return json({error:"Product image not found."},404);
  const thumbnailKey=key.replace(/\.png$/,"-thumb.webp"),thumbnail=wantThumbnail?await env.PRIVATE_ASSETS.get(thumbnailKey):null;
  const image=thumbnail||await env.PRIVATE_ASSETS.get(key);
  if(!image)return json({error:"Product image not found."},404);
  const headers=new Headers({"Content-Type":thumbnail?"image/webp":"image/png","Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"});
  image.writeHttpMetadata(headers);
  return new Response(image.body,{headers});
}
