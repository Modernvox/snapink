import { bearer, digest, json, now, randomId, validEmail } from "../../_lib/orders.js";
import { APPROVED_WHOLESALE_DESIGNS, leadTimeFor, priceWholesaleLines } from "../../_lib/wholesale.js";
import { cleanAddress, cleanText, partnerUnauthorized, validateWholesaleArtwork, wholesalePartnerFor } from "../../_lib/wholesale-auth.js";

const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_LINE_ARTWORKS_BYTES = 20 * 1024 * 1024;

async function readBoundedBody(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader=stream.getReader(),chunks=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();const error=new Error("Order request is too large.");error.status=413;throw error;}chunks.push(value);}
  } finally { reader.releaseLock(); }
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return body;
}

function jsonObject(raw, fallback = null) {
  try { const value = JSON.parse(raw); return value && typeof value === "object" ? value : fallback; } catch { return fallback; }
}

async function orderSummary(db, partnerId, id) {
  return db.prepare(`SELECT id,order_number AS orderNumber,business_name AS businessName,contact_name AS contactName,
    email,phone,shipping_address_json AS shippingAddress,billing_address_json AS billingAddress,
    same_as_shipping AS sameAsShipping,total_quantity AS totalQuantity,pricing_tier AS pricingTier,
    COALESCE((SELECT SUM(i.quantity) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type='blank'),0) AS blankQuantity,
    COALESCE((SELECT SUM(i.quantity) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type!='blank'),0) AS customQuantity,
    COALESCE((SELECT SUM(i.subtotal_cents) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type='blank'),0) AS blankSubtotalCents,
    COALESCE((SELECT SUM(i.subtotal_cents) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type!='blank'),0) AS customSubtotalCents,
    merchandise_subtotal_cents AS merchandiseSubtotalCents,lead_time_code AS leadTimeCode,
    lead_time_label AS leadTimeLabel,status,custom_review_required AS customReviewRequired,
    special_instructions AS specialInstructions,partner_notes AS partnerNotes,customization_quote_status AS customizationQuoteStatus,created_at AS createdAt,updated_at AS updatedAt
    FROM wholesale_orders WHERE partner_id=? AND id=?`).bind(partnerId,id).first();
}

