# STEALTH CLASSROOM — DEPLOYMENT GUIDE
## Complete setup: Stripe + Cloudflare Worker + GitHub Pages

---

## WHAT YOU'RE DEPLOYING

| File            | Where it goes          | What it does                          |
|-----------------|------------------------|---------------------------------------|
| landing.html    | GitHub (root/index)    | Marketing page + Stripe checkout      |
| app/index.html  | GitHub (/app folder)   | The actual classroom app              |
| success.html    | GitHub (/success)      | Shows unique code after payment       |
| sw.js           | GitHub (root)          | PWA service worker (offline support)  |
| site.webmanifest| GitHub (root)          | PWA install config                    |
| worker.js       | Cloudflare Worker      | Backend: codes, Stripe webhook        |

---

## STEP 1 — CLOUDFLARE WORKER

### 1a. Paste the worker code
1. Go to dash.cloudflare.com → Workers & Pages
2. Open **stealth-classroom-api**
3. Click **Edit Code**
4. Delete everything and paste the entire contents of `worker.js`
5. Click **Deploy**

### 1b. Create a KV Namespace
1. Left sidebar → **Workers & Pages** → **KV**
2. Click **Create namespace**
3. Name it: `STEALTH_CODES`
4. Click **Add**

### 1c. Bind KV to your Worker
1. Go back to your Worker → **Settings** → **Variables**
2. Scroll to **KV Namespace Bindings**
3. Click **Add binding**
4. Variable name: `STEALTH_CODES`
5. Select the `STEALTH_CODES` namespace you just created
6. Click **Save and deploy**

### 1d. Add Environment Variables
Still in Worker → Settings → Variables → **Environment Variables**

Add these 4 variables (click Add variable for each):

| Variable Name         | Value                                      |
|-----------------------|--------------------------------------------|
| STRIPE_SECRET_KEY     | sk_live_... (from Stripe → Developers → API Keys) |
| STRIPE_WEBHOOK_SECRET | whsec_... (you'll get this in Step 2)      |
| STRIPE_PRICE_ID       | price_1... (from Stripe → Products)        |
| ADMIN_SECRET          | any random string you choose               |

⚠️ **Encrypt all of these** — click the "Encrypt" toggle before saving.

---

## STEP 2 — STRIPE SETUP

### 2a. Create your Product
1. Stripe Dashboard → **Products** → **Add Product**
2. Name: `Stealth Classroom Theme Bundle`
3. Price: `$5.00` → One time
4. Click **Save product**
5. Copy the **Price ID** (looks like `price_1ABC123...`)
6. Add this as `STRIPE_PRICE_ID` in your Worker variables (Step 1d)

### 2b. Add the Webhook
1. Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://stealth-classroom-api.dibbleandseed.workers.dev/webhook`
4. Click **Select events** → find and select: `checkout.session.completed`
5. Click **Add endpoint**
6. Click on your new endpoint → **Signing secret** → **Reveal**
7. Copy the `whsec_...` value
8. Add this as `STRIPE_WEBHOOK_SECRET` in your Worker variables (Step 1d)

### 2c. Get your Publishable Key
1. Stripe Dashboard → **Developers** → **API Keys**
2. Copy your **Publishable key** (`pk_live_...`)
3. Paste it into `landing.html` replacing `pk_live_YOUR_KEY_HERE`

---

## STEP 3 — UPDATE YOUR FILES

### In landing.html
Find this line near the bottom:
```javascript
const STRIPE_PUBLISHABLE_KEY = 'pk_live_YOUR_KEY_HERE';
```
Replace with your actual publishable key.

### In app/index.html  
The app file is already configured. Just make sure it lives in an `/app` subfolder in your GitHub repo.

---

## STEP 4 — GITHUB PAGES DEPLOY

### Your repo structure should look like:
```
your-repo/
├── index.html          ← landing.html (rename it)
├── success.html
├── sw.js
├── site.webmanifest
├── favicon.svg
├── favicon.ico
├── favicon-96x96.png
├── apple-touch-icon.png
├── web-app-manifest-192x192.png
├── web-app-manifest-512x512.png
└── app/
    ├── index.html      ← your app/index.html
    ├── background.png
    ├── background2.png
    ├── background3.png
    ├── banner.png
    ├── ninja1.png
    ├── ninja2.png
    ├── done.png
    ├── jungle1.png
    ... (all your game images)
```

1. Push all files to your GitHub repo
2. GitHub Pages will serve them automatically from your domain

---

## STEP 5 — CONNECT YOUR DOMAIN TO CLOUDFLARE

If you haven't already:
1. Go to dash.cloudflare.com → **Add a site**
2. Enter your domain → **Free plan** → Continue
3. Cloudflare will scan your DNS records
4. Update your domain's nameservers to the two Cloudflare ones shown
5. Wait up to 24 hours for DNS to propagate (usually 30 minutes)

Your GitHub Pages site will keep working — Cloudflare just sits in front of it.

---

## STEP 6 — TEST EVERYTHING

### Test the Worker
Visit in your browser:
`https://stealth-classroom-api.dibbleandseed.workers.dev/`

Should return: `{"error":"Not found"}` — that means it's running! ✅

### Test Stripe (use test keys first!)
1. In Stripe, switch to **Test mode**
2. Replace your live keys with test keys (`pk_test_...` and `sk_test_...`)  
3. Do a test purchase using card number `4242 4242 4242 4242`
4. Check that a code appears on the success page
5. Test the code in your app
6. Switch back to live keys when it all works

### Test the app unlock
1. Open your app at `stealthclassroom.com/app`
2. Try selecting a locked theme — paywall should appear
3. Enter a valid code → themes should unlock
4. Reload the page → themes should still be unlocked

---

## TROUBLESHOOTING

**"Code not found" on success page**
- The webhook may take 5-10 seconds — the page retries automatically
- Check Stripe Dashboard → Webhooks → your endpoint → recent events
- If the webhook shows an error, check your Worker logs

**Webhook failing**
- Make sure `STRIPE_WEBHOOK_SECRET` is set correctly in Worker variables
- Make sure you selected `checkout.session.completed` event in Stripe

**CORS errors**
- The Worker only allows requests from `stealthclassroom.com`
- During testing from localhost, temporarily change the CORS origin in worker.js to `*`
- Change it back to your domain before going live

**Themes not unlocking in app**
- Open browser console → check for network errors
- Make sure the Worker URL in the app matches your actual Worker URL

---

## SUPPORT

If anything goes wrong: support@stealthclassroom.com

Your Worker URL: https://stealth-classroom-api.dibbleandseed.workers.dev
