import { digest, randomId } from "../_lib/orders.js";

const MAX_BODY = 16_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS pilot_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    website TEXT,
    business_type TEXT NOT NULL,
    intended_use TEXT NOT NULL,
    monthly_demand TEXT NOT NULL,
    sample_style TEXT,
    comments TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`).run();
  const { results: columns } = await db.prepare("PRAGMA table_info(pilot_applications)").all();
  if (!columns.some((column) => column.name === "phone")) {
    await db.prepare("ALTER TABLE pilot_applications ADD COLUMN phone TEXT").run();
  }
  if (!columns.some((column) => column.name === "sample_style")) {
    await db.prepare("ALTER TABLE pilot_applications ADD COLUMN sample_style TEXT").run();
  }
}

function bearerMatches(request, secret) {
  const header = request.headers.get("authorization") || "";
  return Boolean(secret && header === `Bearer ${secret}`);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Applications are temporarily unavailable." }, 503);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ error: "Application is too large." }, 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return json({ error: "Application is too large." }, 413);
    const data = JSON.parse(raw);
    if (data.phone != null && typeof data.phone !== "string") return json({ error: "Enter a valid phone number." }, 400);
    if (data.phone == null) data.phone = "";
    if (data.sampleStyle != null && !["standard", "billboard"].includes(data.sampleStyle)) {
      return json({ error: "Choose either Standard or Billboard for your sample set." }, 400);
    }
    const fields = {
      businessName: data.businessName,
      contactName: data.contactName,
      email: data.email,
      businessType: data.businessType,
      intendedUse: data.intendedUse,
      monthlyDemand: data.monthlyDemand,
    };
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value !== "string" || !value.trim()) return json({ error: `Please complete ${name}.` }, 400);
    }
    const clean = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email) || clean.email.length > 254) return json({ error: "Enter a valid email address." }, 400);
    const limits = { businessName: 120, contactName: 120, email: 254, phone: 40, website: 300, businessType: 100, intendedUse: 2000, monthlyDemand: 100, comments: 3000 };
    for (const [key, max] of Object.entries(limits)) {
      if (clean[key] != null && (typeof clean[key] !== "string" || clean[key].length > max)) return json({ error: "One or more fields are too long." }, 400);
    }
    if (clean.website && !/^https?:\/\//i.test(clean.website)) return json({ error: "Website must begin with http:// or https://." }, 400);

    await ensureTable(env.DB);
    await env.DB.prepare(`INSERT INTO pilot_applications
      (business_name, contact_name, email, phone, website, business_type, intended_use, monthly_demand, sample_style, comments, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(clean.businessName, clean.contactName, clean.email.toLowerCase(), clean.phone || null, clean.website || null,
        clean.businessType, clean.intendedUse, clean.monthlyDemand, clean.sampleStyle || null, clean.comments || null, new Date().toISOString()).run();
    return json({ ok: true }, 201);
  } catch (error) {
    console.error("Pilot application submission failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Unable to submit right now. Please try again later." }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  if (!bearerMatches(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Application storage is unavailable." }, 503);
  try {
    await ensureTable(env.DB);
    const { results } = await env.DB.prepare(`SELECT id, business_name AS businessName, contact_name AS contactName,
      email, phone, website, business_type AS businessType, intended_use AS intendedUse, monthly_demand AS monthlyDemand,
      sample_style AS sampleStyle,
      comments, status, created_at AS createdAt, reviewed_at AS reviewedAt
      FROM pilot_applications ORDER BY created_at DESC LIMIT 500`).all();
    let partners = [];
    try { partners = (await env.DB.prepare("SELECT id,pilot_application_id AS applicationId,access_status AS accessStatus FROM wholesale_partners").all()).results || []; } catch {}
    const byApplication = new Map(partners.map((partner) => [partner.applicationId, partner]));
    for (const application of results || []) {
      const partner = byApplication.get(application.id);
      application.wholesalePartnerId = partner?.id || null;
      application.partnerAccessStatus = partner?.accessStatus || null;
    }
    return json({ applications: results });
  } catch (error) {
    console.error("Pilot application review failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Unable to retrieve applications." }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  if (!bearerMatches(request, env.ADMIN_REVIEW_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!env.DB) return json({ error: "Application storage is unavailable." }, 503);
  try {
    const body = await request.json();
    const { id } = body;
    const action = body.action || (body.status === "approved" ? "approve" : body.status === "declined" ? "decline" : "");
    if (!Number.isInteger(id) || !["approve", "decline", "issue_access"].includes(action)) return json({ error: "Provide an application id and approve, decline, or issue_access action." }, 400);
    await ensureTable(env.DB);
    let application = await env.DB.prepare("SELECT id,business_name AS businessName,contact_name AS contactName,email,phone,status FROM pilot_applications WHERE id=?").bind(id).first();
    if (!application) return json({ error: "Pilot application not found." }, 404);
    if (action === "decline") {
      if (application.status !== "pending") return json({ error: "Only pending applications can be declined." }, 409);
      await env.DB.prepare("UPDATE pilot_applications SET status='declined',reviewed_at=? WHERE id=? AND status='pending'").bind(new Date().toISOString(),id).run();
      return json({ ok:true,id,status:"declined" });
    }
    if (action === "approve" && application.status === "pending") {
      await env.DB.prepare("UPDATE pilot_applications SET status='approved',reviewed_at=? WHERE id=? AND status='pending'").bind(new Date().toISOString(),id).run();
      application.status = "approved";
    }
    if (application.status !== "approved") return json({ error: "Approve this pilot application before issuing partner access." }, 409);
    let partner = await env.DB.prepare("SELECT id,access_status AS accessStatus FROM wholesale_partners WHERE pilot_application_id=?").bind(id).first();
    if (action === "approve" && partner) return json({ ok:true,id,status:"approved",partner:{id:partner.id,accessStatus:partner.accessStatus},credentialIssued:false });
    const token = `snp_${randomId(32)}`;
    const tokenHash = await digest(token), time = new Date().toISOString();
    if (partner) {
      const oldStatus = partner.accessStatus;
      await env.DB.prepare("UPDATE wholesale_partners SET token_sha256=?,access_status='active',updated_at=? WHERE id=?")
        .bind(tokenHash,time,partner.id).run();
      await env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,'credential_rotated',?,'active',?)")
        .bind(partner.id,String(id),oldStatus,time).run();
    } else {
      const partnerId = randomId(16);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO wholesale_partners(id,pilot_application_id,business_name,contact_name,email,phone,token_sha256,access_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)")
          .bind(partnerId,id,application.businessName,application.contactName,application.email.toLowerCase(),application.phone || null,tokenHash,time,time),
        env.DB.prepare("INSERT INTO wholesale_partner_events(partner_id,actor_id,event_type,from_status,to_status,created_at) VALUES(?,?,'access_issued',NULL,'active',?)")
          .bind(partnerId,String(id),time),
      ]);
      partner = { id:partnerId, accessStatus:"active" };
    }
    return json({ ok:true,id,status:"approved",partner:{id:partner.id,accessStatus:"active"},credentialIssued:true,partnerToken:token });
  } catch (error) {
    console.error("Pilot application decision failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Unable to update application." }, 500);
  }
}
