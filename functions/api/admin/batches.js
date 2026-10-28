import { bearer, json } from "../../_lib/orders.js";
import { addProductionBatch } from "../../_lib/production-batches.js";

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) return json({ error: "Order ID is required." }, 400);
  try {
    const [order, batches] = await Promise.all([
      env.DB.prepare("SELECT quantity,quantity_completed AS quantityProduced FROM orders WHERE id=?").bind(orderId).first(),
      env.DB.prepare("SELECT batch_number AS batchNumber,quantity,note,created_at AS createdAt FROM production_batches WHERE order_id=? ORDER BY batch_number").bind(orderId).all(),
    ]);
    if (!order) return json({ error: "Order not found." }, 404);
    const quantityProduced = (batches.results || []).reduce((total, batch) => total + batch.quantity, 0);
    return json({ batches: batches.results || [], quantityOrdered: order.quantity, quantityProduced, quantityRemaining: order.quantity - quantityProduced });
  } catch (error) {
    console.error("Production batch history read failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Production batch history is unavailable." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const result = await addProductionBatch(env, {
    orderId: body.orderId,
    quantity: body.quantity,
    note: body.note,
  });
  return json(result.body, result.status);
}
