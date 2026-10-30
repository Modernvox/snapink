import { bearer, json, now } from "../../_lib/orders.js";

const STATUSES = ["pending_review", "reviewed", "contacted"];

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Design draft storage is unavailable." }, 503);
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "";
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (status && !STATUSES.includes(status)) return json({ error: "Unsupported draft status." }, 400);
    const rows = await env.DB.prepare(`SELECT id,reference,customer_name AS customerName,customer_email AS customerEmail,customer_phone AS customerPhone,quantity,variant,size,status,draft_json AS draftJson,preview_key AS previewKey,artwork_key AS artworkKey,source_artwork_key AS sourceArtworkKey,notification_status AS notificationStatus,notification_error AS notificationError,created_at AS createdAt,updated_at AS updatedAt
      FROM design_drafts WHERE (?='' OR status=?) AND (?='' OR reference LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?) ORDER BY created_at DESC LIMIT 250`)
      .bind(status,status,query,`%${query}%`,`%${query}%`,`%${query}%`).all();
    return json({ drafts: rows.results || [] });
  } catch (error) {
    console.error("Admin design draft list failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Design draft storage is not initialized. Apply the latest D1 migrations." }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Design draft storage is unavailable." }, 503);
  try {
    const data = await request.json();
    if (typeof data.id !== "string" || !/^[a-f0-9]{32}$/.test(data.id) || !STATUSES.includes(data.status)) return json({ error: "Choose a valid draft and review status." }, 400);
    const result = await env.DB.prepare("UPDATE design_drafts SET status=?,updated_at=? WHERE id=?")
      .bind(data.status, now(), data.id).run();
    if (!result.meta?.changes) return json({ error: "Design draft not found." }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error("Admin design draft update failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Unable to update this design draft." }, 500);
  }
}
