import { EmailDeliveryError, enforcePublicFormRateLimit, sendSnapInkEmail } from "../_lib/snapink-email.js";

const MAX_BODY_BYTES = 16_000;
const INQUIRIES = {
  support: { label: "Customer support", to: "support@snapbacksleeves.com" },
  partners: { label: "Pilot partners and wholesale", to: "partners@snapbacksleeves.com" },
  general: { label: "General inquiry", to: "hello@snapbacksleeves.com" },
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Unable to submit this message." }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Message is too large." }, 413);

  let data;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Message is too large." }, 413);
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Enter your contact details and message, then try again." }, 400);
  }

  if (typeof data.companyFax === "string" && data.companyFax.trim()) return json({ error: "Unable to submit this message." }, 400);
  const name = cleanText(data.name, 120);
  const email = cleanText(data.email, 254)?.toLowerCase();
  const message = cleanText(data.message, 5000);
  const inquiry = INQUIRIES[data.inquiryType];
  if (!name || !email || !message || !inquiry || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Check the required fields and enter a valid email address." }, 400);
  }
  if (!env.DB) return json({ error: "The contact form is temporarily unavailable. Please try again later." }, 503);
  if (!env.CLOUDFLARE_EMAIL_API_TOKEN) {
    return json({ error: "The contact form is temporarily unavailable. Please try again later." }, 503);
  }

  try {
    if (!(await enforcePublicFormRateLimit(env.DB, request, env.CLOUDFLARE_EMAIL_API_TOKEN, "contact", 5))) {
      return json({ error: "Too many messages were submitted. Please wait and try again." }, 429);
    }
    await sendSnapInkEmail(env, {
      to: inquiry.to,
      replyTo: email,
      subject: `SnapInk website inquiry: ${inquiry.label}`,
      text: [
        `Inquiry type: ${inquiry.label}`,
        `Name: ${name}`,
        `Email: ${email}`,
        "",
        "Message:",
        message,
      ].join("\n"),
    });
    return json({ ok: true });
  } catch (error) {
    if (!(error instanceof EmailDeliveryError)) console.error("Contact form delivery failed.", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Your message could not be delivered. Please try again later." }, error instanceof EmailDeliveryError ? error.status : 503);
  }
}
