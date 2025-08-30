// functions/api/waitlist.js

// Simple email validator: checks for characters before/after “@” and a dot.
function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Health check: returns JSON describing DB connectivity
export async function onRequestGet({ env }) {
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return new Response(
      JSON.stringify({ ok: true, db: !!env.DB, test: row?.ok === 1 }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Handles POSTed waitlist form submissions
export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const email = (form.get("email") || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return Response.redirect(
        new URL("/?error=invalid#waitlist", request.url),
        303
      );
    }

    // Check if the email already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM waitlist WHERE email = ?"
    )
      .bind(email)
      .first();

    // Insert email and timestamp if new
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO waitlist (email, created_at) VALUES (?, ?)"
      )
        .bind(email, new Date().toISOString())
        .run();
    }

    return Response.redirect(
      new URL("/?joined=1#waitlist", request.url),
      303
    );

  } catch (err) {
    console.error("waitlist POST error:", err);
    return Response.redirect(
      new URL("/?error=server#waitlist", request.url),
      303
    );
  }
}
