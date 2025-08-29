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
      return Response.redirect("/?error=invalid#waitlist", 303);
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

    return Response.redirect("/?joined=1#waitlist", 303);

  } catch (err) {
    console.error("Waitlist error:", err.message);
    return Response.redirect("/?error=server#waitlist", 303);
  }
}
