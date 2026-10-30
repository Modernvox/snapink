import { decodeDataUrl, digest, json, now, randomId, validEmail } from "../_lib/orders.js";
import { validDraft } from "../_lib/draft.js";
import { EmailDeliveryError, sendSnapInkEmail } from "../_lib/snapink-email.js";

const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const STATUS = "pending_review";
const ADMIN_URL = "https://snapbacksleeves.com/admin.html";
class DraftValidationError extends Error {}

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

function cleanCustomer(data) {
  const name = typeof data.name === "string" ? data.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  if (!name || name.length > 120 || /[<>\u0000-\u001f]/.test(name)) throw new DraftValidationError("Enter a valid name (up to 120 characters).");
  if (!validEmail(email)) throw new DraftValidationError("Enter a valid email address.");
  if (phone.length > 40 || (phone && !/^[+()\d .-]+$/.test(phone))) throw new DraftValidationError("Enter a valid phone number.");
  return { name, email, phone: phone || null };
}

async function rateLimit(request, db) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await digest(ip);
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  const row = await db.prepare(`INSERT INTO design_draft_rate_limits (ip_hash,window_start,request_count)
    VALUES (?,?,1) ON CONFLICT(ip_hash,window_start)
    DO UPDATE SET request_count=request_count+1 RETURNING request_count`)
    .bind(ipHash, bucket).first();
  if (bucket % (60 * 60 * 1000) === 0) {
    await db.prepare("DELETE FROM design_draft_rate_limits WHERE window_start < ?").bind(bucket - 24 * 60 * 60 * 1000).run();
  }
  return Number(row?.request_count || 0) <= RATE_LIMIT;
}

function decodeFiles(files) {
  let artwork, preview, source;
  try {
    artwork = decodeDataUrl(files?.artworkSvg, ["image/svg+xml"], MAX_ARTWORK_BYTES);
    preview = decodeDataUrl(files?.previewPng, ["image/png"], MAX_PREVIEW_BYTES);
    source = files?.sourceArtwork
      ? decodeDataUrl(files.sourceArtwork, ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif", "image/tiff"], MAX_SOURCE_BYTES)
      : null;
  } catch (error) {
    throw new DraftValidationError(error instanceof Error ? error.message : "The design artwork could not be read.");
  }
  if (!safeSvg(artwork.bytes)) throw new DraftValidationError("The SVG artwork contains unsupported content.");
  if (preview.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte, index) => preview.bytes[index] === byte)) throw new DraftValidationError("The preview is not a valid PNG image.");
  if (source && source.mime === "image/svg+xml" && !safeSvg(source.bytes)) throw new DraftValidationError("The source SVG contains unsupported content.");
  if (source && source.mime === "image/png" && (source.bytes.length < 8 || ![137,80,78,71,13,10,26,10].every((byte, index) => source.bytes[index] === byte))) throw new DraftValidationError("The source artwork is not a valid PNG image.");
  if (source && source.mime === "image/jpeg" && (source.bytes.length < 3 || source.bytes[0] !== 255 || source.bytes[1] !== 216 || source.bytes[2] !== 255)) throw new DraftValidationError("The source artwork is not a valid JPEG image.");
  if (source && source.mime === "image/webp" && (source.bytes.length < 12 || new TextDecoder().decode(source.bytes.slice(0,4)) !== "RIFF" || new TextDecoder().decode(source.bytes.slice(8,12)) !== "WEBP")) throw new DraftValidationError("The source artwork is not a valid WebP image.");
  if (source && source.mime === "image/gif" && new TextDecoder().decode(source.bytes.slice(0,3)) !== "GIF") throw new DraftValidationError("The source artwork is not a valid GIF image.");
  if (source && source.mime === "image/bmp" && new TextDecoder().decode(source.bytes.slice(0,2)) !== "BM") throw new DraftValidationError("The source artwork is not a valid BMP image.");
  if (source && source.mime === "image/avif" && !["ftypavif", "ftypavis"].includes(new TextDecoder().decode(source.bytes.slice(4,12)))) throw new DraftValidationError("The source artwork is not a valid AVIF image.");
  if (source && source.mime === "image/tiff" && !((source.bytes[0] === 73 && source.bytes[1] === 73 && source.bytes[2] === 42 && source.bytes[3] === 0) || (source.bytes[0] === 77 && source.bytes[1] === 77 && source.bytes[2] === 0 && source.bytes[3] === 42))) throw new DraftValidationError("The source artwork is not a valid TIFF image.");
  return { artwork, preview, source };
}

