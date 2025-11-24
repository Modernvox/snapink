export async function onRequestPost(context) {
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
        email: "no-reply@snapinkhats.com"
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