async function orderItems(db, orderId, includePrivate = false) {
  const rows = await db.prepare(`SELECT id,line_number AS lineNumber,size,quantity,design_type AS designType,
    design_id AS designId,design_reference AS designReference,design_notes AS designNotes,
    sleeve_style AS sleeveStyle,base_color_id AS baseColorId,base_color_snapshot_json AS baseColorSnapshotJson,
    artwork_colors_json AS artworkColorsJson,wholesale_design_id AS wholesaleDesignId,design_version AS designVersion,
    design_snapshot_json AS designSnapshotJson,preview_key AS previewKey,customization_quote_status AS customizationQuoteStatus,
    artwork_svg_key AS artworkSvgKey,artwork_svg_sha256 AS artworkSvgSha256,source_artwork_key AS sourceArtworkKey,
    source_artwork_sha256 AS sourceArtworkSha256,geometry_version AS geometryVersion,positioning_version AS positioningVersion,
    ${includePrivate ? "artwork_key AS artworkKey,artwork_sha256 AS artworkSha256,artwork_name AS artworkName," : "artwork_name AS artworkName,"}
    unit_price_cents AS unitPriceCents,subtotal_cents AS subtotalCents,review_required AS reviewRequired
    FROM wholesale_order_items WHERE order_id=? ORDER BY line_number`).bind(orderId).all();
  return rows.results || [];
}

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const order = await orderSummary(env.DB, partner.id, id);
      if (!order) return json({ error:"Wholesale order not found." },404);
      order.shippingAddress = jsonObject(order.shippingAddress,{});
      order.billingAddress = jsonObject(order.billingAddress,{});
      const items = await orderItems(env.DB,order.id);
      for (const item of items) {
        item.baseColor = jsonObject(item.baseColorSnapshotJson,{});
        item.artworkColors = jsonObject(item.artworkColorsJson,[]);
        item.designSnapshot = jsonObject(item.designSnapshotJson,{});
        delete item.baseColorSnapshotJson;
        delete item.artworkColorsJson;
        delete item.designSnapshotJson;
      }
      const events = await env.DB.prepare(`SELECT event_type AS eventType,from_status AS fromStatus,to_status AS toStatus,created_at AS createdAt
        FROM wholesale_order_events WHERE order_id=? AND actor_type IN ('system','admin') ORDER BY created_at`).bind(order.id).all();
      return json({ order,items,events:events.results||[] });
    }
    const rows = await env.DB.prepare(`SELECT id,order_number AS orderNumber,business_name AS businessName,total_quantity AS totalQuantity,
      pricing_tier AS pricingTier,merchandise_subtotal_cents AS merchandiseSubtotalCents,lead_time_label AS leadTimeLabel,
      status,custom_review_required AS customReviewRequired,created_at AS createdAt,updated_at AS updatedAt
      ,COALESCE((SELECT SUM(i.quantity) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type='blank'),0) AS blankQuantity,
      COALESCE((SELECT SUM(i.quantity) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type!='blank'),0) AS customQuantity,
      COALESCE((SELECT SUM(i.subtotal_cents) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type='blank'),0) AS blankSubtotalCents,
      COALESCE((SELECT SUM(i.subtotal_cents) FROM wholesale_order_items i WHERE i.order_id=wholesale_orders.id AND i.design_type!='blank'),0) AS customSubtotalCents
      FROM wholesale_orders WHERE partner_id=? ORDER BY created_at DESC LIMIT 200`).bind(partner.id).all();
    return json({ orders:rows.results||[] });
  } catch (error) {
    console.error("Wholesale partner history read failed",error instanceof Error?error.message:"unknown");
    return json({ error:"Wholesale order history is temporarily unavailable." },503);
  }
}

