export const STATUSES = ["new", "in_review", "ready", "in_production", "completed", "shipped", "cancelled"];
export const JOB_STATUSES = ["queued", "downloaded", "opened", "failed", "completed"];
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export const now = () => new Date().toISOString();
export function bearer(request, secret) { return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`); }
export async function digest(value) { const input = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength); const bytes = await crypto.subtle.digest("SHA-256", input); return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
export function randomId(bytes = 16) { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return [...data].map((x) => x.toString(16).padStart(2, "0")).join(""); }
export async function deviceFor(request, db) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length < 40) return null;
  const hash = await digest(token);
  const row = await db.prepare("SELECT id,name FROM production_devices WHERE token_sha256=? AND active=1").bind(hash).first();
  if (row) await db.prepare("UPDATE production_devices SET last_seen_at=? WHERE id=?").bind(now(), row.id).run();
  return row;
}
export function validEmail(value) { return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function decodeDataUrl(value, types, maxBytes) {
  if (typeof value !== "string" || value.length > maxBytes * 1.5 + 256) throw new Error("File is missing or too large.");
  const match = /^data:(image\/(?:svg\+xml|png|jpeg|webp|gif|bmp|avif|tiff))(?:;(charset=utf-8))?;base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  const mime = match?.[1]?.toLowerCase();
  if (!match || !mime || !types.includes(mime) || (match[2] && mime !== "image/svg+xml")) throw new Error("Unsupported artwork file format.");
  const raw = atob(match[3]);
  if (raw.length > maxBytes) throw new Error("File is too large.");
  return { mime, bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0)) };
}
