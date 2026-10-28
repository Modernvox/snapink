import { now, randomId } from "./orders.js";

export async function addProductionBatch(env, { orderId, quantity, note = null }) {
  if (!env.DB) return { status: 503, body: { error: "Order storage is unavailable." } };
  if (typeof orderId !== "string" || !orderId) return { status: 400, body: { error: "Order ID is required." } };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return { status: 400, body: { error: "Batch quantity must be a whole number from 1 through 50." } };

  const id = randomId(16);
  const createdAt = now();
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 200) || null : null;
  const details = JSON.stringify({ quantity, note: cleanNote });
  try {
    const statements = [
      env.DB.prepare(`INSERT INTO production_batches (id,order_id,batch_number,quantity,note,created_at)
        SELECT ?, ?, COALESCE((SELECT MAX(batch_number)+1 FROM production_batches WHERE order_id=?),1), ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM orders o JOIN production_jobs j ON j.order_id=o.id
          WHERE o.id=? AND o.status='in_production' AND j.status='opened'
            AND COALESCE((SELECT SUM(quantity) FROM production_batches WHERE order_id=o.id),0)+? <= o.quantity
        )`).bind(id, orderId, orderId, quantity, cleanNote, createdAt, orderId, quantity),
      env.DB.prepare(`UPDATE orders SET quantity_completed=(SELECT COALESCE(SUM(quantity),0) FROM production_batches WHERE order_id=?),updated_at=?
        WHERE id=? AND EXISTS (SELECT 1 FROM production_batches WHERE id=?)`).bind(orderId, createdAt, orderId, id),
      env.DB.prepare(`INSERT INTO order_events(order_id,actor,event,detail_json,created_at)
        SELECT ?,'admin','production_batch_recorded',?,? WHERE EXISTS (SELECT 1 FROM production_batches WHERE id=?)`).bind(orderId, details, createdAt, id),
      env.DB.prepare(`INSERT INTO production_events(job_id,status,message,created_at)
        SELECT j.id,'batch_recorded',?,? FROM production_jobs j
        WHERE j.order_id=? AND EXISTS (SELECT 1 FROM production_batches WHERE id=?)`).bind(`Recorded production batch of ${quantity} unit${quantity === 1 ? "" : "s"}.`, createdAt, orderId, id),
    ];
    const [insertResult] = await env.DB.batch(statements);
    if (!insertResult?.meta?.changes) {
      const order = await env.DB.prepare(`SELECT o.status,o.quantity,j.status AS job_status,
        COALESCE((SELECT SUM(quantity) FROM production_batches WHERE order_id=o.id),0) AS produced
        FROM orders o LEFT JOIN production_jobs j ON j.order_id=o.id WHERE o.id=?`).bind(orderId).first();
      if (!order) return { status: 404, body: { error: "Order not found." } };
      if (order.status !== "in_production" || order.job_status !== "opened") return { status: 409, body: { error: "A project must be open in Snapmaker Orca and the order must be In Production before recording a batch." } };
      return { status: 409, body: { error: `This batch exceeds the remaining ${Math.max(0, order.quantity - order.produced)} unit${order.quantity - order.produced === 1 ? "" : "s"}.` } };
    }
    const [batch, totals] = await Promise.all([
      env.DB.prepare("SELECT id,batch_number AS batchNumber,quantity,note,created_at AS createdAt FROM production_batches WHERE id=?").bind(id).first(),
      env.DB.prepare("SELECT o.quantity,COALESCE(SUM(b.quantity),0) AS quantityProduced FROM orders o LEFT JOIN production_batches b ON b.order_id=o.id WHERE o.id=? GROUP BY o.id").bind(orderId).first(),
    ]);
    return { status: 201, body: { ok: true, batch, quantityOrdered: totals.quantity, quantityProduced: totals.quantityProduced, quantityRemaining: totals.quantity - totals.quantityProduced } };
  } catch (error) {
    console.error("Production batch recording failed", error instanceof Error ? error.message : "unknown");
    return { status: 503, body: { error: "Unable to record this production batch. Refresh and retry." } };
  }
}
