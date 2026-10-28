const GUIDE_KEY = "partner-guides/SnapInk_Embroidery_Production_Guide_Hat_Launch.pdf";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function onRequestGet({ request, env }) {
  const secret = env.PARTNER_PORTAL_TOKEN;
  if (!secret || !env.PRIVATE_ASSETS) {
    return new Response(JSON.stringify({ error: "Partner access is not configured." }), {
      status: 503,
      headers: { ...noStoreHeaders, "Content-Type": "application/json" },
    });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Approved partner access is required." }), {
      status: 401,
      headers: { ...noStoreHeaders, "Content-Type": "application/json" },
    });
  }

  const guide = await env.PRIVATE_ASSETS.get(GUIDE_KEY);
  if (!guide) {
    return new Response(JSON.stringify({ error: "The partner guide has not been provisioned in private storage." }), {
      status: 503,
      headers: { ...noStoreHeaders, "Content-Type": "application/json" },
    });
  }

  const headers = new Headers({
    ...noStoreHeaders,
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="SnapInk_Embroidery_Production_Guide_Hat_Launch.pdf"',
  });
  if (Number.isFinite(guide.size)) headers.set("Content-Length", String(guide.size));
  return new Response(guide.body, { headers });
}
