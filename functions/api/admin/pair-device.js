import { bearer, digest, json, now, randomId } from "../../_lib/orders.js";

export async function onRequestPost({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  const { name } = await request.json().catch(() => ({}));
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 80) return json({ error: "Enter a device name between 2 and 80 characters." }, 400);
  const token = randomId(32);
  const id = randomId(12);
  await env.DB.prepare("INSERT INTO production_devices(id,name,token_sha256,paired_at) VALUES(?,?,?,?)").bind(id,name.trim(),await digest(token),now()).run();
  return json({ ok:true,device:{id,name:name.trim()},token,message:"Copy this pairing token into the Windows companion now. It is shown only once." },201);
}

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  try {
    const { results } = await env.DB.prepare("SELECT id,name,active,paired_at AS pairedAt,last_seen_at AS lastSeenAt FROM production_devices ORDER BY paired_at DESC").all();
    return json({ devices: results || [] });
  } catch { return json({ error: "Device list is unavailable." }, 503); }
}

export async function onRequestDelete({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string") return json({ error: "Device ID is required." }, 400);
  const result = await env.DB.prepare("UPDATE production_devices SET active=0 WHERE id=? AND active=1").bind(id).run();
  return result.meta?.changes ? json({ ok: true, id }) : json({ error: "Active device not found." }, 404);
}
