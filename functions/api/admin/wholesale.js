import { bearer, json, now } from "../../_lib/orders.js";
import { WHOLESALE_STATUSES } from "../../_lib/wholesale.js";

const LIST_SQL=`SELECT o.id,o.order_number AS orderNumber,o.partner_id AS partnerId,p.business_name AS partnerBusinessName,
  o.business_name AS businessName,o.contact_name AS contactName,o.email,o.phone,o.total_quantity AS totalQuantity,
  o.pricing_tier AS pricingTier,o.merchandise_subtotal_cents AS merchandiseSubtotalCents,
  o.lead_time_label AS leadTimeLabel,o.status,o.custom_review_required AS customReviewRequired,
  o.customization_quote_status AS customizationQuoteStatus,
  o.special_instructions AS specialInstructions,o.admin_notes AS adminNotes,o.partner_notes AS partnerNotes,
  o.shipping_address_json AS shippingAddress,o.billing_address_json AS billingAddress,
  o.same_as_shipping AS sameAsShipping,o.created_at AS createdAt,o.updated_at AS updatedAt
  FROM wholesale_orders o JOIN wholesale_partners p ON p.id=o.partner_id`;

async function itemsFor(env,orderId){
  const {results}=await env.DB.prepare(`SELECT id,line_number AS lineNumber,size,quantity,design_type AS designType,
    design_id AS designId,design_reference AS designReference,design_notes AS designNotes,
    sleeve_style AS sleeveStyle,base_color_id AS baseColorId,base_color_snapshot_json AS baseColorSnapshotJson,
    artwork_colors_json AS artworkColorsJson,wholesale_design_id AS wholesaleDesignId,design_version AS designVersion,
    design_snapshot_json AS designSnapshotJson,preview_key AS previewKey,customization_quote_status AS customizationQuoteStatus,
    artwork_svg_key AS artworkSvgKey,artwork_svg_sha256 AS artworkSvgSha256,source_artwork_key AS sourceArtworkKey,
    source_artwork_sha256 AS sourceArtworkSha256,geometry_version AS geometryVersion,positioning_version AS positioningVersion,
    artwork_name AS artworkName,artwork_key AS artworkKey,unit_price_cents AS unitPriceCents,
    subtotal_cents AS subtotalCents,review_required AS reviewRequired
    FROM wholesale_order_items WHERE order_id=? ORDER BY line_number`).bind(orderId).all();
  return results||[];
}

