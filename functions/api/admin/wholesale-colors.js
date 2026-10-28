import { bearer, json, now, randomId } from "../../_lib/orders.js";

const list = `SELECT id,manufacturer,official_color_name AS name,manufacturer_sku AS sku,
 preview_hex AS hex,material_type AS materialType,finish,availability_status AS availabilityStatus,
 admin_enabled AS adminEnabled,source_url AS sourceUrl FROM wholesale_color_catalog ORDER BY manufacturer,official_color_name`;

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Color catalog storage is unavailable." }, 503);
  try { const result = await env.DB.prepare(list).all(); return json({ colors: result.results || [] }); }
  catch { return json({ error: "Apply database migration 0008 before managing colors." }, 503); }
}

export async function onRequestPatch({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Color catalog storage is unavailable." }, 503);
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !/^[a-z0-9-]{2,100}$/.test(body.id)) return json({ error: "Color ID is invalid." }, 400);
    if (body.availabilityStatus != null && !["available", "unavailable", "unverified"].includes(body.availabilityStatus)) return json({ error: "Choose an availability status." }, 400);
    if (body.adminEnabled != null && typeof body.adminEnabled !== "boolean") return json({ error: "Color enable setting is invalid." }, 400);
    const current = await env.DB.prepare("SELECT availability_status AS availabilityStatus,admin_enabled AS adminEnabled FROM wholesale_color_catalog WHERE id=?").bind(body.id).first();
    if (!current) return json({ error: "Color not found." }, 404);
    const status = body.availabilityStatus ?? current.availabilityStatus;
    const enabled = body.adminEnabled == null ? Number(current.adminEnabled) : Number(body.adminEnabled);
    if (enabled && status !== "available") return json({ error: "A color must be marked available before it can be enabled." }, 400);
    const time=now();
    await env.DB.batch([
      env.DB.prepare("UPDATE wholesale_color_catalog SET availability_status=?,admin_enabled=?,updated_at=? WHERE id=?")
        .bind(status, enabled, time, body.id),
      env.DB.prepare("INSERT INTO wholesale_color_events(color_id,actor_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)")
        .bind(body.id,"admin","catalog_updated",JSON.stringify({from:{availabilityStatus:current.availabilityStatus,adminEnabled:Number(current.adminEnabled)},to:{availabilityStatus:status,adminEnabled:enabled}}),time),
    ]);
    return json({ ok: true });
  } catch (error) {
    console.error("Wholesale color update failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Could not update the color catalog. Apply migration 0008 if needed." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Color catalog storage is unavailable." }, 503);
  try {
    const body=await request.json();
    if(!["Overture","EONO"].includes(body.manufacturer))return json({error:"Choose Overture or EONO."},400);
    if(typeof body.name!=="string"||!body.name.trim()||body.name.trim().length>100)return json({error:"Enter the manufacturer's official color name."},400);
    if(typeof body.hex!=="string"||!/^#[0-9A-Fa-f]{6}$/.test(body.hex))return json({error:"Enter an approximate six-digit HEX swatch."},400);
    if(typeof body.sku!=="string"||body.sku.length>100||typeof body.materialType!=="string"||!/^TPU(?:\s|$)/i.test(body.materialType)||body.materialType.length>40)return json({error:"Enter verified TPU material information."},400);
    if(body.finish!=="matte")return json({error:"Only matte TPU colors can enter this catalog."},400);
    let source="";try{const url=new URL(body.sourceUrl);if(url.protocol!=="https:")throw new Error();source=url.href}catch{return json({error:"Provide an HTTPS manufacturer or supplier source for verification."},400)}
    const id=`${body.manufacturer.toLowerCase()}-${body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${randomId(4).toLowerCase()}`;
    const time=now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO wholesale_color_catalog(id,manufacturer,official_color_name,manufacturer_sku,preview_hex,material_type,finish,availability_status,admin_enabled,source_url,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'matte','unverified',0,?,?,?)`).bind(id,body.manufacturer,body.name.trim(),body.sku.trim()||null,body.hex.toUpperCase(),body.materialType.trim(),source,time,time),
      env.DB.prepare("INSERT INTO wholesale_color_events(color_id,actor_id,event_type,detail_json,created_at) VALUES(?,?,?,?,?)").bind(id,"admin","catalog_added_unverified",JSON.stringify({manufacturer:body.manufacturer,sourceUrl:source}),time),
    ]);
    return json({ok:true,id,availabilityStatus:"unverified",adminEnabled:0},201);
  }catch(error){
    console.error("Wholesale color addition failed",error instanceof Error?error.message:"unknown");
    return json({error:"Could not add the catalog entry. Apply database migration 0008 first."},503);
  }
}
