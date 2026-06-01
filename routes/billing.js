// ─── Billing routes: status, config, activate, cancel, redeem, webhook ──────
const express = require('express');
const db = require('../lib/db');
const paypal = require('../lib/paypal');
const { makeBilling } = require('../lib/billing');

const PLAN_PRICE = process.env.PLAN_PRICE || '$4/mo';

function makeBillingRouter() {
  const billing = makeBilling(db);
  const r = express.Router();

  function requireAuth(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  }

  // public-ish: frontend needs clientId/planId to render PayPal buttons
  r.get('/config', (req, res) => res.json({ ...paypal.publicConfig(), planPrice: PLAN_PRICE }));

  r.get('/status', requireAuth, async (req, res) => {
    try {
      const sub = await billing.get(req.user.id);
      const hasAccess = (req.user.role === 'admin') || await billing.hasAccess(req.user.id);
      res.json({ status: sub.status, periodEnd: sub.current_period_end || null, hasAccess, planPrice: PLAN_PRICE });
    } catch (e) { console.error('[billing/status]', e.message); res.status(500).json({ error: 'status failed' }); }
  });

  // verify the approved PayPal subscription server-side, then record it
  r.post('/activate', requireAuth, express.json(), async (req, res) => {
    if (!paypal.isConfigured()) return res.status(503).json({ error: 'billing not configured' });
    const { subscriptionID } = req.body || {};
    if (!subscriptionID) return res.status(400).json({ error: 'subscriptionID required' });
    try {
      const sub = await paypal.getSubscription(subscriptionID);
      if (sub.plan_id && process.env.PAYPAL_PLAN_ID && sub.plan_id !== process.env.PAYPAL_PLAN_ID) {
        return res.status(400).json({ error: 'plan mismatch' });
      }
      const ok = ['ACTIVE', 'APPROVED'].includes(sub.status);
      if (!ok) return res.status(400).json({ error: 'subscription not active (' + sub.status + ')' });
      const periodEnd = sub.billing_info && sub.billing_info.next_billing_time ? sub.billing_info.next_billing_time : null;
      await billing.setStatusFromPaypal(req.user.id, subscriptionID, 'active', periodEnd);
      res.json({ ok: true, status: 'active', periodEnd });
    } catch (e) { console.error('[billing/activate]', e.message); res.status(502).json({ error: 'verification failed' }); }
  });

  r.post('/cancel', requireAuth, async (req, res) => {
    try { await billing.cancel(req.user.id); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: 'cancel failed' }); }
  });

  r.post('/redeem', requireAuth, express.json(), async (req, res) => {
    try {
      const out = await billing.redeemCode(req.user.id, (req.body || {}).code);
      res.status(out.applied ? 200 : 400).json(out);
    } catch (e) { res.status(500).json({ error: 'redeem failed' }); }
  });

  // PayPal webhook (no auth). Signature verification added when PAYPAL_WEBHOOK_ID is set.
  r.post('/webhook', express.json({ type: '*/*' }), async (req, res) => {
    try {
      const ev = req.body || {};
      const type = ev.event_type || '';
      const resource = ev.resource || {};
      const subId = resource.id || (resource.billing_agreement_id) || null;
      if (subId) {
        if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') await billing.setByPaypalSub(subId, 'active', resource.billing_info && resource.billing_info.next_billing_time);
        else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED') await billing.setByPaypalSub(subId, 'cancelled', null);
        else if (type === 'BILLING.SUBSCRIPTION.SUSPENDED') await billing.setByPaypalSub(subId, 'past_due', null);
        else if (type === 'PAYMENT.SALE.COMPLETED' && resource.billing_agreement_id) await billing.setByPaypalSub(resource.billing_agreement_id, 'active', null);
      }
      res.json({ ok: true });
    } catch (e) { console.error('[billing/webhook]', e.message); res.json({ ok: true }); } // always 200 so PayPal doesn't retry-storm
  });

  return r;
}

module.exports = { makeBillingRouter };
