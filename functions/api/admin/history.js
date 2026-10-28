import { bearer, json } from "../../_lib/orders.js";
export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "Order ID is required." }, 400);
  try {
    const order = await env.DB.prepare("SELECT id,order_number AS orderNumber,status,created_at AS createdAt FROM orders WHERE id=?").bind(id).first();
    if (!order) return json({ error: "Order not found." }, 404);
    const events = await env.DB.prepare("SELECT actor,event,detail_json AS detail,created_at AS createdAt FROM order_events WHERE order_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all();
    const job = await env.DB.prepare("SELECT id FROM production_jobs WHERE order_id=?").bind(id).first();
    const production = job ? await env.DB.prepare("SELECT status,message,created_at AS createdAt FROM production_events WHERE job_id=? ORDER BY created_at DESC LIMIT 100").bind(job.id).all() : { results: [] };
    return json({ order, events: events.results || [], production: production.results || [] });
  } catch (error) {
    console.error("Order history read failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Order history is unavailable." }, 503);
  }
}
