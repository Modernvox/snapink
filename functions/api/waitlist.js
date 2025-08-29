function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function onRequestPost({ request, env }) {
  try {
    let email = null;

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      // handle JSON POST
      const body = await request.json();
      email = (body.email || "").trim().toLowerCase();
    } else {
      // handle HTML <form> POST
      const form = await request.formData();
      email = (form.get("email") || "").trim().toLowerCase();
    }

    if (!isValidEmail(email)) {
      return Response.redirect(
        new URL("/?error=invalid#waitlist", request.url),
        303
      );
    }

    // check if already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM waitlist WHERE email = ?"
    ).bind(email).first();

    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO waitlist (email, created_at) VALUES (?, ?)"
      ).bind(email, new Date().toISOString()).run();
    }

    return Response.redirect(
      new URL("/?joined=1#waitlist", request.url),
      303
    );

  } catch (err) {
    console.error("Waitlist error:", err.message);
    return Response.redirect(
      new URL("/?error=server#waitlist", request.url),
      303
    );
  }
}
