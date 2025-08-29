function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const email = (form.get("email") || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      // invalid → send back with error flag
      return Response.redirect("/?error=invalid#waitlist", 303);
    }

    // check if already exists
    const existing = await env.DB.prepare(
      "SELECT id FROM waitlist WHERE email = ?"
    ).bind(email).first();

    if (!existing) {
      // insert new row
      await env.DB.prepare(
        "INSERT INTO waitlist (email, created_at) VALUES (?, ?)"
      ).bind(email, new Date().toISOString()).run();
    }

    // success or duplicate → always redirect with success flag
    return Response.redirect("/?joined=1#waitlist", 303);

  } catch (err) {
    return Response.redirect("/?error=server#waitlist", 303);
  }
}
