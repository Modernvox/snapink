// /functions/api/waitlist.js
const RECIPIENT = "earlyaccess@snapinkhats.com";   // notification recipient
const FROM      = "noreply@snapinkhats.com";       // sender identity
const ORIGIN    = "https://snapinkhats.com";       // allowed origin

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    let email = "";

    if (ct.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      email = (body.email || "").trim().toLowerCase();
    } else {
      const body = await request.text();
      email = (new URLSearchParams(body).get("email") || "").trim().toLowerCase();
    }

    // Basic validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "Invalid email" }, 400);
    }

    // ---- SAVE TO KV ----
    const record = {
      email,
      ts: new Date().toISOString(),
      ua: request.headers.get("user-agent") || "",
      ip: request.headers.get("cf-connecting-ip") || "",
      country: (request.cf && request.cf.country) || "",
    };
    const key = `email:${email}`;
    await env.WAITLIST.put(key, JSON.stringify(record), {
      metadata: { email, ts: record.ts },
    });

    // ---- NOTIFY VIA MAILCHANNELS ----
    await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: RECIPIENT }] }],
        from: { email: FROM, name: "SnapInk Waitlist" },
        subject: "New waitlist signup",
        reply_to: [{ email, name: email }],
        content: [
          {
            type: "text/plain",
            value: `New signup:\n\nEmail: ${email}\nTime: ${record.ts}\nIP: ${record.ip}\nUA: ${record.ua}`,
          },
        ],
      }),
    }).catch(err => console.error("MailChannels error:", err));

    return json({ ok: true }, 200);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "Server error" }, 500);
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...cors() },
  });
}
