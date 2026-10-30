import { decodeDataUrl, validEmail } from "./orders.js";

const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
// Leaves room for Base64 expansion and message headers under Cloudflare's 5 MiB message cap.
const MAX_EMAIL_PREVIEW_BYTES = 3.4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export class RetailOrderValidationError extends Error {}

function cleanLine(value, label, max, required = true) {
  const line = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (required && !line) throw new RetailOrderValidationError(`${label} is required.`);
  if (line.length > max || /[<>\u0000-\u001f]/.test(line)) throw new RetailOrderValidationError(`${label} is invalid.`);
  return line || null;
}

export function cleanRetailCustomer(value) {
  const name = cleanLine(value?.name, "Name", 120);
  const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";
  const phone = typeof value?.phone === "string" ? value.phone.trim() : "";
  if (!validEmail(email)) throw new RetailOrderValidationError("Enter a valid email address.");
  if (phone.length > 40 || (phone && !/^[+()\d .-]+$/.test(phone))) throw new RetailOrderValidationError("Enter a valid phone number.");
  return { name, email, phone: phone || null };
}

export function cleanShippingAddress(value) {
  const address = {
    line1: cleanLine(value?.line1, "Street address", 150),
    line2: cleanLine(value?.line2, "Apartment or unit", 150, false),
    city: cleanLine(value?.city, "City", 100),
    region: cleanLine(value?.region, "State or province", 100),
    postalCode: cleanLine(value?.postalCode, "ZIP or postal code", 24),
    country: typeof value?.country === "string" ? value.country.trim().toUpperCase() : "",
  };
  if (!/^[A-Z]{2}$/.test(address.country)) throw new RetailOrderValidationError("Enter a two-letter country code, such as US.");
  return address;
}

function safeSvg(bytes) {
  const text = new TextDecoder().decode(bytes);
  const unsafeUrl = [...text.matchAll(/url\(\s*([^)]+)\)/gi)].some(([, raw]) => {
    const value = raw.trim().replace(/^(\")(.*)\1$/, "$2").replace(/^(')(.*)\1$/, "$2");
    return !value.startsWith("#") && !/^data:image\//i.test(value);
  });
  return /^\s*<svg[\s>]/i.test(text)
    && !/<\s*(script|foreignObject|iframe|object|embed)\b/i.test(text)
    && !/\son[a-z]+\s*=/i.test(text)
    && !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(text)
    && !/<!DOCTYPE|<!ENTITY|@import/i.test(text)
    && !unsafeUrl;
}

export function decodeRetailFiles(files) {
  let artwork, preview, emailPreview, source;
  try {
    artwork = decodeDataUrl(files?.artworkSvg, ["image/svg+xml"], MAX_ARTWORK_BYTES);
    preview = decodeDataUrl(files?.previewPng, ["image/png"], MAX_PREVIEW_BYTES);
    emailPreview = files?.emailPreviewPng
      ? decodeDataUrl(files.emailPreviewPng, ["image/png"], MAX_EMAIL_PREVIEW_BYTES)
      : preview.bytes.length <= MAX_EMAIL_PREVIEW_BYTES ? preview : null;
    source = files?.sourceArtwork
      ? decodeDataUrl(files.sourceArtwork, ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/tiff"], MAX_SOURCE_BYTES)
      : null;
  } catch (error) {
    throw new RetailOrderValidationError(error instanceof Error ? error.message : "The design files could not be read.");
  }
  if (!safeSvg(artwork.bytes)) throw new RetailOrderValidationError("The SVG artwork contains unsupported content.");
  if (preview.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte, i) => preview.bytes[i] === byte)) throw new RetailOrderValidationError("The preview is not a valid PNG image.");
  if (emailPreview && (emailPreview.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte, i) => emailPreview.bytes[i] === byte))) throw new RetailOrderValidationError("The email design preview is not a valid PNG image.");
  if (source?.mime === "image/svg+xml" && !safeSvg(source.bytes)) throw new RetailOrderValidationError("The uploaded SVG contains unsupported content.");
  if (source?.mime === "image/png" && (source.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte, i) => source.bytes[i] === byte))) throw new RetailOrderValidationError("The uploaded PNG is invalid.");
  if (source?.mime === "image/jpeg" && (source.bytes.length < 3 || source.bytes[0] !== 255 || source.bytes[1] !== 216 || source.bytes[2] !== 255)) throw new RetailOrderValidationError("The uploaded JPEG is invalid.");
  if (source?.mime === "image/webp" && (source.bytes.length < 12 || new TextDecoder().decode(source.bytes.slice(0,4)) !== "RIFF" || new TextDecoder().decode(source.bytes.slice(8,12)) !== "WEBP")) throw new RetailOrderValidationError("The uploaded WebP is invalid.");
  if (source?.mime === "image/gif" && new TextDecoder().decode(source.bytes.slice(0,3)) !== "GIF") throw new RetailOrderValidationError("The uploaded GIF is invalid.");
  if (source?.mime === "image/bmp" && new TextDecoder().decode(source.bytes.slice(0,2)) !== "BM") throw new RetailOrderValidationError("The uploaded BMP is invalid.");
  if (source?.mime === "image/avif" && !["ftypavif", "ftypavis"].includes(new TextDecoder().decode(source.bytes.slice(4,12)))) throw new RetailOrderValidationError("The uploaded AVIF is invalid.");
  if (source?.mime === "image/tiff" && !((source.bytes[0] === 73 && source.bytes[1] === 73 && source.bytes[2] === 42 && source.bytes[3] === 0) || (source.bytes[0] === 77 && source.bytes[1] === 77 && source.bytes[2] === 0 && source.bytes[3] === 42))) throw new RetailOrderValidationError("The uploaded TIFF is invalid.");
  return { artwork, preview, emailPreview, source };
}

export function sourceArtworkExtension(source) {
  return source.mime === "image/svg+xml" ? "svg" : ({ jpeg: "jpg", tiff: "tif" }[source.mime.split("/")[1]] || source.mime.split("/")[1]);
}

export function formatUsd(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function safeOrderJson(value, fallback = {}) {
  try { const result = JSON.parse(value); return result && typeof result === "object" ? result : fallback; }
  catch { return fallback; }
}

export function equalSignatures(expected, candidate) {
  if (expected.length !== candidate.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  return difference === 0;
}

export async function verifyStripeSignature(payload, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof signatureHeader !== "string" || signatureHeader.length > 4096) return false;
  const values = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = values.find(([key]) => key === "t")?.[1];
  const candidates = values.filter(([key]) => key === "v1").map(([, value]) => value).filter((value) => /^[a-f0-9]{64}$/i.test(value || ""));
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300 || !candidates.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return candidates.some((candidate) => equalSignatures(expected, candidate.toLowerCase()));
}
