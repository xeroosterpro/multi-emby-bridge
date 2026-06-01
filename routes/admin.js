// ─── Admin-only API: users management (metrics already at /api/metrics) ─────
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');
const { makeBilling } = require('../lib/billing');

function makeAdminRouter() {
  const users = makeUsers(db);
  const billing = makeBilling(db);
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
    try { await billing.comp(req.params.id); res.json({ ok: true, status: 'comped' }); }
    catch (e) { res.status(500).json({ error: 'comp failed' }); }
  });
  r.post('/users/:id/uncomp', requireAdmin, async (req, res) => {
    try { await billing.cancel(req.params.id); res.json({ ok: true, status: 'cancelled' }); }
    catch (e) { res.status(500).json({ error: 'uncomp failed' }); }
  });

  return r;
}

module.exports = { makeAdminRouter };
