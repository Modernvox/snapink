function isValidEmail(e){return typeof e==="string"&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}

// ✅ Health check: curl or visit /api/waitlist to see status
export async function onRequestGet({ env }) {
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return new Response(JSON.stringify({ ok: true, db: !!env.DB, test: row?.ok === 1 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}

// ✅ Main handler (form POST → insert → redirect)
export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const email = (form.get("email") || "").trim().toLowerCase();
    if (!isValidEmail(email)) return Response.redirect("/?error=invalid#waitlist", 303);

    const existing = await env.DB
      .prepare("SELECT id FROM waitlist WHERE email = ?")
      .bind(email)
      .first();

    if (!existing) {
      await env.DB
        .prepare("INSERT INTO waitlist (email, created_at) VALUES (?, ?)")
        .bind(email, new Date().toISOString())
        .run();
    }
    return Response.redirect("/?joined=1#waitlist", 303);
  } catch (err) {
    // Log for Workers & Pages → Deployments → Logs
    console.error("waitlist POST error:", err);
    return Response.redirect("/?error=server#waitlist", 303);
  }
}
