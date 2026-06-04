// ─── Admin-only API: users management (metrics already at /api/metrics) ─────
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');
const { makeBilling } = require('../lib/billing');
const { makePayments } = require('../lib/payments');
const { makeServerHistory } = require('../lib/serverHistory');
const { forgetUser } = require('../lib/health');
const paypal = require('../lib/paypal');
const { makeUserConfig } = require('../lib/userConfig');
const { makeLiveSessions } = require('../lib/sessions');
const { summarizeRequestLog, userActivity, userAnalytics } = require('../lib/adminStats');
const { makeRequestLog } = require('../lib/requestLog');

function makeAdminRouter(opts = {}) {
  const getRequestLog = typeof opts.getRequestLog === 'function' ? opts.getRequestLog : () => [];
  const userConfig = makeUserConfig(db);
  const requestLog = makeRequestLog(db);
  const liveSessions = makeLiveSessions();
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
                COALESCE(s.status,'none') AS sub_status, s.current_period_end AS period_end,
                COALESCE(jsonb_array_length(uc.config_json->'servers'),0) AS server_count
           FROM users u
           LEFT JOIN subscriptions s ON s.user_id = u.id
           LEFT JOIN user_config uc ON uc.user_id = u.id
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
  r.delete('/codes/:code', requireAdmin, async (req, res) => {
    try { const ok = await billing.deleteCode(req.params.code); res.json({ ok }); }
    catch (e) { res.status(500).json({ error: 'delete failed' }); }
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

  r.get('/overview', requireAdmin, async (req, res) => {
    try {
      const u = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.role='admin')::int AS admins,
                COUNT(*) FILTER (WHERE s.status IN ('active','comped'))::int AS active,
                COUNT(*) FILTER (WHERE s.status='comped')::int AS comped,
                COUNT(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS new_this_week
           FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id`);
      const rev = await db.query(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE paid_at > now() - interval '30 days'),0) AS monthly,
                COALESCE(SUM(amount),0) AS lifetime FROM payments`);
      const pays = await db.query(
        `SELECT p.amount, p.currency, p.status, p.paid_at, us.username
           FROM payments p LEFT JOIN users us ON us.id=p.user_id
          ORDER BY p.paid_at DESC LIMIT 10`);
      const logRows = (await requestLog.recent(1000)).map(r => ({ ...r, contentName: r.title, bestServer: r.server }));
      const activity = summarizeRequestLog(logRows);
      const found24 = logRows.filter(e => e.found && (Date.now() - new Date(e.ts).getTime()) <= 86400000).length;
      const total24 = activity.requests24h || 0;
      const renew = await db.query(`SELECT COUNT(*)::int AS n FROM subscriptions WHERE status='active' AND current_period_end IS NOT NULL AND current_period_end BETWEEN now() AND now() + interval '7 days'`);
      const failed = await db.query(`SELECT COUNT(*)::int AS n FROM payments WHERE status <> 'completed'`);
      res.json({
        users: u.rows[0],
        revenue: { monthly: Number(rev.rows[0].monthly), lifetime: Number(rev.rows[0].lifetime), currency: 'USD' },
        recentPayments: pays.rows,
        activity,
        successRate: total24 ? Math.round(found24/total24*100) : null,
        upcomingRenewals: renew.rows[0].n,
        failedPayments: failed.rows[0].n,
      });
    } catch (e) { console.error('[admin/overview]', e.message); res.status(500).json({ error: 'overview failed' }); }
  });

  r.get('/users/:id/activity', requireAdmin, async (req, res) => {
    try {
      const rows = (await requestLog.forUser(req.params.id, 200)).map(r => ({ ...r, contentName: r.title, bestServer: r.server }));
      const act = userActivity(rows, req.params.id);
      let live = [];
      try {
        const cfg = await userConfig.getForServe(req.params.id);
        if (cfg && Array.isArray(cfg.servers)) live = await liveSessions.forUser(cfg.servers);
      } catch (e) { console.error('[admin/activity:live]', e.message); }
      const analytics = userAnalytics(rows);
      res.json({ recent: act.recent, totals: act.totals, live, analytics });
    } catch (e) { console.error('[admin/activity]', e.message); res.status(500).json({ error: 'activity failed' }); }
  });

  r.get('/audit', requireAdmin, async (req, res) => {
    try {
      const q = await db.query(
        `SELECT be.created_at, be.type, be.detail, be.user_id,
                tu.username AS target, au.username AS actor
           FROM billing_events be
           LEFT JOIN users tu ON tu.id = be.user_id
           LEFT JOIN users au ON au.id = be.actor_id
          ORDER BY be.created_at DESC LIMIT 100`);
      res.json({ events: q.rows });
    } catch (e) { console.error('[admin/audit]', e.message); res.status(500).json({ error: 'audit failed' }); }
  });

  // ── DIAGNOSTIC (temporary): reveal request_log attribution so we can see why a
  // user's streams may not appear in their per-account "Recent activity". Read-only.
  r.get('/diag/requestlog', requireAdmin, async (req, res) => {
    try {
      const tot = await db.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE user_id IS NULL)::int AS null_user FROM request_log`);
      const byUser = await db.query(
        `SELECT COALESCE(u.username,'(no user_id)') AS who, COUNT(*)::int AS n
           FROM request_log rl LEFT JOIN users u ON u.id = rl.user_id
          GROUP BY 1 ORDER BY n DESC LIMIT 10`);
      const recent = await db.query(
        `SELECT rl.ts, rl.content_name, rl.user_id, u.username,
                (rl.best_file IS NOT NULL) AS has_best_file,
                (rl.server_status IS NOT NULL) AS has_server_status
           FROM request_log rl LEFT JOIN users u ON u.id = rl.user_id
          ORDER BY rl.ts DESC LIMIT 10`);
      res.json({
        total: tot.rows[0].n,
        nullUserId: tot.rows[0].null_user,
        you: { id: req.user.id, username: req.user.username },
        byUser: byUser.rows,
        recent: recent.rows,
      });
    } catch (e) { console.error('[admin/diag/requestlog]', e.message); res.status(500).json({ error: 'diag failed' }); }
  });

  return r;
}

module.exports = { makeAdminRouter };
