// /functions/api/waitlist.js  — Cloudflare Pages Function
const RECIPIENT = "earlyaccess@snapinkhats.com";   // your alias (already forwarding)
const FROM      = "noreply@snapinkhats.com";       // sender identity
const ORIGIN    = "https://snapinkhats.com";       // your domain

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPost({ request }) {
  const ct = request.headers.get("content-type") || "";
  let email = "";

  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    email = (body.email || "").trim();
  } else {
    const body = await request.text();
    email = (new URLSearchParams(body).get("email") || "").trim();
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Invalid email" }, 400);
  }

  // Send a notification email via MailChannels (free with CF)
  await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: RECIPIENT }] }],
      from: { email: FROM, name: "SnapInk Waitlist" },
      subject: "New waitlist signup",
      reply_to: [{ email, name: email }],
      content: [
        { type: "text/plain", value: `Email: ${email}\nTime: ${new Date().toISOString()}` }
      ]
    })
  });

  return json({ ok: true }, 200);
}

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type"
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors() }
  });
}
