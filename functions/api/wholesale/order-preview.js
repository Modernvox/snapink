import { json } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized } from "../../_lib/wholesale-auth.js";

export async function onRequestGet({ request, env }) {
  const partner=await wholesalePartnerFor(request,env);if(!partner)return partnerUnauthorized();
  if(!env.DB||!env.PRIVATE_ASSETS)return json({error:"Private design storage is unavailable."},503);
  const id=new URL(request.url).searchParams.get("id");if(!id||id.length>100)return json({error:"Order line not found."},404);
  try{
    const item=await env.DB.prepare(`SELECT i.preview_key AS previewKey FROM wholesale_order_items i
      JOIN wholesale_orders o ON o.id=i.order_id WHERE o.partner_id=? AND i.id=?`).bind(partner.id,id).first();
    if(!item?.previewKey)return json({error:"Order line preview not found."},404);
    const object=await env.PRIVATE_ASSETS.get(item.previewKey);if(!object)return json({error:"Order line preview not found."},404);
    return new Response(object.body,{headers:{"Content-Type":"image/png","Content-Disposition":"inline","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch{return json({error:"Could not retrieve the order preview."},503)}
}
