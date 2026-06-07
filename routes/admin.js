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
const { summarizeRequestLog, userActivity, userAnalytics, timeSeries, serverBreakdown, topContent } = require('../lib/adminStats');
const { makeRequestLog, normalizeServerLabel } = require('../lib/requestLog');
const { makeSiteSettings, TOGGLEABLE_TABS } = require('../lib/siteSettings');
const { snapshot: systemMetrics } = require('../lib/metrics');
const os = require('os');

function makeAdminRouter(opts = {}) {
  const getRequestLog = typeof opts.getRequestLog === 'function' ? opts.getRequestLog : () => [];
  const userConfig = makeUserConfig(db);
  const requestLog = makeRequestLog(db);
  const liveSessions = makeLiveSessions();
  const users = makeUsers(db);
  const payments = makePayments(db);
  const serverHistory = makeServerHistory(db);
  const billing = makeBilling(db, payments); // events sink
  const siteSettings = makeSiteSettings(db);
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
                COALESCE(jsonb_array_length(uc.config_json->'servers'),0) AS server_count,
                (SELECT COUNT(*)::int FROM request_log rl
                  WHERE rl.user_id = u.id AND rl.ts > now() - interval '24 hours') AS requests_24h,
                (SELECT COUNT(*)::int FROM request_log rl
                  WHERE rl.user_id = u.id AND rl.ts > now() - interval '7 days') AS requests_7d,
                (SELECT MAX(rl.ts) FROM request_log rl WHERE rl.user_id = u.id) AS last_request_at
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
      const srv = await db.query(
        `SELECT COALESCE(SUM(jsonb_array_length(uc.config_json->'servers')),0)::int AS total,
                COUNT(*) FILTER (WHERE jsonb_array_length(uc.config_json->'servers') > 0)::int AS users_with_servers
           FROM user_config uc`);
      const active24 = await db.query(
        `SELECT COUNT(DISTINCT user_id)::int AS n FROM request_log
          WHERE user_id IS NOT NULL AND ts > now() - interval '24 hours'`);
      const logRows = (await requestLog.recent(5000)).map(r => ({ ...r, contentName: r.title, bestServer: r.server }));
      const activity = summarizeRequestLog(logRows);
      const found24 = logRows.filter(e => e.found && (Date.now() - new Date(e.ts).getTime()) <= 86400000).length;
      const total24 = activity.requests24h || 0;
      const renew = await db.query(`SELECT COUNT(*)::int AS n FROM subscriptions WHERE status='active' AND current_period_end IS NOT NULL AND current_period_end BETWEEN now() AND now() + interval '7 days'`);
      const failed = await db.query(`SELECT COUNT(*)::int AS n FROM payments WHERE status <> 'completed'`);
      let tickets = { open: 0, in_progress: 0, closed: 0, total: 0 };
      try {
        const tq = await db.query(
          `SELECT status, COUNT(*)::int AS n FROM tickets GROUP BY status`);
        for (const row of tq.rows) {
          tickets.total += row.n;
          if (row.status === 'open') tickets.open = row.n;
          else if (row.status === 'in_progress') tickets.in_progress = row.n;
          else if (['closed', 'resolved'].includes(row.status)) tickets.closed += row.n;
        }
      } catch { /* tickets table may not exist on older DBs */ }
      const recentGlobal = await db.query(
        `SELECT rl.ts, rl.content_name, rl.type, rl.season, rl.episode, rl.best_server, rl.found, rl.response_ms,
                u.username, u.id AS user_id
           FROM request_log rl LEFT JOIN users u ON u.id = rl.user_id
          ORDER BY rl.ts DESC LIMIT 50`);
      const avgMs = await db.query(
        `SELECT ROUND(AVG(response_ms))::int AS avg FROM request_log
          WHERE ts > now() - interval '24 hours' AND response_ms IS NOT NULL`);
      res.json({
        users: u.rows[0],
        revenue: { monthly: Number(rev.rows[0].monthly), lifetime: Number(rev.rows[0].lifetime), currency: 'USD' },
        recentPayments: pays.rows,
        activity,
        successRate: total24 ? Math.round(found24 / total24 * 100) : null,
        avgResponseMs: avgMs.rows[0]?.avg ?? null,
        upcomingRenewals: renew.rows[0].n,
        failedPayments: failed.rows[0].n,
        servers: srv.rows[0],
        activeUsers24h: active24.rows[0].n,
        tickets,
        charts: {
          requests7d: timeSeries(logRows, { days: 7 }),
          requests24h: timeSeries(logRows, { days: 1, hourly: true }),
          servers24h: serverBreakdown(logRows, { windowMs: 86400000 }),
          topContent24h: topContent(logRows, { windowMs: 86400000, limit: 10 }),
        },
        recentActivity: recentGlobal.rows.map(r => ({
          ts: r.ts, title: r.content_name, type: r.type, season: r.season, episode: r.episode,
          server: normalizeServerLabel(r.best_server), found: !!r.found, ms: r.response_ms,
          username: r.username, userId: r.user_id,
        })),
      });
    } catch (e) { console.error('[admin/overview]', e.message); res.status(500).json({ error: 'overview failed' }); }
  });

  r.get('/live', requireAdmin, async (req, res) => {
    try {
      const q = await db.query(
        `SELECT u.id, u.username, uc.config_json
           FROM users u
           JOIN user_config uc ON uc.user_id = u.id
          WHERE jsonb_array_length(uc.config_json->'servers') > 0`);
      const sessions = [];
      await Promise.all(q.rows.map(async (row) => {
        try {
          const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {});
          const servers = (cfg.servers || []).filter(s => s && s.url && s.apiKey);
          if (!servers.length) return;
          const full = await userConfig.getForServe(row.id);
          const live = await liveSessions.forUser(full?.servers || servers);
          for (const s of live) {
            sessions.push({
              ...s,
              bridgeUserId: row.id,
              bridgeUsername: row.username,
            });
          }
        } catch (e) { console.error('[admin/live:user]', row.id, e.message); }
      }));
      res.json({
        live: sessions,
        count: sessions.length,
        usersPolled: q.rows.length,
        at: new Date().toISOString(),
      });
    } catch (e) { console.error('[admin/live]', e.message); res.status(500).json({ error: 'live failed' }); }
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

  r.get('/system', requireAdmin, async (req, res) => {
    try {
      const metrics = systemMetrics();
      const logBuf = getRequestLog();
      let platform = { users: 0, servers: 0, requests24h: 0, activeUsers24h: 0 };
      let events = [];
      if (db.isConfigured()) {
        const u = await db.query('SELECT COUNT(*)::int AS total FROM users');
        const srv = await db.query(
          `SELECT COALESCE(SUM(jsonb_array_length(uc.config_json->'servers')),0)::int AS total FROM user_config uc`);
        const r24 = await db.query(
          `SELECT COUNT(*)::int AS n FROM request_log WHERE ts > now() - interval '24 hours'`);
        const a24 = await db.query(
          `SELECT COUNT(DISTINCT user_id)::int AS n FROM request_log
            WHERE user_id IS NOT NULL AND ts > now() - interval '24 hours'`);
        platform = {
          users: u.rows[0].total,
          servers: srv.rows[0].total,
          requests24h: r24.rows[0].n,
          activeUsers24h: a24.rows[0].n,
        };
        const ev = await db.query(
          `SELECT be.created_at, be.type, tu.username AS target, au.username AS actor
             FROM billing_events be
             LEFT JOIN users tu ON tu.id = be.user_id
             LEFT JOIN users au ON au.id = be.actor_id
            ORDER BY be.created_at DESC LIMIT 8`);
        events = ev.rows;
      }
      res.json({
        metrics,
        platform,
        events,
        services: {
          database: db.isConfigured(),
          paypal: paypal.isConfigured(),
          accounts: db.isConfigured(),
        },
        deployment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          region: process.env.RAILWAY_REGION || process.env.FLY_REGION || null,
          service: process.env.RAILWAY_SERVICE_NAME || null,
          env: process.env.NODE_ENV || 'development',
          host: req.hostname,
          hostname: os.hostname(),
        },
        logBuffer: { count: logBuf.length },
      });
    } catch (e) { console.error('[admin/system]', e.message); res.status(500).json({ error: 'system failed' }); }
  });

  r.get('/site-config', requireAdmin, async (req, res) => {
    res.json({
      disabledTabs: await siteSettings.getDisabledTabs(),
      toggleable: TOGGLEABLE_TABS,
      announcement: await siteSettings.getAnnouncement(),
    });
  });
  r.post('/site-config', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const tabs = body.disabledTabs;
    if (tabs !== undefined) {
      if (!Array.isArray(tabs) || tabs.some(t => !TOGGLEABLE_TABS.includes(t))) {
        return res.status(400).json({ error: 'invalid tab list' });
      }
    }
    try {
      const out = {
        disabledTabs: tabs !== undefined
          ? await siteSettings.setDisabledTabs(tabs)
          : await siteSettings.getDisabledTabs(),
        announcement: await siteSettings.getAnnouncement(),
      };
      if (Object.prototype.hasOwnProperty.call(body, 'announcement')) {
        out.announcement = await siteSettings.setAnnouncement(body.announcement);
      }
      res.json(out);
    } catch (e) {
      console.error('[admin/site-config]', e.message);
      res.status(e.message === 'invalid announcement' ? 400 : 500).json({ error: e.message || 'save failed' });
    }
  });

  return r;
}

module.exports = { makeAdminRouter };
