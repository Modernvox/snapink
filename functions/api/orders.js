import { bearer, decodeDataUrl, digest, json, now, randomId, validEmail } from "../_lib/orders.js";
import { validDraft } from "../_lib/draft.js";
import releaseState from "../../scripts/production-release-state.json" with { type: "json" };

const MAX_JSON_BYTES = 24 * 1024 * 1024;
function safeSvg(bytes) {
  const text = new TextDecoder().decode(bytes);
  const hasUnsafeUrl = [...text.matchAll(/url\(\s*([^)]+)\)/gi)].some(([, rawValue]) => {
    const value = rawValue.trim().replace(/^(["'])(.*)\1$/, "$2");
    return !value.startsWith("#") && !/^data:image\//i.test(value);
  });
  return /^\s*<svg[\s>]/i.test(text) && !/<\s*(script|foreignObject|iframe|object|embed)\b/i.test(text) && !/\son[a-z]+\s*=/i.test(text) && !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(text) && !/<!DOCTYPE|<!ENTITY|@import/i.test(text) && !hasUnsafeUrl;
}

export async function onRequestPost({ request, env }) {
  if (!bearer(request, env.PARTNER_ORDER_TOKEN)) return json({ error: "Ordering is limited to approved pilot partners." }, 401);
  if (releaseState.productionOrdersEnabled !== true && env.SNAPINK_LOCAL_E2E !== "true") return json({ error: "Production orders are paused while the blank-flap templates and artwork positioning are being validated." }, 503);
  if (!env.DB || !env.PRIVATE_ASSETS || !env.BACKUP_BUCKET) return json({ error: "Order and backup storage are not configured." }, 503);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BYTES) return json({ error: "Order payload is too large." }, 413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) return json({ error: "Order payload is too large." }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: "Order request is not valid JSON." }, 400); }
    const customer = data.customer || {};
    const draft = data.draft || {};
    if (typeof customer.name !== "string" || !customer.name.trim() || customer.name.length > 120) return json({ error: "Enter a customer name." }, 400);
    if (!validEmail(customer.email)) return json({ error: "Enter a valid customer email." }, 400);
    if (customer.phone != null && (typeof customer.phone !== "string" || customer.phone.length > 40)) return json({ error: "Enter a valid phone number." }, 400);
    if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 50) return json({ error: "Quantity must be between 1 and 50." }, 400);
    if (!validDraft(draft)) return json({ error: "Studio design settings are invalid. Review the design and try again." }, 400);
    if (!['standard','billboard'].includes(draft.variant) || !Number.isInteger(draft.size) || draft.size < 0 || draft.size > 5) return json({ error: "Choose a valid sleeve style and size." }, 400);
    if (typeof data.idempotencyKey !== "string" || !/^[\w-]{16,80}$/.test(data.idempotencyKey)) return json({ error: "Order request key is invalid." }, 400);
    let artwork,preview,source;
    try {
      artwork = decodeDataUrl(data.files?.artworkSvg, ["image/svg+xml"], 8 * 1024 * 1024);
      preview = decodeDataUrl(data.files?.previewPng, ["image/png"], 4 * 1024 * 1024);
      source = decodeDataUrl(data.files?.sourceArtwork, ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/tiff"], 4 * 1024 * 1024);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Order artwork is invalid." }, 400); }
    if (!safeSvg(artwork.bytes)) return json({ error: "The production artwork contains unsupported SVG content." }, 400);
    if (preview.bytes.length < 8 || [137,80,78,71,13,10,26,10].some((byte, index) => preview.bytes[index] !== byte)) return json({ error: "Preview is not a valid PNG file." }, 400);
    const cleanDraft = { ...draft }; delete cleanDraft.logoDataUrl;
    const id = randomId(16);
    if (source.mime === "image/png" && (source.bytes.length < 8 || [137,80,78,71,13,10,26,10].some((byte, index) => source.bytes[index] !== byte))) return json({ error: "Source artwork is not a valid PNG file." }, 400);
    if (source.mime === "image/jpeg" && (source.bytes.length < 3 || source.bytes[0] !== 255 || source.bytes[1] !== 216 || source.bytes[2] !== 255)) return json({ error: "Source artwork is not a valid JPEG file." }, 400);
    if (source.mime === "image/webp" && (source.bytes.length < 12 || new TextDecoder().decode(source.bytes.slice(0,4)) !== "RIFF" || new TextDecoder().decode(source.bytes.slice(8,12)) !== "WEBP")) return json({ error: "Source artwork is not a valid WebP file." }, 400);
    if (source.mime === "image/gif" && new TextDecoder().decode(source.bytes.slice(0,3)) !== "GIF") return json({ error: "Source artwork is not a valid GIF file." }, 400);
    if (source.mime === "image/bmp" && new TextDecoder().decode(source.bytes.slice(0,2)) !== "BM") return json({ error: "Source artwork is not a valid BMP file." }, 400);
    if (source.mime === "image/avif" && new TextDecoder().decode(source.bytes.slice(4,12)).slice(0,8) !== "ftypavif" && new TextDecoder().decode(source.bytes.slice(4,12)).slice(0,8) !== "ftypavis") return json({ error: "Source artwork is not a valid AVIF file." }, 400);
    if (source.mime === "image/tiff" && !((source.bytes[0] === 73 && source.bytes[1] === 73 && source.bytes[2] === 42 && source.bytes[3] === 0) || (source.bytes[0] === 77 && source.bytes[1] === 77 && source.bytes[2] === 0 && source.bytes[3] === 42))) return json({ error: "Source artwork is not a valid TIFF file." }, 400);
    const sourceKey = `orders/${id}/source-artwork.${source.mime === "image/svg+xml" ? "svg" : source.mime.split("/")[1]}`;
    const created = now();
    const orderNo = `SI-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${id.slice(0,6).toUpperCase()}`;
    const artworkKey = `orders/${id}/artwork.svg`;
    const previewKey = `orders/${id}/preview.png`;
    const assetWrites = await Promise.allSettled([
      env.PRIVATE_ASSETS.put(artworkKey, artwork.bytes, { httpMetadata: { contentType: artwork.mime } }),
      env.PRIVATE_ASSETS.put(previewKey, preview.bytes, { httpMetadata: { contentType: preview.mime } }),
      env.PRIVATE_ASSETS.put(sourceKey, source.bytes, { httpMetadata: { contentType: source.mime } }),
      env.BACKUP_BUCKET.put(artworkKey, artwork.bytes, { httpMetadata: { contentType: artwork.mime } }),
      env.BACKUP_BUCKET.put(previewKey, preview.bytes, { httpMetadata: { contentType: preview.mime } }),
      env.BACKUP_BUCKET.put(sourceKey, source.bytes, { httpMetadata: { contentType: source.mime } }),
    ]);
    const failedAsset = assetWrites.find((result) => result.status === "rejected");
    if (failedAsset) {
      await Promise.allSettled([env.PRIVATE_ASSETS.delete(artworkKey), env.PRIVATE_ASSETS.delete(previewKey), env.PRIVATE_ASSETS.delete(sourceKey), env.BACKUP_BUCKET.delete(artworkKey), env.BACKUP_BUCKET.delete(previewKey), env.BACKUP_BUCKET.delete(sourceKey)]);
      throw failedAsset.reason;
    }
    try {
      await env.DB.prepare(`INSERT INTO orders (id,order_number,idempotency_key,customer_name,customer_email,customer_phone,quantity,variant,size,status,draft_json,artwork_key,preview_key,source_artwork_key,artwork_sha256,preview_sha256,source_artwork_sha256,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?)`)
        .bind(id,orderNo,data.idempotencyKey,customer.name.trim(),customer.email.trim().toLowerCase(),customer.phone?.trim() || null,data.quantity,draft.variant,draft.size,JSON.stringify(cleanDraft),artworkKey,previewKey,sourceKey,await digest(artwork.bytes),await digest(preview.bytes),await digest(source.bytes),created,created).run();
    } catch (error) {
      await Promise.allSettled([env.PRIVATE_ASSETS.delete(artworkKey), env.PRIVATE_ASSETS.delete(previewKey), env.PRIVATE_ASSETS.delete(sourceKey), env.BACKUP_BUCKET.delete(artworkKey), env.BACKUP_BUCKET.delete(previewKey), env.BACKUP_BUCKET.delete(sourceKey)]);
      if (String(error).includes("idempotency_key")) {
        const existing = await env.DB.prepare("SELECT id,order_number,status FROM orders WHERE idempotency_key=?").bind(data.idempotencyKey).first();
        if (existing) return json({ ok: true, duplicate: true, order: existing }, 200);
      }
      throw error;
    }
    await env.DB.prepare("INSERT INTO order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(id,"partner","order_created",JSON.stringify({ quantity:data.quantity,variant:draft.variant,size:draft.size }),created).run();
    return json({ ok: true, order: { id, orderNumber: orderNo, status: "new" } }, 201);
  } catch (error) {
    console.error("Order submission failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Unable to submit this order right now. Please retry." }, 500);
  }
}
