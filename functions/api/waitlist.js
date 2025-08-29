function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Optional: hash or key-prefix to avoid storing raw email as the key.
// Here we store JSON under a prefix with the plain email as the *value*.
function keyFor(email) {
  return `wl:${email.toLowerCase().trim()}`;
}

export async function onRequestPost({ request, env }) {
  try {
    const { email, source } = await request.json().catch(() => ({}));
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    const key = keyFor(email);
    const exists = await env.WAITLIST.get(key);

    if (exists) {
      // already on list
      return new Response(JSON.stringify({ ok: true, status: 'duplicate' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    const payload = JSON.stringify({
      email: email.toLowerCase().trim(),
      source: (source || 'site').slice(0, 64),
      created_at: new Date().toISOString()
    });

    await env.WAITLIST.put(key, payload);

    return new Response(JSON.stringify({ ok: true, status: 'added' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}
