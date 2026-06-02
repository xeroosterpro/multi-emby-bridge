// ─── Admin-only API: users management (metrics already at /api/metrics) ─────
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');
const { makeBilling } = require('../lib/billing');
const { makePayments } = require('../lib/payments');
const { makeServerHistory } = require('../lib/serverHistory');
const { forgetUser } = require('../lib/health');
const paypal = require('../lib/paypal');

function makeAdminRouter() {
  const users = makeUsers(db);
  const payments = makePayments(db);
  const serverHistory = makeServerHistory(db);
  const billing = makeBilling(db, payments); // events sink
  const r = express.Router();
  r.use(express.json());

  function requireAdmin(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    next();
  }

  r.get('/users', requireAdmin, async (req, res) => {
    try {
      const q = await db.query(
        `SELECT u.id, u.username, u.role, u.created_at, u.last_seen_at,
                COALESCE(s.status,'none') AS sub_status
           FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id
          ORDER BY u.created_at ASC`);
      res.json({ users: q.rows });
    } catch (e) { console.error('[admin/users:get]', e.message); res.status(500).json({ error: 'load failed' }); }
  });

  r.post('/users', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const u = await users.create(username, password, role === 'admin' ? 'admin' : 'user');
      res.json({ id: u.id, username: u.username, role: u.role });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'username taken' });
      res.status(500).json({ error: 'create failed' });
    }
  });

  r.delete('/users/:id', requireAdmin, async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot delete yourself' });
    try { const ok = await users.remove(req.params.id); try { forgetUser(req.params.id); } catch {} res.json({ ok }); }
    catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });

  r.post('/users/:id/role', requireAdmin, async (req, res) => {
    const { role } = req.body || {};
    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'cannot remove your own admin role' });
    }
    try {
      const updated = await users.setRole(req.params.id, role);
      if (!updated) return res.status(404).json({ error: 'user not found' });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── discount codes ──
  r.get('/codes', requireAdmin, async (req, res) => {
    try { res.json({ codes: await billing.listCodes() }); }
    catch (e) { res.status(500).json({ error: 'load failed' }); }
  });
  r.post('/codes', requireAdmin, async (req, res) => {
    const { code, type, maxUses } = req.body || {};
    if (!code || !['comp_100', 'percent_50', 'first_month_free'].includes(type)) return res.status(400).json({ error: 'code and valid type required' });
    try { await billing.createCode(code, type, maxUses, req.user.id); res.json({ ok: true }); }
    catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'code exists' }); res.status(500).json({ error: 'create failed' }); }
  });
  r.post('/codes/:code/deactivate', requireAdmin, async (req, res) => {
    try { await billing.deactivateCode(req.params.code); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: 'deactivate failed' }); }
  });

  // ── comp / uncomp a user (grant access without payment) ──
  r.post('/users/:id/comp', requireAdmin, async (req, res) => {
    try { await billing.comp(req.params.id, req.user.id); res.json({ ok: true, status: 'comped' }); }
    catch (e) { res.status(500).json({ error: 'comp failed' }); }
  });
  r.post('/users/:id/uncomp', requireAdmin, async (req, res) => {
    try { await billing.cancel(req.params.id, req.user.id); res.json({ ok: true, status: 'cancelled' }); }
    catch (e) { res.status(500).json({ error: 'uncomp failed' }); }
  });

  r.get('/users/:id/detail', requireAdmin, async (req, res) => {
    try {
      const sub = await billing.get(req.params.id);
      res.json({
        subscription: sub,
        payments: await payments.listForUser(req.params.id),
        events: await payments.listEvents(req.params.id),
        servers: (await serverHistory.listForUser(req.params.id)).servers,
      });
    } catch (e) { console.error('[admin/detail]', e.message); res.status(500).json({ error: 'detail failed' }); }
  });

  r.post('/users/:id/subscription', requireAdmin, async (req, res) => {
    const { status, periodEnd } = req.body || {};
    const allowed = ['none', 'active', 'cancelled', 'past_due', 'comped'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (periodEnd && Number.isNaN(Date.parse(periodEnd))) return res.status(400).json({ error: 'invalid periodEnd' });
    try {
      await db.query(
        `INSERT INTO subscriptions(user_id, status, current_period_end, updated_at)
         VALUES($1,$2,$3,now())
         ON CONFLICT (user_id) DO UPDATE SET status=$2, current_period_end=$3, updated_at=now()`,
        [req.params.id, status, periodEnd || null]
      );
      await payments.addEvent({ userId: req.params.id, type: 'admin_override', detail: { status, periodEnd: periodEnd || null }, actorId: req.user.id });
      res.json({ ok: true, status, periodEnd: periodEnd || null });
    } catch (e) { console.error('[admin/subscription]', e.message); res.status(500).json({ error: 'override failed' }); }
  });

  r.post('/users/:id/resync', requireAdmin, async (req, res) => {
    if (!paypal.isConfigured()) return res.status(503).json({ error: 'paypal not configured' });
    try {
      const sub = await billing.get(req.params.id);
      if (!sub.paypal_subscription_id) return res.status(400).json({ error: 'no paypal subscription on file' });
      const ps = await paypal.getSubscription(sub.paypal_subscription_id);
      const status = ['ACTIVE', 'APPROVED'].includes(ps.status) ? 'active' : (ps.status === 'CANCELLED' ? 'cancelled' : (ps.status === 'SUSPENDED' ? 'past_due' : 'none'));
      const periodEnd = (ps.billing_info && ps.billing_info.next_billing_time) || null;
      await billing.setStatusFromPaypal(req.params.id, sub.paypal_subscription_id, status, periodEnd);
      await payments.addEvent({ userId: req.params.id, type: 'resync', detail: { paypalStatus: ps.status, status, periodEnd }, actorId: req.user.id });
      res.json({ ok: true, status, periodEnd });
    } catch (e) { console.error('[admin/resync]', e.message); res.status(502).json({ error: 'resync failed' }); }
  });

  r.post('/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });
    try {
      const ok = await users.setPassword(req.params.id, password);
      if (!ok) return res.status(404).json({ error: 'user not found' });
      await payments.addEvent({ userId: req.params.id, type: 'admin_password_reset', detail: {}, actorId: req.user.id });
      res.json({ ok: true });
    } catch (e) { console.error('[admin/password]', e.message); res.status(500).json({ error: 'reset failed' }); }
  });

  return r;
}

module.exports = { makeAdminRouter };
