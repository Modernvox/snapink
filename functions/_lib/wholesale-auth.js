import { digest, json, now } from "./orders.js";

export async function wholesalePartnerFor(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.DB || token.length < 40 || token.length > 256) return null;
  const tokenHash = await digest(token);
  const partner = await env.DB.prepare(`SELECT id, pilot_application_id AS pilotApplicationId,
    business_name AS businessName, contact_name AS contactName, email, phone, access_status AS accessStatus
    FROM wholesale_partners WHERE token_sha256=?`).bind(tokenHash).first();
  if (!partner || partner.accessStatus !== "active") return null;
  await env.DB.prepare("UPDATE wholesale_partners SET last_seen_at=?,updated_at=? WHERE id=? AND access_status='active'")
    .bind(now(), now(), partner.id).run();
  return partner;
}

export function partnerUnauthorized() {
  return json({ error: "Approved wholesale partner access is required. Apply or contact SnapInk to activate your partner credential." }, 401);
}

export function cleanText(value, max, required = false) {
  if (typeof value !== "string") return required ? null : "";
  const clean = value.trim();
  if (clean.length > max || (required && !clean)) return null;
  return clean;
}

export function cleanAddress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, max, required] of [
    ["line1", 160, true], ["line2", 160, false], ["city", 100, true],
    ["state", 100, true], ["postalCode", 24, true], ["country", 80, true],
  ]) {
    out[key] = cleanText(value[key] ?? "", max, required);
    if (out[key] == null) return null;
  }
  return out;
}

export function validWholesaleArtwork(file) {
  return file instanceof File && file.size > 0 && file.size <= 8 * 1024 * 1024 &&
    ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type);
}

export async function validateWholesaleArtwork(file) {
  if (!validWholesaleArtwork(file)) return { error: "Each artwork upload must be PNG, JPG, WebP, or SVG and no larger than 8 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === "image/png" && (bytes.length < 8 || [137,80,78,71,13,10,26,10].some((v, i) => bytes[i] !== v))) return { error: "Artwork is not a valid PNG file." };
  if (file.type === "image/jpeg" && (bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) return { error: "Artwork is not a valid JPEG file." };
  if (file.type === "image/webp" && (bytes.length < 12 || new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP")) return { error: "Artwork is not a valid WebP file." };
  if (file.type === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes);
    const unsafeUrl = [...text.matchAll(/url\(\s*([^)]+)\)/gi)].some(([, raw]) => {
      const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
      return !value.startsWith("#") && !/^data:image\//i.test(value);
    });
    if (!/^\s*<svg[\s>]/i.test(text) || /<\s*(script|foreignObject|iframe|object|embed)\b/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /(?:href|src)\s*=\s*['"]\s*(?:https?:|\/\/|javascript:)/i.test(text) || /<!DOCTYPE|<!ENTITY|@import/i.test(text) || unsafeUrl) return { error: "SVG artwork contains active or external content and was rejected." };
  }
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[file.type];
  const cleanName = String(file.name || `artwork.${extension}`).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || `artwork.${extension}`;
  return { bytes, mime: file.type, extension, name: cleanName, sha256: await digest(bytes) };
}