function sourceExtension(source) {
  return source.mime === "image/svg+xml" ? "svg" : ({ jpeg: "jpg", tiff: "tif" }[source.mime.split("/")[1]] || source.mime.split("/")[1]);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PRIVATE_ASSETS) return json({ error: "Design review intake is temporarily unavailable. Please try again later." }, 503);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_JSON_BYTES) return json({ error: "The design submission is too large. Reduce the artwork file size and try again." }, 413);
  try {
    if (!(await rateLimit(request, env.DB))) return json({ error: "Too many submissions from this connection. Please wait a few minutes and try again." }, 429);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) return json({ error: "The design submission is too large. Reduce the artwork file size and try again." }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: "The submission could not be read. Please review the form and try again." }, 400); }
    const customer = cleanCustomer(data.customer || {});
    const quantity = Number(data.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return json({ error: "Quantity must be between 1 and 50." }, 400);
    if (typeof data.idempotencyKey !== "string" || !/^[\w-]{16,80}$/.test(data.idempotencyKey)) return json({ error: "Please refresh the page and submit your design again." }, 400);
    if (!data.draft || !["standard", "billboard"].includes(data.draft.variant) || !Number.isInteger(data.draft.size) || data.draft.size < 0 || data.draft.size > 5) return json({ error: "Choose a supported sleeve style and size." }, 400);
    if (typeof data.submittedAt !== "string" || !Number.isFinite(Date.parse(data.submittedAt))) return json({ error: "The design timestamp is invalid. Refresh the page and try again." }, 400);
    const draft = { ...data.draft };
    delete draft.logoDataUrl;
    if (!validDraft(draft)) return json({ error: "Some design settings are invalid. Review the design and try again." }, 400);
    const { artwork, preview, source } = decodeFiles(data.files || {});
    const existing = await env.DB.prepare("SELECT id,reference,status FROM design_drafts WHERE idempotency_key=?").bind(data.idempotencyKey).first();
    if (existing) return json({ ok: true, duplicate: true, draft: { reference: existing.reference, status: existing.status } }, 200);

    const id = randomId(16);
    const createdAt = now();
    const reference = `SD-${createdAt.slice(0,10).replaceAll("-","")}-${id.slice(0,12).toUpperCase()}`;
    const artworkKey = `design-drafts/${id}/artwork.svg`;
    const previewKey = `design-drafts/${id}/preview.png`;
    const sourceKey = source ? `design-drafts/${id}/source-artwork.${sourceExtension(source)}` : null;
    const submittedDraft = { ...draft, submittedAt: createdAt };
    const puts = await Promise.allSettled([
      env.PRIVATE_ASSETS.put(artworkKey, artwork.bytes, { httpMetadata: { contentType: artwork.mime } }),
      env.PRIVATE_ASSETS.put(previewKey, preview.bytes, { httpMetadata: { contentType: preview.mime } }),
      ...(source ? [env.PRIVATE_ASSETS.put(sourceKey, source.bytes, { httpMetadata: { contentType: source.mime } })] : []),
    ]);
    const failedPut = puts.find((result) => result.status === "rejected");
    if (failedPut) {
      await Promise.allSettled([env.PRIVATE_ASSETS.delete(artworkKey), env.PRIVATE_ASSETS.delete(previewKey), ...(sourceKey ? [env.PRIVATE_ASSETS.delete(sourceKey)] : [])]);
      throw failedPut.reason;
    }
    try {
      await env.DB.prepare(`INSERT INTO design_drafts
        (id,reference,idempotency_key,customer_name,customer_email,customer_phone,quantity,variant,size,status,draft_json,artwork_key,preview_key,source_artwork_key,notification_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'pending_review',?,?,?,?,'pending',?,?)`)
        .bind(id,reference,data.idempotencyKey,customer.name,customer.email,customer.phone,quantity,draft.variant,draft.size,JSON.stringify(submittedDraft),artworkKey,previewKey,sourceKey,createdAt,createdAt).run();
    } catch (error) {
      await Promise.allSettled([env.PRIVATE_ASSETS.delete(artworkKey), env.PRIVATE_ASSETS.delete(previewKey), ...(sourceKey ? [env.PRIVATE_ASSETS.delete(sourceKey)] : [])]);
      if (String(error).includes("idempotency_key")) {
        const duplicate = await env.DB.prepare("SELECT id,reference,status FROM design_drafts WHERE idempotency_key=?").bind(data.idempotencyKey).first();
        if (duplicate) return json({ ok: true, duplicate: true, draft: { reference: duplicate.reference, status: duplicate.status } }, 200);
      }
      throw error;
    }

    let notificationStatus = "sent";
    let emailDelivered = false;
    try {
      await sendSnapInkEmail(env, {
        to: "partners@snapbacksleeves.com",
        subject: `SnapInk design draft ${reference} received`,
        text: `A customer design draft is ready for review.\n\nReference: ${reference}\nCustomer: ${customer.name}\nEmail: ${customer.email}\nSleeve: ${draft.variant} - Size ${draft.size}\nQuantity: ${quantity}\nSubmitted: ${createdAt}\n\nReview securely in the SnapInk admin dashboard: ${ADMIN_URL}\n\nThis is a design review request, not a production order.`,
      });
      emailDelivered = true;
      await env.DB.prepare("UPDATE design_drafts SET notification_status='sent',notification_error=NULL,updated_at=? WHERE id=?").bind(now(), id).run();
    } catch (error) {
      if (emailDelivered) {
        console.error("Draft notification was sent but its delivery status could not be recorded", { reference, error: error instanceof Error ? error.message : "unknown" });
      } else {
        notificationStatus = "failed";
        console.error("Design draft saved but owner notification failed", { reference, error: error instanceof EmailDeliveryError ? error.message : "Unexpected notification error" });
        try {
          await env.DB.prepare("UPDATE design_drafts SET notification_status='failed',notification_error=?,updated_at=? WHERE id=?")
            .bind(error instanceof Error ? error.message.slice(0,240) : "Notification failed", now(), id).run();
        } catch (recordError) {
          console.error("Could not record design draft notification failure", { reference, error: recordError instanceof Error ? recordError.message : "unknown" });
        }
      }
    }
    return json({ ok: true, draft: { reference, status: STATUS }, notificationStatus }, 201);
  } catch (error) {
    if (error instanceof DraftValidationError) return json({ error: error.message }, 400);
    const message = error instanceof Error ? error.message : "Unable to save this design right now.";
    console.error("Design draft submission failed", message);
    return json({ error: "We could not save your design. Please try again." }, 500);
  }
}
