import { json, now, randomId } from "../../_lib/orders.js";
import { wholesalePartnerFor, partnerUnauthorized, validateWholesaleArtwork } from "../../_lib/wholesale-auth.js";

const DATA_URL = /^data:(image\/(?:svg\+xml|png))(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/]+=*)$/i;
function unpack(value, name) {
  if (typeof value !== "string" || value.length > 12 * 1024 * 1024) return null;
  const match = DATA_URL.exec(value);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const type = match[1], ext = type === "image/svg+xml" ? "svg" : "png";
  return new File([bytes], name, { type });
}

async function readDesign(db, partnerId, id) {
  return db.prepare(`SELECT id,design_name AS designName,version,sleeve_style AS sleeveStyle,sleeve_size AS sleeveSize,
    base_color_id AS baseColorId,artwork_colors_json AS artworkColorsJson,draft_json AS draftJson,
    preview_key AS previewKey,preview_sha256 AS previewSha256,geometry_version AS geometryVersion,
    positioning_version AS positioningVersion,created_at AS createdAt,updated_at AS updatedAt
    FROM wholesale_designs WHERE partner_id=? AND id=?`).bind(partnerId,id).first();
}

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB) return json({ error: "Design storage is unavailable." }, 503);
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const design = await readDesign(env.DB, partner.id, id);
      return design ? json({ design }) : json({ error: "Saved design not found." }, 404);
    }
    const result = await env.DB.prepare(`SELECT id,design_name AS designName,version,sleeve_style AS sleeveStyle,
      sleeve_size AS sleeveSize,base_color_id AS baseColorId,artwork_colors_json AS artworkColorsJson,
      preview_key AS previewKey,created_at AS createdAt,updated_at AS updatedAt FROM wholesale_designs
      WHERE partner_id=? ORDER BY updated_at DESC LIMIT 200`).bind(partner.id).all();
    return json({ designs: result.results || [] });
  } catch (error) {
    console.error("Wholesale design read failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Saved designs are unavailable. Apply database migration 0008 first." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  if (!partner) return partnerUnauthorized();
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Private design storage is unavailable." }, 503);
  let stored = [];
  try {
    const body = await request.json();
    const variant = body.sleeveStyle, size = Number(body.sleeveSize), colorId = body.baseColorId;
    if (!["standard", "billboard"].includes(variant) || !Number.isInteger(size) || size < 0 || size > 6) return json({ error: "Choose a valid sleeve style and size." }, 400);
    if (typeof colorId !== "string" || !/^[a-z0-9-]{2,100}$/.test(colorId)) return json({ error: "Choose an available matte TPU base color." }, 400);
    const baseColor = await env.DB.prepare(`SELECT id,manufacturer,official_color_name AS name,manufacturer_sku AS sku,
      preview_hex AS hex,material_type AS materialType,finish FROM wholesale_color_catalog
      WHERE id=? AND availability_status='available' AND admin_enabled=1`).bind(colorId).first();
    if (!baseColor || !/tpu/i.test(baseColor.materialType) || baseColor.finish.toLowerCase() !== "matte") return json({ error: "That base color is not currently orderable." }, 400);
    if (!Array.isArray(body.artworkColors) || body.artworkColors.length > 2 || body.artworkColors.some((value) => typeof value !== "string" || !/^[a-z0-9-]{2,100}$/.test(value))) return json({ error: "Select no more than two additional approved TPU artwork colors." }, 400);
    const colorIds = [...new Set(body.artworkColors)];
    const artworkColorRows = colorIds.length ? await env.DB.prepare(`SELECT id,manufacturer,official_color_name AS name,manufacturer_sku AS sku,
      preview_hex AS hex,material_type AS materialType,finish FROM wholesale_color_catalog WHERE id IN (${colorIds.map(() => "?").join(",")})
      AND availability_status='available' AND admin_enabled=1`).bind(...colorIds).all() : { results: [] };
    const artworkColorDetails = artworkColorRows.results || [];
    if (artworkColorDetails.length !== colorIds.length || artworkColorDetails.some((color) => !/tpu/i.test(color.materialType) || color.finish.toLowerCase() !== "matte")) return json({ error: "Artwork colors must be approved, enabled, available matte TPU catalog colors." }, 400);
    const distinct = new Set([baseColor.hex.toUpperCase(), ...artworkColorDetails.map((color) => color.hex.toUpperCase())]);
    if (distinct.size > 3) return json({ error: "This design uses more than three distinct permanent colors, including the sleeve base." }, 400);
    if (!body.draft || typeof body.draft !== "object" || JSON.stringify(body.draft).length > 64 * 1024) return json({ error: "Studio design specifications are missing or too large." }, 400);
    const geometry = body.draft.productionGeometryVersion, positioning = body.draft.positioningVersion;
    if (typeof geometry !== "string" || geometry.length > 100 || typeof positioning !== "string" || positioning.length > 100) return json({ error: "Validated Studio positioning metadata is required." }, 400);
    if (body.draft.variant !== variant || Number(body.draft.size) !== size) return json({ error: "Studio sleeve configuration does not match the selected order configuration." }, 400);
    const sourceName = typeof body.draft?.logoName === "string" ? body.draft.logoName.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100) : "source-artwork";
    const svgFile = unpack(body.files?.artworkSvg, "design.svg"), previewFile = unpack(body.files?.previewPng, "preview.png"), sourceFile = unpack(body.files?.sourceArtwork, sourceName || "source-artwork");
    if (!svgFile || !previewFile || !sourceFile) return json({ error: "Studio export is incomplete. Reopen the editor and save again." }, 400);
    const [svg, preview, source] = await Promise.all([validateWholesaleArtwork(svgFile), validateWholesaleArtwork(previewFile), validateWholesaleArtwork(sourceFile)]);
    for (const result of [svg, preview, source]) if (result.error) return json({ error: result.error }, 400);
    if (svg.mime !== "image/svg+xml" || preview.mime !== "image/png" || svg.bytes.byteLength > 8 * 1024 * 1024 || preview.bytes.byteLength > 8 * 1024 * 1024) return json({ error: "Studio SVG or preview exceeds the supported format or 8 MB limit." }, 400);
    const id = typeof body.id === "string" && /^[\w-]{8,100}$/.test(body.id) ? body.id : randomId(16);
    const anyOwner = await env.DB.prepare("SELECT partner_id AS partnerId FROM wholesale_designs WHERE id=?").bind(id).first();
    if (anyOwner && anyOwner.partnerId !== partner.id) return json({ error: "Saved design not found." },404);
    const prior = await env.DB.prepare("SELECT id,version FROM wholesale_designs WHERE partner_id=? AND id=?").bind(partner.id,id).first();
    const version = Number(prior?.version || 0) + 1, timestamp = now(), prefix = `wholesale-designs/${partner.id}/${id}/v${version}`;
    const objects = [
      [`${prefix}/artwork.svg`,svg], [`${prefix}/preview.png`,preview], [`${prefix}/source.${source.extension}`,source],
    ];
    for (const [key, value] of objects) { await env.PRIVATE_ASSETS.put(key,value.bytes,{httpMetadata:{contentType:value.mime}}); stored.push(key); }
    const designName = typeof body.designName === "string" ? body.designName.trim().slice(0,100) || "Custom sleeve design" : "Custom sleeve design";
    const sourceSvg = source.mime === "image/svg+xml" ? new TextDecoder().decode(source.bytes) : "";
    const selectedHex = new Set([baseColor.hex.toUpperCase(),...artworkColorDetails.map((color)=>color.hex.toUpperCase())]);
    const sourcePalette = [...sourceSvg.matchAll(/\b(?:fill|stroke)=["'](#[0-9a-f]{6})["']/gi)].map((match)=>match[1].toUpperCase());
    const colorReviewRequired = body.draft.colorReviewRequired === true || source.mime !== "image/svg+xml" || /<\s*image\b/i.test(sourceSvg) || sourcePalette.some((color)=>!selectedHex.has(color));
    const snapshot = { ...body.draft, logoDataUrl: undefined, baseColor, artworkColors: artworkColorDetails, colorReviewRequired, geometryVersion: geometry, positioningVersion: positioning };
    await env.DB.prepare(`INSERT INTO wholesale_designs(id,partner_id,design_name,version,sleeve_style,sleeve_size,
      base_color_id,artwork_colors_json,draft_json,artwork_svg_key,artwork_svg_sha256,preview_key,preview_sha256,
      source_artwork_key,source_artwork_sha256,source_artwork_name,geometry_version,positioning_version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET design_name=excluded.design_name,version=excluded.version,sleeve_style=excluded.sleeve_style,
      sleeve_size=excluded.sleeve_size,base_color_id=excluded.base_color_id,artwork_colors_json=excluded.artwork_colors_json,
      draft_json=excluded.draft_json,artwork_svg_key=excluded.artwork_svg_key,artwork_svg_sha256=excluded.artwork_svg_sha256,
      preview_key=excluded.preview_key,preview_sha256=excluded.preview_sha256,source_artwork_key=excluded.source_artwork_key,
      source_artwork_sha256=excluded.source_artwork_sha256,source_artwork_name=excluded.source_artwork_name,
      geometry_version=excluded.geometry_version,positioning_version=excluded.positioning_version,updated_at=excluded.updated_at
      WHERE wholesale_designs.partner_id=excluded.partner_id`).bind(id,partner.id,designName,version,variant,size,colorId,JSON.stringify(colorIds),JSON.stringify(snapshot),objects[0][0],svg.sha256,objects[1][0],preview.sha256,objects[2][0],source.sha256,source.name,geometry,positioning,timestamp,timestamp).run();
    return json({ ok: true, design: { id, designName, version, sleeveStyle: variant, sleeveSize: size, baseColor, artworkColors: colorIds, artworkColorDetails, colorReviewRequired, previewUrl: `/api/wholesale/design-preview?id=${encodeURIComponent(id)}` } }, prior ? 200 : 201);
  } catch (error) {
    await Promise.allSettled(stored.map((key) => env.PRIVATE_ASSETS.delete(key)));
    console.error("Wholesale design save failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Could not save the private Studio design. Apply migration 0008 and retry." }, 503);
  }
}
