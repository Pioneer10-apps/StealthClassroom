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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers — allow your GitHub Pages domain
    const cors = {
      'Access-Control-Allow-Origin': 'https://stealthclassroom.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ── POST /create-checkout ─────────────────────────────
    // Called by your landing page when teacher clicks "Buy $5"
    if (path === '/create-checkout' && request.method === 'POST') {
      try {
        const body = await request.json();
        const email = body.email || '';

        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'payment_method_types[]': 'card',
            'line_items[0][price]': env.STRIPE_PRICE_ID,
            'line_items[0][quantity]': '1',
            'mode': 'payment',
            'ui_mode': 'embedded',
            'return_url': `https://stealthclassroom.com/success?session_id={CHECKOUT_SESSION_ID}`,
            'customer_email': email,
            'metadata[product]': 'theme_bundle',
          }),
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
    // Stripe calls this after successful payment
    if (path === '/webhook' && request.method === 'POST') {
      const sig = request.headers.get('stripe-signature');
      const rawBody = await request.text();

      // Verify webhook signature
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

        // Generate unique code
        const code = generateCode();

        // Store in KV: code → email + sessionId, with 5 year expiry
        await env.STEALTH_CODES.put(`code:${code}`, JSON.stringify({
          email,
          sessionId,
          used: false,
          createdAt: new Date().toISOString(),
        }), { expirationTtl: 157680000 }); // 5 years

        // Also index by session so success page can retrieve code
        await env.STEALTH_CODES.put(`session:${sessionId}`, code, { expirationTtl: 157680000 });

        // Send email via Stripe (the receipt will include metadata)
        // Note: Stripe automatically emails the customer their receipt.
        // We store the code in the session metadata so it shows on the receipt page.
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
    // Called by success page to retrieve the unique code
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
    // Called by the app when teacher enters their unlock code
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

        if (data.used) {
          return new Response(JSON.stringify({ valid: false, error: 'This code has already been used on another device.' }), { headers: cors });
        }

        // Mark as used
        data.used = true;
        data.usedAt = new Date().toISOString();
        await env.STEALTH_CODES.put(`code:${code}`, JSON.stringify(data), { expirationTtl: 157680000 });

        return new Response(JSON.stringify({ valid: true }), { headers: cors });

      } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: err.message }), { status: 500, headers: cors });
      }
    }

    // ── 404 ───────────────────────────────────────────────
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: cors });
  }
};

// ── HELPERS ───────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  const segment = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `SC-${segment(4)}-${segment(4)}-${segment(4)}`;
}

// Stripe webhook signature verification (Web Crypto API)
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

  // Reject if timestamp is older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) throw new Error('Timestamp too old');

  return JSON.parse(payload);
}
