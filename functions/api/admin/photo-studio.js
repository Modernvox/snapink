import { bearer, json } from "../../_lib/orders.js";
import { createPhotoBatch } from "../../_lib/photo-render.js";

export async function onRequest(context) {
  if (!bearer(context.request, context.env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  try { return await createPhotoBatch(context); }
  catch (error) { console.error("Photo Studio request failed", error instanceof Error ? error.message : "unknown"); return json({ error: "Private photo storage is unavailable. Apply the photo-render migration and verify the private bucket." }, 503); }
}
