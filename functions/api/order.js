export async function onRequestPost(context) {
  try {
    const data = await context.request.json();

    const formatted = [
      `New SnapInk Custom Strap Order`,
      `-----------------------------------`,
      `Name: ${data.customerName || "N/A"}`,
      `Email: ${data.customerEmail || "N/A"}`,
      ``,
      `Draft:`,
      JSON.stringify(data.draft, null, 2),
      ``,
      `Submitted At: ${data.submittedAt}`,
    ].join("\n");

    const email = {
      from: "no-reply@snapinkhats.com",
      personalizations: [
        { to: [{ email: "orders@snapinkhats.com" }] },
      ],
      subject: "🧵 New SnapInk Strap Order",
      content: [{ type: "text/plain", value: formatted }],
    };

    await context.env.SEND_EMAIL(email);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
