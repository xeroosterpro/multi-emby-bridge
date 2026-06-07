// ─── PayPal client (Subscriptions API) ──────────────────────────────────────
// isConfigured()/baseUrl() are pure + env-driven. Network calls (token,
// getSubscription) are used by billing routes once credentials are set; they
// throw if called while unconfigured.
const fetch = require('node-fetch');

function isConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET && process.env.PAYPAL_PLAN_ID);
}
function baseUrl() {
  return (process.env.PAYPAL_ENV === 'live')
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}
function publicConfig() {
  return { enabled: isConfigured(), clientId: process.env.PAYPAL_CLIENT_ID || null, planId: process.env.PAYPAL_PLAN_ID || null, env: process.env.PAYPAL_ENV || 'sandbox' };
}

let _token = null, _tokenExp = 0;
async function getAccessToken() {
  if (!isConfigured()) throw new Error('PayPal not configured');
  if (_token && Date.now() < _tokenExp) return _token;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const r = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal token failed: ' + (j.error_description || r.status));
  _token = j.access_token; _tokenExp = Date.now() + (j.expires_in - 60) * 1000;
  return _token;
}
async function getSubscription(id) {
  const token = await getAccessToken();
  const r = await fetch(`${baseUrl()}/v1/billing/subscriptions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal subscription lookup failed: ' + r.status);
  return j; // includes status, plan_id, billing_info.next_billing_time
}

async function verifyWebhookSignature(headers, event, webhookId) {
  if (!webhookId) return false;
  const h = headers || {};
  const token = await getAccessToken();
  const r = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h['paypal-auth-algo'],
      cert_url: h['paypal-cert-url'],
      transmission_id: h['paypal-transmission-id'],
      transmission_sig: h['paypal-transmission-sig'],
      transmission_time: h['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  const j = await r.json();
  return j.verification_status === 'SUCCESS';
}

module.exports = { isConfigured, baseUrl, publicConfig, getAccessToken, getSubscription, verifyWebhookSignature };
