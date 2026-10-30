import { digest, json, now, randomId } from "../_lib/orders.js";
import { partnerCookie, partnerSessionFrom, wholesalePartnerFor } from "../_lib/wholesale-auth.js";

const MAX_LOGIN_BODY = 2048;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const SESSION_DAYS = 30;

async function failedAttempts(env, request, increment = false) {
  const ipHash = await digest(request.headers.get("CF-Connecting-IP") || "unknown");
  const windowStart = Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  if (increment) {
    const row = await env.DB.prepare(`INSERT INTO wholesale_partner_login_limits(ip_sha256,window_started_at,failed_attempts)
      VALUES(?,?,1) ON CONFLICT(ip_sha256,window_started_at)
      DO UPDATE SET failed_attempts=failed_attempts+1 RETURNING failed_attempts`).bind(ipHash,windowStart).first();
    if (windowStart % (60 * 60 * 1000) === 0) await env.DB.prepare("DELETE FROM wholesale_partner_login_limits WHERE window_started_at<?").bind(windowStart-24*60*60*1000).run();
    return Number(row?.failed_attempts || 0);
  }
  const row = await env.DB.prepare("SELECT failed_attempts AS failedAttempts FROM wholesale_partner_login_limits WHERE ip_sha256=? AND window_started_at=?").bind(ipHash,windowStart).first();
  return Number(row?.failedAttempts || 0);
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function onRequestGet({ request, env }) {
  const partner = await wholesalePartnerFor(request, env);
  return json(partner ? { authenticated: true, partner: { id: partner.id, businessName: partner.businessName, contactName: partner.contactName } } : { authenticated: false });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Partner access could not be verified." }, 403);
  if (!env.DB) return json({ error: "Partner access is temporarily unavailable." }, 503);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_LOGIN_BODY) return json({ error: "Partner access could not be verified." }, 400);
  try {
    if (await failedAttempts(env, request) >= MAX_FAILED_LOGINS) return json({ error: "Too many unsuccessful attempts. Wait 15 minutes and try again." }, 429);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_LOGIN_BODY) return json({ error: "Partner access could not be verified." }, 400);
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    const code = typeof data?.code === "string" ? data.code.trim() : "";
    let partner = null;
    if (/^[A-Za-z0-9_-]{32,128}$/.test(code)) {
      const hash = await digest(code);
      partner = await env.DB.prepare(`SELECT id,business_name AS businessName,contact_name AS contactName,email,phone,access_status AS accessStatus,credential_expires_at AS credentialExpiresAt
        FROM wholesale_partners WHERE token_sha256=?`).bind(hash).first();
    }
    const currentTime = Date.now();
    const expiry = partner?.credentialExpiresAt ? Date.parse(partner.credentialExpiresAt) : Infinity;
    if (!partner || partner.accessStatus !== "active" || !Number.isFinite(expiry) && expiry !== Infinity || expiry <= currentTime) {
      await failedAttempts(env, request, true);
      return json({ error: "Access code not recognized or inactive." }, 401);
    }

    const session = randomId(32), sessionHash = await digest(session);
    const createdAt = now(), expiresAt = new Date(currentTime + SESSION_DAYS*24*60*60*1000).toISOString();
    await env.DB.prepare("INSERT INTO wholesale_partner_sessions(session_sha256,partner_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?)")
      .bind(sessionHash,partner.id,createdAt,createdAt,expiresAt).run();
    await env.DB.prepare("UPDATE wholesale_partners SET last_login_at=?,last_seen_at=? WHERE id=? AND access_status='active'")
      .bind(createdAt,createdAt,partner.id).run();
    try {
      await env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,'partner_login',?,?,?)")
        .bind(partner.id,partner.id,partner.accessStatus,partner.accessStatus,createdAt).run();
    } catch (error) {
      console.error("Partner login event could not be recorded", error instanceof Error ? error.message : "unknown");
    }
    const response = json({ ok: true, partner: { businessName: partner.businessName, contactName: partner.contactName } });
    response.headers.append("Set-Cookie", partnerCookie(request,session,SESSION_DAYS*24*60*60));
    return response;
  } catch (error) {
    console.error("Partner login failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Partner access is temporarily unavailable. Please try again." }, 503);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const session = partnerSessionFrom(request);
  if (env.DB && session) {
    try { await env.DB.prepare("DELETE FROM wholesale_partner_sessions WHERE session_sha256=?").bind(await digest(session)).run(); }
    catch (error) { console.error("Partner logout failed", error instanceof Error ? error.message : "unknown"); }
  }
  const response = json({ ok: true });
  response.headers.append("Set-Cookie",partnerCookie(request,"",0));
  return response;
}
