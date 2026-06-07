// ─── Production security helpers ────────────────────────────────────────────

function isProduction() {
  return process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
}

function requireAuthInProduction(req, res, next) {
  if (!isProduction()) return next();
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  next();
}

const CONFIGURE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
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