export async function onRequestGet({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Wholesale order storage is unavailable."},503);
  try{
    const url=new URL(request.url),id=url.searchParams.get("id"),q=(url.searchParams.get("q")||"").trim().slice(0,120),status=url.searchParams.get("status")||"";
    if(status&&!WHOLESALE_STATUSES.includes(status))return json({error:"Invalid wholesale status filter."},400);
    if(id){const order=await env.DB.prepare(`${LIST_SQL} WHERE o.id=?`).bind(id).first();if(!order)return json({error:"Wholesale order not found."},404);order.shippingAddress=JSON.parse(order.shippingAddress);order.billingAddress=JSON.parse(order.billingAddress);const [items,history]=await Promise.all([itemsFor(env,id),env.DB.prepare(`SELECT actor_type AS actorType,actor_id AS actorId,event_type AS eventType,from_status AS fromStatus,to_status AS toStatus,detail_json AS detailJson,created_at AS createdAt FROM wholesale_order_events WHERE order_id=? ORDER BY created_at`).bind(id).all()]);return json({order,items,history:history.results||[]})}
    const pattern=`%${q}%`;
    const {results}=await env.DB.prepare(`${LIST_SQL} WHERE (?='' OR o.status=?) AND (?='' OR o.order_number LIKE ? OR o.business_name LIKE ? OR o.email LIKE ? OR p.business_name LIKE ?) ORDER BY o.created_at DESC LIMIT 300`)
      .bind(status,status,q,pattern,pattern,pattern,pattern).all();
    return json({orders:results||[]});
  }catch(error){console.error("Admin wholesale order list failed",error instanceof Error?error.message:"unknown");return json({error:"Wholesale orders are temporarily unavailable."},503)}
}

export async function onRequestPatch({request,env}){
  if(!bearer(request,env.ADMIN_REVIEW_TOKEN))return json({error:"Unauthorized"},401);
  if(!env.DB)return json({error:"Wholesale order storage is unavailable."},503);
  try{
    const body=await request.json();
    if(typeof body.id!=="string")return json({error:"Wholesale order ID is required."},400);
    if(body.status!=null&&!WHOLESALE_STATUSES.includes(body.status))return json({error:"Choose a supported wholesale request status."},400);
    const adminNotes=body.adminNotes==null?null:(typeof body.adminNotes==="string"?body.adminNotes.trim():null);
    const partnerNotes=body.partnerNotes==null?null:(typeof body.partnerNotes==="string"?body.partnerNotes.trim():null);
    if((body.adminNotes!=null&&adminNotes==null)||(body.partnerNotes!=null&&partnerNotes==null)||adminNotes?.length>5000||partnerNotes?.length>3000)return json({error:"Order notes are invalid or too long."},400);
    if(body.customizationQuoteStatus!=null&&!['not_required','pending_quote','confirmed'].includes(body.customizationQuoteStatus))return json({error:"Choose a supported customization quote status."},400);
    const leadTimeLabel=body.leadTimeLabel==null?null:(typeof body.leadTimeLabel==="string"?body.leadTimeLabel.trim():null);
    if((body.leadTimeLabel!=null&&leadTimeLabel==null)||leadTimeLabel?.length>120)return json({error:"Lead-time override must be 120 characters or fewer."},400);
    const current=await env.DB.prepare("SELECT status,admin_notes AS adminNotes,partner_notes AS partnerNotes,customization_quote_status AS customizationQuoteStatus,lead_time_label AS leadTimeLabel,updated_at AS updatedAt FROM wholesale_orders WHERE id=?").bind(body.id).first();
    if(!current)return json({error:"Wholesale order not found."},404);
    if(current.status==="cancelled"&&body.status&&body.status!=="cancelled")return json({error:"Cancelled wholesale requests cannot be reopened. Ask the partner to submit a new request."},409);
    const nextStatus=body.status||current.status,time=now();
    const nextAdmin=adminNotes??current.adminNotes,nextPartner=partnerNotes??current.partnerNotes;
    const nextQuote=body.customizationQuoteStatus??current.customizationQuoteStatus,nextLead=leadTimeLabel??current.leadTimeLabel;
    if(nextQuote!=="pending_quote"&&current.customizationQuoteStatus==="pending_quote"&&nextQuote==="confirmed"){
      const custom=await env.DB.prepare("SELECT COUNT(*) AS count FROM wholesale_order_items WHERE order_id=? AND design_type!='blank'").bind(body.id).first();
      if(!Number(custom?.count))return json({error:"A blank-only request has no customization quote to confirm."},400);
    }
    const events=[env.DB.prepare("UPDATE wholesale_orders SET status=?,admin_notes=?,partner_notes=?,customization_quote_status=?,lead_time_label=?,updated_at=? WHERE id=? AND status=? AND updated_at=?")
      .bind(nextStatus,nextAdmin,nextPartner,nextQuote,nextLead,time,body.id,current.status,current.updatedAt)];
    if(nextStatus!==current.status)events.push(env.DB.prepare(`INSERT INTO wholesale_order_events(order_id,actor_type,actor_id,event_type,from_status,to_status,created_at) VALUES(?,'admin','admin','status_changed',?,?,?)`).bind(body.id,current.status,nextStatus,time));
    if(nextAdmin!==current.adminNotes||nextPartner!==current.partnerNotes)events.push(env.DB.prepare(`INSERT INTO wholesale_order_events(order_id,actor_type,actor_id,event_type,detail_json,created_at) VALUES(?,'admin','admin','notes_updated',?,?)`).bind(body.id,JSON.stringify({adminNotesChanged:nextAdmin!==current.adminNotes,partnerNotesChanged:nextPartner!==current.partnerNotes}),time));
    if(nextQuote!==current.customizationQuoteStatus){events.push(env.DB.prepare("UPDATE wholesale_order_items SET customization_quote_status=? WHERE order_id=?").bind(nextQuote,body.id));events.push(env.DB.prepare(`INSERT INTO wholesale_order_events(order_id,actor_type,actor_id,event_type,detail_json,created_at) VALUES(?,'admin','admin','customization_quote_changed',?,?)`).bind(body.id,JSON.stringify({from:current.customizationQuoteStatus,to:nextQuote}),time))}
    if(nextLead!==current.leadTimeLabel)events.push(env.DB.prepare(`INSERT INTO wholesale_order_events(order_id,actor_type,actor_id,event_type,detail_json,created_at) VALUES(?,'admin','admin','lead_time_overridden',?,?)`).bind(body.id,JSON.stringify({from:current.leadTimeLabel,to:nextLead}),time));
    const results=await env.DB.batch(events);
    if(!results?.[0]?.meta?.changes)return json({error:"This wholesale request changed in another session. Refresh and retry."},409);
    return json({ok:true,id:body.id,status:nextStatus,customizationQuoteStatus:nextQuote,leadTimeLabel:nextLead,updatedAt:time});
  }catch(error){console.error("Admin wholesale order update failed",error instanceof Error?error.message:"unknown");return json({error:"Could not update wholesale request."},500)}
}
