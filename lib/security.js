// ─── Production security helpers ────────────────────────────────────────────

function isProduction() {
  return process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
}

function requireAuthInProduction(req, res, next) {
  if (!isProduction()) return next();
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  next();
}

// PayPal SDK loads its script from www.paypal.com, renders the subscribe button
// in an iframe (www.paypal.com / *.paypal.com), pulls button images from
// paypalobjects.com, and calls the PayPal API — all must be allow-listed or the
// billing page silently fails ("Could not load PayPal") (LIVE-2).
const PAYPAL_SRC = 'https://www.paypal.com https://www.paypalobjects.com';
const PAYPAL_FRAME = 'https://www.paypal.com https://www.sandbox.paypal.com';

// connect-src is intentionally broadened to any https origin (LIVE-3): the
// dashboard probes the user's Emby/Jellyfin servers *from the browser* to bypass
// WAFs that block the datacenter IP (live "now playing", per-server "YOU" test).
// Those servers are arbitrary user-supplied origins that can't be statically
// enumerated. Script/style/frame execution stays locked to 'self' (+ PayPal), so
// this does not enable third-party code execution — only outbound fetches.
const CONFIGURE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${PAYPAL_SRC}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${PAYPAL_SRC}`,
  "connect-src 'self' https:",
  "font-src 'self'",
  `frame-src ${PAYPAL_FRAME}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function applyConfigureSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CONFIGURE_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function logStartupSecurityWarnings() {
  if (!isProduction()) return;

  const allowReg = process.env.ALLOW_PUBLIC_REGISTER;
  if (allowReg !== '0' && allowReg !== 'false') {
    console.warn('[security] ALLOW_PUBLIC_REGISTER is not 0 — public registration is open. Set ALLOW_PUBLIC_REGISTER=0 on Railway for invite-only signups.');
  }

  const paypalConfigured = !!(
    process.env.PAYPAL_CLIENT_ID &&
    process.env.PAYPAL_SECRET &&
    process.env.PAYPAL_PLAN_ID
  );
  if (paypalConfigured && !process.env.PAYPAL_WEBHOOK_ID) {
    console.warn('[security] PayPal is configured but PAYPAL_WEBHOOK_ID is missing — billing webhooks will be rejected until it is set.');
  }
}

module.exports = {
  isProduction,
  requireAuthInProduction,
  CONFIGURE_CSP,
  applyConfigureSecurityHeaders,
  logStartupSecurityWarnings,
};