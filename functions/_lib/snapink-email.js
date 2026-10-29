const EMAIL_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const SNAPINK_CLOUDFLARE_ACCOUNT_ID = "d0cd5ac479c0fd7475127fe52b3f4883";
const SNAPINK_FROM = "hello@snapbacksleeves.com";

export class EmailDeliveryError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}

export async function sendSnapInkEmail(env, { to, subject, text, replyTo }) {
  const accountId = SNAPINK_CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_EMAIL_API_TOKEN;
  if (!apiToken) {
    throw new EmailDeliveryError("Email delivery is not configured.");
  }

  const recipients = (Array.isArray(to) ? to : [to]).map((address) => String(address).toLowerCase());
  let response;
  try {
    response = await fetch(`${EMAIL_API_BASE}/${encodeURIComponent(accountId)}/email/sending/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SNAPINK_FROM,
        to: recipients,
        reply_to: replyTo,
        subject,
        text,
      }),
    });
  } catch {
    throw new EmailDeliveryError("Email delivery is temporarily unavailable.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || result?.success !== true) {
    console.error("SnapInk email provider rejected a message", { status: response.status });
    throw new EmailDeliveryError("Email delivery is temporarily unavailable.");
  }

  const delivered = new Set((result.result?.delivered || []).map((address) => String(address).toLowerCase()));
  const queued = new Set((result.result?.queued || []).map((address) => String(address).toLowerCase()));
  const bounced = new Set((result.result?.permanent_bounces || []).map((address) => String(address).toLowerCase()));
  const suppressed = new Set((result.result?.suppressed_recipients || []).map((address) => String(address).toLowerCase()));
  if (recipients.some((address) => bounced.has(address) || suppressed.has(address) || (!delivered.has(address) && !queued.has(address)))) {
    throw new EmailDeliveryError("Email delivery could not be confirmed. Please try again later.");
  }

  return result.result?.message_id || null;
}

export async function enforcePublicFormRateLimit(db, request, apiToken, formName, limit = 5) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return true;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${formName}:${ip}`));
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const windowStartedAt = Math.floor(now / 3600) * 3600;

  await db.prepare(`CREATE TABLE IF NOT EXISTS public_form_rate_limits (
    fingerprint TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    PRIMARY KEY (fingerprint, window_started_at)
  )`).run();
  await db.prepare(`INSERT INTO public_form_rate_limits (fingerprint, window_started_at, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(fingerprint, window_started_at) DO UPDATE SET request_count=request_count+1`)
    .bind(fingerprint, windowStartedAt).run();
  const row = await db.prepare("SELECT request_count AS requestCount FROM public_form_rate_limits WHERE fingerprint=? AND window_started_at=?")
    .bind(fingerprint, windowStartedAt).first();
  await db.prepare("DELETE FROM public_form_rate_limits WHERE window_started_at < ?").bind(windowStartedAt - 86400).run();
  return Number(row?.requestCount || 0) <= limit;
}
