// ─── Support tickets: create, list, reply, admin manage ──────────────────────
const express = require('express');
const db = require('../lib/db');

function makeTicketsRouter() {
  const r = express.Router();

  function requireAuth(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    next();
  }
  function requireAdmin(req, res, next) {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    next();
  }

  // GET /api/tickets — user sees own, admin sees all
  r.get('/', requireAuth, async (req, res) => {
    try {
      let rows;
      if (req.user.role === 'admin') {
        ({ rows } = await db.query(`
          SELECT t.id, t.subject, t.status, t.created_at, t.updated_at, u.username,
                 (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id)::int AS message_count,
                 (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=false
                    AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
                      WHERE m2.ticket_id=t.id AND m2.is_admin=true), '1970-01-01'))::int AS unread
          FROM tickets t JOIN users u ON t.user_id=u.id
          ORDER BY t.updated_at DESC LIMIT 200`));
      } else {
        ({ rows } = await db.query(`
          SELECT t.id, t.subject, t.status, t.created_at, t.updated_at,
                 (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id)::int AS message_count,
                 (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=true
                    AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
                      WHERE m2.ticket_id=t.id AND m2.is_admin=false), '1970-01-01'))::int AS unread
          FROM tickets t WHERE t.user_id=$1
          ORDER BY t.updated_at DESC`, [req.user.id]));
      }
      res.json(rows);
    } catch (e) {
      console.error('[tickets/list]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /api/tickets — create with first message
  r.post('/', requireAuth, express.json(), async (req, res) => {
    const { subject, body } = req.body || {};
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject required' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'message required' });
    try {
      const { rows: [ticket] } = await db.query(
        'INSERT INTO tickets(user_id,subject) VALUES($1,$2) RETURNING id,subject,status,created_at,updated_at',
        [req.user.id, subject.trim()]
      );
      await db.query(
        'INSERT INTO ticket_messages(ticket_id,user_id,body,is_admin) VALUES($1,$2,$3,false)',
        [ticket.id, req.user.id, body.trim()]
      );
      res.json(ticket);
    } catch (e) {
      console.error('[tickets/create]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // GET /api/tickets/:id — full thread
  r.get('/:id', requireAuth, async (req, res) => {
    try {
      const { rows: [ticket] } = await db.query(
        'SELECT t.*, u.username FROM tickets t JOIN users u ON t.user_id=u.id WHERE t.id=$1',
        [req.params.id]
      );
      if (!ticket) return res.status(404).json({ error: 'not found' });
      if (req.user.role !== 'admin' && ticket.user_id !== req.user.id)
        return res.status(403).json({ error: 'forbidden' });
      const { rows: messages } = await db.query(`
        SELECT m.id, m.body, m.is_admin, m.created_at, u.username
        FROM ticket_messages m JOIN users u ON m.user_id=u.id
        WHERE m.ticket_id=$1 ORDER BY m.created_at ASC`, [req.params.id]);
      res.json({ ...ticket, messages });
    } catch (e) {
      console.error('[tickets/get]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /api/tickets/:id/reply
  r.post('/:id/reply', requireAuth, express.json(), async (req, res) => {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'message required' });
    try {
      const { rows: [ticket] } = await db.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
      if (!ticket) return res.status(404).json({ error: 'not found' });
      if (req.user.role !== 'admin' && ticket.user_id !== req.user.id)
        return res.status(403).json({ error: 'forbidden' });
      if (ticket.status === 'closed' && req.user.role !== 'admin')
        return res.status(400).json({ error: 'ticket is closed' });
      const isAdmin = req.user.role === 'admin';
      const { rows: [msg] } = await db.query(
        'INSERT INTO ticket_messages(ticket_id,user_id,body,is_admin) VALUES($1,$2,$3,$4) RETURNING id,body,is_admin,created_at',
        [req.params.id, req.user.id, body.trim(), isAdmin]
      );
      await db.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [req.params.id]);
      // reopen if closed and user replies (shouldn't happen but safety)
      res.json(msg);
    } catch (e) {
      console.error('[tickets/reply]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // PATCH /api/tickets/:id — admin: open/close
  r.patch('/:id', requireAdmin, express.json(), async (req, res) => {
    const { status } = req.body || {};
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    try {
      const { rows: [t] } = await db.query(
        'UPDATE tickets SET status=$1, updated_at=now() WHERE id=$2 RETURNING *',
        [status, req.params.id]
      );
      if (!t) return res.status(404).json({ error: 'not found' });
      res.json(t);
    } catch (e) {
      console.error('[tickets/patch]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  return r;
}

module.exports = { makeTicketsRouter };
