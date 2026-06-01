// ─── Admin-only API: users management (metrics already at /api/metrics) ─────
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');

function makeAdminRouter() {
  const users = makeUsers(db);
  const r = express.Router();
  r.use(express.json());

  function requireAdmin(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    next();
  }

  r.get('/users', requireAdmin, async (req, res) => {
    try { res.json({ users: await users.listAll() }); }
    catch (e) { console.error('[admin/users:get]', e.message); res.status(500).json({ error: 'load failed' }); }
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

  return r;
}

module.exports = { makeAdminRouter };
