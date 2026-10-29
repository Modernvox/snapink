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

function reject(request, reason, message, status = 400, fields) {
  console.warn("SnapInk contact request rejected", {
    ray: request.headers.get("cf-ray") || undefined,
    reason,
    ...(fields ? { fields } : {}),
  });
  return json({ error: message, code: reason, ...(fields ? { fields } : {}) }, status);
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return reject(request, "origin_not_allowed", "Unable to submit this message.", 403);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return reject(request, "body_too_large", "Message is too large.", 413);

  let data;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return reject(request, "body_too_large", "Message is too large.", 413);
    }
    data = JSON.parse(raw);
  } catch {
    return reject(request, "invalid_json", "Enter your contact details and message, then try again.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return reject(request, "invalid_payload", "Enter your contact details and message, then try again.");
  }
  const name = cleanText(data.name, 120);
  const email = cleanText(data.email, 254)?.toLowerCase();
  const message = cleanText(data.message, 5000);
  const inquiry = INQUIRIES[data.inquiryType];
  const invalidFields = [];
  if (!name) invalidFields.push("name");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalidFields.push("email");
  if (!message) invalidFields.push("message");
  if (!inquiry) invalidFields.push("inquiryType");
  if (invalidFields.length) {
    return reject(
      request,
      "invalid_fields",
      "Check the required fields and enter a valid email address.",
      400,
      invalidFields,
    );
  }
  if (!env.DB) {
    return reject(request, "database_unavailable", "The contact form is temporarily unavailable. Please try again later.", 503);
  }
  if (!env.CLOUDFLARE_EMAIL_API_TOKEN) {
    return reject(request, "email_not_configured", "The contact form is temporarily unavailable. Please try again later.", 503);
  }

  try {
    if (!(await enforcePublicFormRateLimit(env.DB, request, env.CLOUDFLARE_EMAIL_API_TOKEN, "contact", 5))) {
      return reject(request, "rate_limited", "Too many messages were submitted. Please wait and try again.", 429);
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
    console.info("SnapInk contact notification accepted", {
      ray: request.headers.get("cf-ray") || undefined,
      inquiryType: data.inquiryType,
    });
    return json({ ok: true });
  } catch (error) {
    console.error("SnapInk contact notification failed", {
      ray: request.headers.get("cf-ray") || undefined,
      reason: error instanceof EmailDeliveryError ? "email_provider_failure" : "unexpected_failure",
      errorType: error instanceof Error ? error.name : "unknown",
      ...(error instanceof EmailDeliveryError ? { status: error.status } : {}),
    });
    return json({ error: "Your message could not be delivered. Please try again later." }, error instanceof EmailDeliveryError ? error.status : 503);
  }
}
