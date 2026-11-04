import { json } from "../../_lib/orders.js";

export async function onRequestGet({request,env}) {
  if(!env.PRIVATE_ASSETS)return json({error:"Product image storage is unavailable."},503);
  const key=new URL(request.url).searchParams.get("key")||"";
  if(!/^shop-products\/studio-[a-f0-9-]{36}\/(on-hat|packaging|on-desk)\.png$/.test(key))return json({error:"Product image not found."},404);
  const image=await env.PRIVATE_ASSETS.get(key);
  if(!image)return json({error:"Product image not found."},404);
  const headers=new Headers({"Content-Type":"image/png","Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"});
  image.writeHttpMetadata(headers);
  return new Response(image.body,{headers});
}