export async function onRequestPost({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error:"Private wholesale order storage is unavailable." },503);
  const contentLength = Number(request.headers.get("content-length")||0);
  if (contentLength > MAX_REQUEST_BYTES) return json({ error:"Order request is too large." },413);
  let uploadedKeys=[];
  try {
    const bodyBytes=await readBoundedBody(request.body,MAX_REQUEST_BYTES);
    const boundedRequest=new Request(request.url,{method:"POST",headers:request.headers,body:bodyBytes});
    const form=await boundedRequest.formData();
    const raw=form.get("request");
    if(typeof raw!=="string"||new TextEncoder().encode(raw).length>128*1024)return json({error:"Order request is missing or too large."},400);
    let body;try{body=JSON.parse(raw)}catch{return json({error:"Order request is not valid JSON."},400)}
    if(typeof body.idempotencyKey!=="string"||!/^[\w-]{16,80}$/.test(body.idempotencyKey))return json({error:"Order request key is invalid. Refresh and submit again."},400);
    const existing=await env.DB.prepare("SELECT id,order_number AS orderNumber,status,total_quantity AS totalQuantity,merchandise_subtotal_cents AS merchandiseSubtotalCents,created_at AS createdAt FROM wholesale_orders WHERE partner_id=? AND idempotency_key=?").bind(partner.id,body.idempotencyKey).first();
    if(existing)return json({ok:true,duplicate:true,order:existing},200);
    const contact=body.contact&&typeof body.contact==="object"?body.contact:{};
    const businessName=cleanText(contact.businessName,120,true),contactName=cleanText(contact.contactName,120,true);
    const email=cleanText(contact.email,254,true),phone=cleanText(contact.phone||"",40);
    if(!businessName||!contactName||!email||phone==null||!validEmail(email))return json({error:"Enter a valid business name, contact name, email, and phone number."},400);
    const shippingAddress=cleanAddress(body.shippingAddress),billingAddress=body.sameAsShipping===true?shippingAddress:cleanAddress(body.billingAddress);
    if(!shippingAddress||!billingAddress)return json({error:"Complete all required shipping and billing address fields."},400);
    const instructions=cleanText(body.specialInstructions||"",3000);if(instructions==null)return json({error:"Special instructions cannot exceed 3,000 characters."},400);
    if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>50)return json({error:"Add between 1 and 50 order line items."},400);
    let artworkBytes=0;
    const lines=[];
    for(let i=0;i<body.lines.length;i++){
      const rawLine=body.lines[i];
      if(!rawLine||!Number.isInteger(rawLine.size)||!Number.isInteger(rawLine.quantity))return json({error:"Each line needs a sleeve size and whole-number quantity."},400);
      const designType=rawLine.designType;
      if(!["blank","approved_design","custom_branding"].includes(designType))return json({error:"Choose blank sleeves, an approved SnapInk design, or custom branding for each line."},400);
      const designId=cleanText(rawLine.designId||"",100),designReference=cleanText(rawLine.designReference||"",160),designNotes=cleanText(rawLine.designNotes||"",700);
      if(designId==null||designReference==null||designNotes==null)return json({error:`Design details are too long on line ${i+1}.`},400);
      if(designType==="approved_design"&&!APPROVED_WHOLESALE_DESIGNS.some((design)=>design.id===designId))return json({error:`Line ${i+1} selected a SnapInk design that is not in the approved wholesale catalog.`},400);
      const artworkFile=form.get(`artwork_${i}`);let artwork=null;
      if(artworkFile instanceof File&&artworkFile.size){const result=await validateWholesaleArtwork(artworkFile);if(result.error)return json({error:`Line ${i+1}: ${result.error}`},400);artwork=result;artworkBytes+=artwork.bytes.byteLength;if(artworkBytes>MAX_LINE_ARTWORKS_BYTES)return json({error:"Artwork uploads across this order cannot exceed 20 MB."},413)}
      const ref=cleanText(rawLine.studioDesignId||"",120);if(ref==null)return json({error:`Studio design reference is too long on line ${i+1}.`},400);
      const sleeveStyle=rawLine.sleeveStyle==null?null:rawLine.sleeveStyle;
      if(!['standard','billboard'].includes(sleeveStyle))return json({error:`Line ${i+1} must choose Standard or Billboard sleeve style.`},400);
      let color=null,savedDesign=null,artworkColors=[],designSnapshot=null;
      if(rawLine.baseColorId==null)return json({error:`Line ${i+1} must select an available matte TPU base color.`},400);
      {
        if(typeof rawLine.baseColorId!=="string")return json({error:`Line ${i+1} needs an available matte TPU base color.`},400);
        color=await env.DB.prepare(`SELECT id,manufacturer,official_color_name AS name,manufacturer_sku AS sku,preview_hex AS hex,
          material_type AS materialType,finish FROM wholesale_color_catalog WHERE id=? AND availability_status='available' AND admin_enabled=1`).bind(rawLine.baseColorId).first();
        if(!color||!/tpu/i.test(color.materialType)||color.finish.toLowerCase()!=="matte")return json({error:`Line ${i+1} selected a color that is not currently orderable.`},400);
      }
      const wholesaleDesignId=cleanText(rawLine.wholesaleDesignId||"",100);if(wholesaleDesignId==null)return json({error:`Line ${i+1} has an invalid saved Studio design reference.`},400);
      if(wholesaleDesignId){
        savedDesign=await env.DB.prepare(`SELECT id,version,sleeve_style AS sleeveStyle,sleeve_size AS sleeveSize,base_color_id AS baseColorId,
          artwork_colors_json AS artworkColorsJson,draft_json AS draftJson,preview_key AS previewKey,artwork_svg_key AS artworkSvgKey,
          artwork_svg_sha256 AS artworkSvgSha256,preview_sha256 AS previewSha256,source_artwork_key AS sourceArtworkKey,source_artwork_sha256 AS sourceArtworkSha256,
          geometry_version AS geometryVersion,positioning_version AS positioningVersion FROM wholesale_designs WHERE partner_id=? AND id=?`)
          .bind(partner.id,wholesaleDesignId).first();
        if(!savedDesign)return json({error:`Line ${i+1} saved Studio design was not found in this partner account.`},400);
        if(designType!=='custom_branding'||savedDesign.sleeveSize!==rawLine.size||savedDesign.sleeveStyle!==sleeveStyle||savedDesign.baseColorId!==color?.id)return json({error:`Line ${i+1} Studio design configuration does not match its selected size, style, and base color.`},400);
        try{artworkColors=JSON.parse(savedDesign.artworkColorsJson)||[];designSnapshot=JSON.parse(savedDesign.draftJson)}catch{return json({error:`Line ${i+1} saved Studio design snapshot is invalid.`},400)}
        const artworkColorDetails=Array.isArray(designSnapshot.artworkColors)?designSnapshot.artworkColors:[];
        if(artworkColors.length>2||new Set([color.hex.toUpperCase(),...artworkColorDetails.map(value=>String(value.hex||"").toUpperCase()).filter(Boolean)]).size>3)return json({error:`Line ${i+1} exceeds the three-color limit including its base sleeve.`},400);
      } else if(designType==='custom_branding')return json({error:`Line ${i+1} custom sleeves must be saved from SnapInk Studio before ordering.`},400);
      if(Array.isArray(rawLine.artworkColors)&&!savedDesign&&rawLine.artworkColors.length>2)return json({error:`Line ${i+1} exceeds the two additional artwork-color limit.`},400);
      lines.push({size:rawLine.size,quantity:rawLine.quantity,designType,designId,designReference:ref||designReference,designNotes,artwork,
        sleeveStyle,baseColor:color,baseColorSnapshot:color?{...color}:null,wholesaleDesignId:wholesaleDesignId||null,
        designVersion:savedDesign?.version||null,designSnapshot,artworkColors,previewKey:savedDesign?.previewKey||null,
        artworkSvgKey:savedDesign?.artworkSvgKey||null,artworkSvgSha256:savedDesign?.artworkSvgSha256||null,
        sourceArtworkKey:savedDesign?.sourceArtworkKey||null,sourceArtworkSha256:savedDesign?.sourceArtworkSha256||null,geometryVersion:savedDesign?.geometryVersion||null,
        positioningVersion:savedDesign?.positioningVersion||null,customizationQuoteStatus:'not_required',
        reviewRequired:designType!=="blank"||Boolean(ref||designReference||artwork)});
    }
    const pricing=priceWholesaleLines(lines);
    if(pricing.error)return json({error:pricing.error},400);
    const time=now();
    await env.DB.prepare(`INSERT INTO wholesale_submission_limits(partner_id,window_started_at,request_count) VALUES(?,?,1)
      ON CONFLICT(partner_id) DO UPDATE SET
        request_count=CASE WHEN datetime(wholesale_submission_limits.window_started_at,'+1 hour')<=datetime(excluded.window_started_at) THEN 1 ELSE wholesale_submission_limits.request_count+1 END,
        window_started_at=CASE WHEN datetime(wholesale_submission_limits.window_started_at,'+1 hour')<=datetime(excluded.window_started_at) THEN excluded.window_started_at ELSE wholesale_submission_limits.window_started_at END`).bind(partner.id,time).run();
    const rate=await env.DB.prepare("SELECT request_count AS requestCount FROM wholesale_submission_limits WHERE partner_id=?").bind(partner.id).first();
    if(Number(rate?.requestCount)>5)return json({error:"Order request limit reached. Please wait before submitting another request."},429);
    const orderId=randomId(16),orderNumber=`SW-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${orderId.slice(0,8).toUpperCase()}`;
    const lead=leadTimeFor(pricing.totalQuantity)||{code:"to_be_confirmed",label:"Lead time to be confirmed"},needsReview=pricing.lines.some((line)=>line.reviewRequired);
    const preparedLines=[];
    for(let i=0;i<pricing.lines.length;i++){
      const line=pricing.lines[i];let artworkMeta=null,artworkKey=null;
      if(line.artwork){artworkMeta=line.artwork;artworkKey=`wholesale/${orderId}/line-${i+1}/artwork.${artworkMeta.extension}`;await env.PRIVATE_ASSETS.put(artworkKey,artworkMeta.bytes,{httpMetadata:{contentType:artworkMeta.mime}});uploadedKeys.push(artworkKey)}
      preparedLines.push({...line,artworkKey,artworkSha256:artworkMeta?.sha256||null,artworkName:artworkMeta?.name||null});
    }
    const statements=[
      env.DB.prepare(`INSERT INTO wholesale_orders(id,order_number,partner_id,idempotency_key,business_name,contact_name,email,phone,shipping_address_json,billing_address_json,same_as_shipping,total_quantity,pricing_tier,merchandise_subtotal_cents,lead_time_code,lead_time_label,status,custom_review_required,special_instructions,customization_quote_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_review',?,?,?,?,?)`)
        .bind(orderId,orderNumber,partner.id,body.idempotencyKey,businessName,contactName,email.toLowerCase(),phone||null,JSON.stringify(shippingAddress),JSON.stringify(billingAddress),body.sameAsShipping===true?1:0,pricing.totalQuantity,pricing.tier.label,pricing.subtotalCents,lead.code,lead.label,needsReview?1:0,instructions,'not_required',time,time),
      ...preparedLines.map((line,index)=>env.DB.prepare(`INSERT INTO wholesale_order_items(id,order_id,line_number,size,quantity,design_type,design_id,design_reference,design_notes,artwork_key,artwork_sha256,artwork_name,unit_price_cents,subtotal_cents,review_required,sleeve_style,base_color_id,base_color_snapshot_json,artwork_colors_json,wholesale_design_id,design_version,design_snapshot_json,artwork_svg_key,artwork_svg_sha256,source_artwork_key,source_artwork_sha256,geometry_version,positioning_version,preview_key,customization_quote_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(randomId(16),orderId,index+1,line.size,line.quantity,line.designType,line.designId||null,line.designReference,line.designNotes,line.artworkKey,line.artworkSha256,line.artworkName,line.unitPriceCents,line.subtotalCents,line.reviewRequired?1:0,line.sleeveStyle,line.baseColor?.id||null,JSON.stringify(line.baseColorSnapshot||{}),JSON.stringify(line.artworkColors||[]),line.wholesaleDesignId,line.designVersion,line.designSnapshot?JSON.stringify(line.designSnapshot):'{}',line.artworkSvgKey,line.artworkSvgSha256,line.sourceArtworkKey,line.sourceArtworkSha256,line.geometryVersion,line.positioningVersion,line.previewKey,line.customizationQuoteStatus)),
      env.DB.prepare(`INSERT INTO wholesale_order_events(order_id,actor_type,actor_id,event_type,to_status,detail_json,created_at) VALUES(?,'partner',?,'order_submitted','pending_review',?,?)`)
        .bind(orderId,partner.id,JSON.stringify({totalQuantity:pricing.totalQuantity,blankQuantity:pricing.blankQuantity,customQuantity:pricing.customQuantity,blankTier:pricing.tier.blank,customTier:pricing.tier.custom,blankSubtotalCents:pricing.blankSubtotalCents,customSubtotalCents:pricing.customSubtotalCents,pricingTier:pricing.tier.label,merchandiseSubtotalCents:pricing.subtotalCents,customReviewRequired:needsReview}),time),
    ];
    try{await env.DB.batch(statements)}catch(error){await Promise.allSettled(uploadedKeys.map((key)=>env.PRIVATE_ASSETS.delete(key)));uploadedKeys=[];const duplicate=await env.DB.prepare("SELECT id,order_number AS orderNumber,status,total_quantity AS totalQuantity,merchandise_subtotal_cents AS merchandiseSubtotalCents,created_at AS createdAt FROM wholesale_orders WHERE partner_id=? AND idempotency_key=?").bind(partner.id,body.idempotencyKey).first();if(duplicate)return json({ok:true,duplicate:true,order:duplicate},200);throw error}
    const order={id:orderId,orderNumber,status:"pending_review",totalQuantity:pricing.totalQuantity,pricingTier:pricing.tier.label,merchandiseSubtotalCents:pricing.subtotalCents,leadTimeLabel:lead.label,customReviewRequired:needsReview,customizationQuoteStatus:"not_required",createdAt:time};
    await notifyWholesaleOrder(env,{order,lines:preparedLines,contact:{businessName,contactName,email:email.toLowerCase()},shippingAddress,specialInstructions:instructions}).catch(()=>{});
    return json({ok:true,order,pricing:{totalQuantity:pricing.totalQuantity,blankQuantity:pricing.blankQuantity,customQuantity:pricing.customQuantity,blankTier:pricing.tier.blank,customTier:pricing.tier.custom,blankSubtotalCents:pricing.blankSubtotalCents,customSubtotalCents:pricing.customSubtotalCents,tier:pricing.tier.label,lines:pricing.lines.map(({size,quantity,designType,unitPriceCents,subtotalCents})=>({size,quantity,designType,unitPriceCents,subtotalCents})),merchandiseSubtotalCents:pricing.subtotalCents,customizationQuoteStatus:"not_required",leadTime:lead.label,shipping:"To be quoted",taxes:"To be determined",finalPayableTotal:"Pending confirmation"}},201);
  }catch(error){
    await Promise.allSettled(uploadedKeys.map((key)=>env.PRIVATE_ASSETS.delete(key)));
    console.error("Wholesale request processing failed",error instanceof Error?error.message:"unknown");
    return json({error:error?.status===413?"Order request is too large.":"The wholesale request could not be saved. Please retry with the same request and contact SnapInk if the issue continues."},error?.status===413?413:500);
  }
}

async function notifyWholesaleOrder(env,{order,lines,contact,shippingAddress,specialInstructions}){
  if(env.SNAPINK_LOCAL_E2E==="true")return;
  const adminEmail=env.WHOLESALE_ADMIN_EMAIL||"orders@snapinkhats.com";
  const lineText=lines.map((line)=>`Size ${line.size}: ${line.quantity} × $${(line.unitPriceCents/100).toFixed(2)} = $${(line.subtotalCents/100).toFixed(2)} (${line.designType}${line.designReference?`, ${line.designReference}`:""}${line.artworkName?`, artwork ${line.artworkName}`:""})`).join("\n");
  const address=Object.values(shippingAddress).filter(Boolean).join(", ");
  const message=`Wholesale request ${order.orderNumber}\nPartner: ${contact.businessName}\nContact: ${contact.contactName}\nEmail: ${contact.email}\nQuantity: ${order.totalQuantity}\nTier: ${order.pricingTier}\nMerchandise subtotal: $${(order.merchandiseSubtotalCents/100).toFixed(2)}\nLead-time estimate: ${order.leadTimeLabel}\nShipping: ${address}\n\n${lineText}\n\nInstructions: ${specialInstructions||"None"}\n\nStatus: Pending Review. This request is not a production confirmation and no payment was collected.`;
  const emailPayload={personalizations:[{to:[{email:adminEmail}]},{to:[{email:contact.email}]}],from:{email:"orders@snapinkhats.com",name:"SnapInk Wholesale",domain:"snapinkhats.com"},subject:`SnapInk wholesale request ${order.orderNumber} received`,content:[{type:"text/plain",value:message}]};
  const result=await fetch("https://api.mailchannels.net/tx/v1/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(emailPayload)});
  if(!result.ok)throw new Error(`Existing MailChannels notification returned ${result.status}.`);
}
