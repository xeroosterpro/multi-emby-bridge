// ─── Billing routes: status, config, activate, cancel, redeem, webhook ──────
const express = require('express');
const db = require('../lib/db');
const paypal = require('../lib/paypal');
const { makeBilling } = require('../lib/billing');

const PLAN_PRICE = process.env.PLAN_PRICE || '$4/mo';
const PLAN_FEATURES = {
  pro: [
    'Unlimited Emby & Jellyfin servers',
    'Personal manifest URL for Stremio',
    'Multi-server stream routing',
    'Health monitoring & uptime history',
    'Priority support tickets',
    'Cancel anytime',
  ],
  free: [
    'Browse the site',
    'No streaming access',
    'No manifest URL',
  ],
};

function makeBillingRouter() {
  const { makePayments } = require('../lib/payments');
  const payments = makePayments(db);
  const billing = makeBilling(db, payments); // events sink
  const r = express.Router();

  function requireAuth(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  }

  // public-ish: frontend needs clientId/planId to render PayPal buttons
  r.get('/config', (req, res) => res.json({
    ...paypal.publicConfig(),
    planPrice: PLAN_PRICE,
    planName: 'Bridge Pro',
    plans: [
      { id: 'free', name: 'Free', price: '$0', period: 'forever', features: PLAN_FEATURES.free, limited: true },
      { id: 'pro', name: 'Bridge Pro', price: PLAN_PRICE, period: 'month', features: PLAN_FEATURES.pro, featured: true },
    ],
  }));

  r.get('/status', requireAuth, async (req, res) => {
    try {
      const sub = await billing.get(req.user.id);
      const hasAccess = (req.user.role === 'admin') || await billing.hasAccess(req.user.id);
      res.json({ status: sub.status, periodEnd: sub.current_period_end || null, hasAccess, planPrice: PLAN_PRICE });
    } catch (e) { console.error('[billing/status]', e.message); res.status(500).json({ error: 'status failed' }); }
  });

  r.get('/history', requireAuth, async (req, res) => {
    try {
      const sub = await billing.get(req.user.id);
      const list = await payments.listForUser(req.user.id);
      const events = await payments.listEvents(req.user.id);
      const upcoming = sub.current_period_end
        ? { date: sub.current_period_end, amount: PLAN_PRICE }
        : null;
      res.json({ status: sub.status, periodEnd: sub.current_period_end || null, planPrice: PLAN_PRICE, upcoming, payments: list, events });
    } catch (e) { console.error('[billing/history]', e.message); res.status(500).json({ error: 'history failed' }); }
  });

  // verify the approved PayPal subscription server-side, then record it
  r.post('/activate', requireAuth, async (req, res) => {
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
    try {
      // Cancel at PayPal first so billing actually stops (SEC-5). Only flip the
      // local status once PayPal confirms (or has nothing left to cancel).
      const sub = await billing.get(req.user.id);
      if (paypal.isConfigured() && sub.paypal_subscription_id && sub.status !== 'cancelled') {
        try {
          await paypal.cancelSubscription(sub.paypal_subscription_id);
        } catch (e) {
          // 404/422 = already cancelled/expired at PayPal → safe to finalize locally.
          if (e.status !== 404 && e.status !== 422) {
            console.error('[billing/cancel] paypal cancel failed:', e.message);
            return res.status(502).json({ error: 'could not cancel with PayPal — please try again' });
          }
        }
      }
      await billing.cancel(req.user.id);
      res.json({ ok: true });
    } catch (e) { console.error('[billing/cancel]', e.message); res.status(500).json({ error: 'cancel failed' }); }
  });

  r.post('/redeem', requireAuth, async (req, res) => {
    try {
      const out = await billing.redeemCode(req.user.id, (req.body || {}).code);
      res.status(out.applied ? 200 : 400).json(out);
    } catch (e) { res.status(500).json({ error: 'redeem failed' }); }
  });

  // PayPal webhook (no session auth — verified via PayPal signature when configured).
  r.post('/webhook', async (req, res) => {
    try {
      const ev = req.body || {};
      const webhookId = process.env.PAYPAL_WEBHOOK_ID;
      if (paypal.isConfigured()) {
        if (!webhookId) {
          console.error('[billing/webhook] PAYPAL_WEBHOOK_ID not set — rejecting');
          return res.status(503).json({ error: 'webhook verification not configured' });
        }
        const ok = await paypal.verifyWebhookSignature(req.headers, ev, webhookId);
        if (!ok) {
          console.error('[billing/webhook] signature verification failed');
          return res.status(401).json({ error: 'invalid signature' });
        }
      }
      const type = ev.event_type || '';
      const resource = ev.resource || {};
      const subId = resource.id || (resource.billing_agreement_id) || null;
      if (subId && db.isConfigured()) {
        // All writes for one webhook run in a single transaction (atomic), guarded
        // by an idempotency claim so PayPal retries can't double-apply a payment.
        await db.withTransaction(async (client) => {
          const txPayments = makePayments(client);
          const txBilling = makeBilling(client, txPayments);
          if (!(await txBilling.claimWebhook(ev.id, type))) return; // already processed
          if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') await txBilling.setByPaypalSub(subId, 'active', resource.billing_info && resource.billing_info.next_billing_time);
          else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED') await txBilling.setByPaypalSub(subId, 'cancelled', null);
          else if (type === 'BILLING.SUBSCRIPTION.SUSPENDED') await txBilling.setByPaypalSub(subId, 'past_due', null);
          else if (type === 'PAYMENT.SALE.COMPLETED' && resource.billing_agreement_id) {
            await txBilling.setByPaypalSub(resource.billing_agreement_id, 'active', null);
            const u = await client.query('SELECT user_id FROM subscriptions WHERE paypal_subscription_id=$1', [resource.billing_agreement_id]);
            if (u.rowCount) {
              const userId = u.rows[0].user_id;
              const amt = resource.amount && (resource.amount.total || resource.amount.value);
              const cur = (resource.amount && (resource.amount.currency || resource.amount.currency_code)) || 'USD';
              await txPayments.record({ userId, paypalSaleId: resource.id, amount: amt, currency: cur, paidAt: resource.create_time || null });
              await txPayments.addEvent({ userId, type: 'payment', detail: { saleId: resource.id, amount: amt, currency: cur } });
            }
          }
        });
      }
      res.json({ ok: true });
    } catch (e) { console.error('[billing/webhook]', e.message); res.json({ ok: true }); } // always 200 so PayPal doesn't retry-storm
  });

  return r;
}

module.exports = { makeBillingRouter };
