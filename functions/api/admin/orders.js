import { bearer, deviceFor, json, now, randomId } from "../../_lib/orders.js";

import { addProductionBatch } from "../../_lib/production-batches.js";

export async function onRequestGet({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const rows = await env.DB.prepare(`SELECT o.id,o.order_number AS orderNumber,o.customer_name AS customerName,o.customer_email AS customerEmail,o.customer_phone AS customerPhone,o.quantity,COALESCE((SELECT SUM(b.quantity) FROM production_batches b WHERE b.order_id=o.id),0) AS quantityCompleted,COALESCE((SELECT SUM(b.quantity) FROM production_batches b WHERE b.order_id=o.id),0) AS quantityProduced,o.quantity-COALESCE((SELECT SUM(b.quantity) FROM production_batches b WHERE b.order_id=o.id),0) AS quantityRemaining,o.variant,o.size,o.status,o.draft_json AS draftJson,o.created_at AS createdAt,o.updated_at AS updatedAt,j.id AS jobId,j.status AS jobStatus,j.error AS jobError,j.attempt AS jobAttempt,p.stage AS jobStage,p.message AS jobStageMessage FROM orders o LEFT JOIN production_jobs j ON j.order_id=o.id LEFT JOIN production_job_progress p ON p.job_id=j.id WHERE (?='' OR o.status=?) AND (?='' OR o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?) ORDER BY o.created_at DESC LIMIT 500`)
      .bind(status || "", status || "", q, `%${q}%`, `%${q}%`, `%${q}%`).all();
    return json({ orders: rows.results || [] });
  } catch (error) {
    console.error("Admin order list failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Order storage is not initialized. Apply all production migrations in order." }, 503);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!bearer(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Order storage is unavailable." }, 503);
  try {
    const body = await request.json();
    const { id, status } = body;
    if (typeof id !== "string") return json({ error: "Provide an order ID." }, 400);
    if (Object.hasOwn(body, "quantityCompleted")) {
      const current = await env.DB.prepare("SELECT status,quantity,quantity_completed FROM orders WHERE id=?").bind(id).first();
      if (!current) return json({ error: "Order not found." }, 404);
      if (!Number.isInteger(body.quantityCompleted) || body.quantityCompleted < current.quantity_completed || body.quantityCompleted > current.quantity) return json({ error: "Produced quantity cannot be reduced and cannot exceed the requested quantity." }, 400);
      if (current.status !== "in_production") return json({ error: "Quantity can be accounted only while the order is In Production." }, 409);
      if (body.quantityCompleted === current.quantity_completed) return json({ ok: true, id, quantityCompleted: current.quantity_completed, quantity: current.quantity, quantityRemaining: current.quantity-current.quantity_completed });
      const result = await addProductionBatch(env,{orderId:id,quantity:body.quantityCompleted-current.quantity_completed,note:"Recorded as a production batch from the cumulative quantity control."});
      return json(result.body,result.status);
    }
    const allowed = ["new", "in_review", "ready", "in_production", "completed", "shipped", "cancelled"];
    if (!allowed.includes(status)) return json({ error: "Provide a valid order status." }, 400);
    const current = await env.DB.prepare("SELECT status,quantity,quantity_completed FROM orders WHERE id=?").bind(id).first();
    if (!current) return json({ error: "Order not found." }, 404);
    const allowedNext = { new:["in_review","cancelled"], in_review:["new","ready","cancelled"], ready:["in_review","in_production","cancelled"], in_production:["completed","cancelled"], completed:["shipped"], shipped:[], cancelled:["in_review"] };
    if (!allowedNext[current.status]?.includes(status)) return json({ error: "Cannot move an order from " + current.status + " to " + status + "." }, 409);
    let job = null;
    if (status === "in_production" || status === "completed") {
      job = await env.DB.prepare("SELECT id,status FROM production_jobs WHERE order_id=?").bind(id).first();
      if (!job || job.status !== "opened") return json({ error: "A validated job must be opened in Snapmaker Orca before recording in-production or completion." }, 409);
    }
    if (status === "completed") {
      const accounted = await env.DB.prepare("SELECT COALESCE(SUM(quantity),0) AS produced FROM production_batches WHERE order_id=?").bind(id).first();
      const produced = accounted?.produced || 0;
      if (produced < current.quantity) return json({ error: `Record all ${current.quantity} produced units before completing this order (${produced} recorded).` }, 409);
    }
    const time = now();
    const result = await env.DB.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND status=?").bind(status,time,id,current.status).run();
    if (!result.meta?.changes) return json({ error: "Order status changed in another session. Refresh and retry." }, 409);
    await env.DB.prepare("INSERT INTO order_events(order_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?)").bind(id,"admin","status_changed",JSON.stringify({ from: current.status, to: status }),time).run();
    if (status === "completed" && job) {
      await env.DB.prepare("UPDATE production_jobs SET status='completed',updated_at=? WHERE id=? AND status='opened'").bind(time,job.id).run();
      await env.DB.prepare("INSERT INTO production_events(job_id,status,message,created_at) VALUES(?,?,?,?)").bind(job.id,"completed","Marked complete by owner after production review.",time).run();
    }
    return json({ ok: true, id, status });
  } catch (error) {
    console.error("Admin order update failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Unable to update this order." }, 500);
  }
}
