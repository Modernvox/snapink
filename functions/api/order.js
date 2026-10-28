export async function onRequestPost(context) {
  // Production ordering stays closed until SnapInk provisions a partner-only
  // server secret. The public design demo must never be an ordering path.
  const partnerToken = context.env.PARTNER_ORDER_TOKEN;
  if (!partnerToken || context.request.headers.get("authorization") !== `Bearer ${partnerToken}`) {
    return new Response(JSON.stringify({ error: "Partner authorization required." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  try {
    const data = await context.request.json();

    const formatted = `
New SnapInk Custom Strap Order
-----------------------------------
Name: ${data.customerName || "N/A"}
Email: ${data.customerEmail || "N/A"}

Draft:
${JSON.stringify(data.draft, null, 2)}

Submitted At: ${data.submittedAt}
`;

    // MailChannels email payload
    const emailPayload = {
      personalizations: [
        {
          to: [{ email: "orders@snapinkhats.com" }]
        }
      ],
      from: {
        email: "orders@snapinkhats.com",
        name: "SnapInk Orders",
        domain: "snapinkhats.com"
      },
      subject: "🧵 New SnapInk Strap Order",
      content: [
        {
          type: "text/plain",
          value: formatted
        }
      ]
    };

    // Send through MailChannels (Cloudflare built-in)
    const result = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload)
    });

    if (!result.ok) {
      const text = await result.text();
      throw new Error("MailChannels error: " + text);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
