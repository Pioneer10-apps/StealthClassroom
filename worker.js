// ============================================================
//  STEALTH CLASSROOM — CLOUDFLARE WORKER
//  Paste this entire file into your Worker editor and Deploy
// ============================================================
//
//  ENVIRONMENT VARIABLES TO SET IN CLOUDFLARE DASHBOARD:
//  (Worker → Settings → Variables → Add variable)
//
//  STRIPE_SECRET_KEY      → sk_live_...   (from Stripe Dashboard → Developers → API Keys)
//  STRIPE_WEBHOOK_SECRET  → whsec_...     (from Stripe Dashboard → Webhooks → your endpoint)
//  STRIPE_PRICE_ID        → price_1...    (from Stripe Dashboard → Products → Theme Bundle → Price ID)
//  ADMIN_SECRET           → any random string you choose (for admin access only)
//
//  KV NAMESPACE:
//  Create a KV namespace called STEALTH_CODES in Workers → KV
//  Then bind it to this worker: Worker → Settings → Variables → KV Namespace Bindings
//  Variable name: STEALTH_CODES
//
// ============================================================

const ALLOWED_ORIGINS = [
  'https://stealthclassroom.com',
  'https://www.stealthclassroom.com',
  'https://dibbleandseed.github.io',
];

function getCors(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
    'Content-Type': 'application/json',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = getCors(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── POST /create-checkout ─────────────────────────────
    if (path === '/create-checkout' && request.method === 'POST') {
      try {
        const body = await request.json();
        const email = (body.email || '').trim();

        const params = {
          'payment_method_types[]': 'card',
          'line_items[0][price]': env.STRIPE_PRICE_ID,
          'line_items[0][quantity]': '1',
          'mode': 'payment',
          'ui_mode': 'embedded',
          'return_url': `https://stealthclassroom.com/success?session_id={CHECKOUT_SESSION_ID}`,
          'metadata[product]': 'theme_bundle',
        };

        // Only add email if one was provided — avoids Stripe rejecting fake emails
        if (email && email.includes('@')) {
          params['customer_email'] = email;
        }

        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(params),
        });

        const session = await response.json();

        if (session.error) {
          return new Response(JSON.stringify({ error: session.error.message }), { status: 400, headers: cors });
        }

        return new Response(JSON.stringify({
          clientSecret: session.client_secret,
          sessionId: session.id,
        }), { headers: cors });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
      }
    }

    // ── POST /webhook ─────────────────────────────────────
    if (path === '/webhook' && request.method === 'POST') {
      const sig = request.headers.get('stripe-signature');
      const rawBody = await request.text();

      let event;
      try {
        event = await verifyStripeWebhook(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400, headers: cors });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email || '';
        const sessionId = session.id;

        const code = generateCode();

        await env.STEALTH_CODES.put(`code:${code}`, JSON.stringify({
          email,
          sessionId,
          activations: 0,       // track uses rather than burning the code
          maxActivations: 3,    // allow up to 3 devices (iPad, laptop, home)
          createdAt: new Date().toISOString(),
        }), { expirationTtl: 157680000 });

        await env.STEALTH_CODES.put(`session:${sessionId}`, code, { expirationTtl: 157680000 });

        await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'metadata[unlock_code]': code,
          }),
        });
      }

      return new Response(JSON.stringify({ received: true }), { headers: cors });
    }

    // ── GET /get-code?session_id=... ──────────────────────
    if (path === '/get-code' && request.method === 'GET') {
      const sessionId = url.searchParams.get('session_id');
      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Missing session_id' }), { status: 400, headers: cors });
      }

      const code = await env.STEALTH_CODES.get(`session:${sessionId}`);
      if (!code) {
        return new Response(JSON.stringify({ error: 'Code not found. Please wait a moment and refresh.' }), { status: 404, headers: cors });
      }

      return new Response(JSON.stringify({ code }), { headers: cors });
    }

    // ── POST /verify-code ─────────────────────────────────
    if (path === '/verify-code' && request.method === 'POST') {
      try {
        const body = await request.json();
        const code = (body.code || '').trim().toUpperCase();

        if (!code) {
          return new Response(JSON.stringify({ valid: false, error: 'No code provided' }), { status: 400, headers: cors });
        }

        const raw = await env.STEALTH_CODES.get(`code:${code}`);
        if (!raw) {
          return new Response(JSON.stringify({ valid: false, error: 'Invalid code. Check for typos or contact support.' }), { headers: cors });
        }

        const data = JSON.parse(raw);

        // Allow up to maxActivations devices instead of burning on first use
        if (data.activations >= data.maxActivations) {
          return new Response(JSON.stringify({ valid: false, error: 'This code has reached its device limit. Contact support at stealthclassroom.com.' }), { headers: cors });
        }

        data.activations += 1;
        data.lastUsedAt = new Date().toISOString();
        await env.STEALTH_CODES.put(`code:${code}`, JSON.stringify(data), { expirationTtl: 157680000 });

        return new Response(JSON.stringify({ valid: true }), { headers: cors });

      } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: err.message }), { status: 500, headers: cors });
      }
    }

    // ── POST /save-class ──────────────────────────────────
    // Saves class name + points against a PIN
    if (path === '/save-class' && request.method === 'POST') {
      try {
        const body = await request.json();
        const pin = (body.pin || '').trim();
        const className = (body.className || '').trim();
        const points = body.points ?? 0;

        if (!pin || pin.length !== 6) {
          return new Response(JSON.stringify({ ok: false, error: 'PIN must be 6 digits' }), { status: 400, headers: cors });
        }
        if (!className) {
          return new Response(JSON.stringify({ ok: false, error: 'Class name required' }), { status: 400, headers: cors });
        }

        await env.STEALTH_CODES.put(`class:${pin}`, JSON.stringify({
          className,
          points,
          savedAt: new Date().toISOString(),
        }), { expirationTtl: 157680000 });

        return new Response(JSON.stringify({ ok: true }), { headers: cors });

      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: cors });
      }
    }

    // ── POST /load-class ──────────────────────────────────
    // Loads class name + points for a given PIN
    if (path === '/load-class' && request.method === 'POST') {
      try {
        const body = await request.json();
        const pin = (body.pin || '').trim();

        if (!pin) {
          return new Response(JSON.stringify({ ok: false, error: 'PIN required' }), { status: 400, headers: cors });
        }

        const raw = await env.STEALTH_CODES.get(`class:${pin}`);
        if (!raw) {
          return new Response(JSON.stringify({ ok: false, error: 'No class found for that PIN' }), { headers: cors });
        }

        const data = JSON.parse(raw);
        return new Response(JSON.stringify({ ok: true, ...data }), { headers: cors });

      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: cors });
      }
    }

    // ── 404 ───────────────────────────────────────────────
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
  }
};

// ── HELPERS ───────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SC-${segment(4)}-${segment(4)}-${segment(4)}`;
}

async function verifyStripeWebhook(payload, sigHeader, secret) {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  const signedPayload = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== signature) throw new Error('Signature mismatch');
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');

  return JSON.parse(payload);
}
