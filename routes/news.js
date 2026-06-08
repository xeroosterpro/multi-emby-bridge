// ─── News posts: public read, admin write/delete ──────────────────────────────
const express = require('express');
const db = require('../lib/db');

function makeNewsRouter() {
  const r = express.Router();

  function requireAdmin(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    next();
  }

  // GET /api/news — newest first, no auth required
  r.get('/', async (req, res) => {
    try {
      if (!db.isConfigured()) return res.json([]);
      const { rows } = await db.query(
        'SELECT id, title, body, created_at FROM news ORDER BY created_at DESC LIMIT 20'
      );
      res.json(rows);
    } catch (e) {
      console.error('[news/get]', e.message);
      res.json([]);
    }
  });

  // POST /api/news — admin: create news item
  r.post('/', requireAdmin, async (req, res) => {
    const { title, body } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
    try {
      const { rows } = await db.query(
        'INSERT INTO news(title,body,created_by) VALUES($1,$2,$3) RETURNING id,title,body,created_at',
        [title.trim(), (body || '').trim() || null, req.user.id]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error('[news/post]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // DELETE /api/news/:id — admin only
  r.delete('/:id', requireAdmin, async (req, res) => {
    try {
      await db.query('DELETE FROM news WHERE id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[news/delete]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  return r;
}

module.exports = { makeNewsRouter };
