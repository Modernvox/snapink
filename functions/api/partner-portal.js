export async function onRequestGet({ request, env }) {
  const secret = env.PARTNER_PORTAL_TOKEN;
  if (!secret) return new Response(JSON.stringify({ error: "Partner access is not configured." }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return new Response(JSON.stringify({ ok: true, access: "pilot-partner" }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
