import { EmailDeliveryError, sendSnapInkEmail } from "../_lib/snapink-email.js";

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

    const customerEmail = typeof data.customerEmail === "string" ? data.customerEmail.trim() : "";
    await sendSnapInkEmail(context.env, {
      to: "partners@snapbacksleeves.com",
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ? customerEmail : undefined,
      subject: "New SnapInk Strap Order",
      text: formatted,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err instanceof EmailDeliveryError ? err.status : 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
