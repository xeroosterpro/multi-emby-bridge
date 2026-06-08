// ─── Support tickets: create, list, reply, admin manage ──────────────────────
const express = require('express');
const db = require('../lib/db');

const VALID_STATUS = ['open', 'in_progress', 'closed', 'resolved'];
const VALID_PRIORITY = ['low', 'normal', 'high', 'urgent'];
const VALID_CATEGORY = ['general', 'streaming', 'servers', 'billing', 'bug', 'feature'];

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

  const listSelect = `
    SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at, t.updated_at, u.username,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id)::int AS message_count,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=false
              AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
                WHERE m2.ticket_id=t.id AND m2.is_admin=true), '1970-01-01'))::int AS unread_admin,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=true
              AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
                WHERE m2.ticket_id=t.id AND m2.is_admin=false), '1970-01-01'))::int AS unread_user
    FROM tickets t JOIN users u ON t.user_id=u.id`;

  const listSelectUser = `
    SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at, t.updated_at,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id)::int AS message_count,
           (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=true
              AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
                WHERE m2.ticket_id=t.id AND m2.is_admin=false), '1970-01-01'))::int AS unread
    FROM tickets t`;

  function buildFilters(query, isAdmin, userId) {
    const clauses = [];
    const params = [];
    let n = 1;

    if (!isAdmin) {
      clauses.push(`t.user_id=$${n++}`);
      params.push(userId);
    }

    const status = (query.status || '').trim();
    if (status && status !== 'all') {
      if (status === 'closed') {
        clauses.push(`t.status IN ('closed', 'resolved')`);
      } else if (VALID_STATUS.includes(status)) {
        clauses.push(`t.status=$${n++}`);
        params.push(status);
      }
    }

    const category = (query.category || '').trim();
    if (category && category !== 'all' && VALID_CATEGORY.includes(category)) {
      clauses.push(`t.category=$${n++}`);
      params.push(category);
    }

    const priority = (query.priority || '').trim();
    if (priority && priority !== 'all' && VALID_PRIORITY.includes(priority)) {
      clauses.push(`t.priority=$${n++}`);
      params.push(priority);
    }

    const q = (query.q || '').trim();
    if (q) {
      clauses.push(`(t.subject ILIKE $${n} OR t.id::text ILIKE $${n})`);
      params.push(`%${q}%`);
      n++;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return { where, params };
  }

  function mapListRow(row, isAdmin) {
    const unread = isAdmin ? (row.unread_admin || 0) : (row.unread || row.unread_user || 0);
    return { ...row, unread };
  }

  // GET /api/tickets/stats — counts for dashboard tiles
  r.get('/stats', requireAuth, async (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const baseWhere = isAdmin ? '' : 'WHERE user_id=$1';
      const baseParams = isAdmin ? [] : [req.user.id];
      const { rows } = await db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status='open')::int AS open,
          COUNT(*) FILTER (WHERE status='in_progress')::int AS in_progress,
          COUNT(*) FILTER (WHERE status IN ('closed','resolved'))::int AS closed,
          COUNT(*) FILTER (WHERE status='resolved')::int AS resolved
        FROM tickets ${baseWhere}`, baseParams);
      const stats = rows[0] || { total: 0, open: 0, in_progress: 0, closed: 0, resolved: 0 };

      const unreadSql = isAdmin
        ? `SELECT COUNT(DISTINCT t.id)::int AS awaiting FROM tickets t
           WHERE t.status IN ('open','in_progress')
           AND EXISTS (
             SELECT 1 FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=false
             AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
               WHERE m2.ticket_id=t.id AND m2.is_admin=true), '1970-01-01')
           )`
        : `SELECT COUNT(DISTINCT t.id)::int AS awaiting FROM tickets t
           WHERE t.user_id=$1 AND t.status IN ('open','in_progress')
           AND EXISTS (
             SELECT 1 FROM ticket_messages m WHERE m.ticket_id=t.id AND m.is_admin=true
             AND m.created_at > COALESCE((SELECT MAX(m2.created_at) FROM ticket_messages m2
               WHERE m2.ticket_id=t.id AND m2.is_admin=false), '1970-01-01')
           )`;
      const { rows: ur } = await db.query(unreadSql, isAdmin ? [] : [req.user.id]);
      stats.awaiting = ur[0]?.awaiting || 0;
      res.json(stats);
    } catch (e) {
      console.error('[tickets/stats]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // GET /api/tickets — user sees own, admin sees all (filterable)
  r.get('/', requireAuth, async (req, res) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const { where, params } = buildFilters(req.query, isAdmin, req.user.id);
      const sql = `${isAdmin ? listSelect : listSelectUser} ${where} ORDER BY t.updated_at DESC LIMIT 200`;
      const { rows } = await db.query(sql, params);
      res.json(rows.map(row => mapListRow(row, isAdmin)));
    } catch (e) {
      console.error('[tickets/list]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // POST /api/tickets — create with first message
  r.post('/', requireAuth, async (req, res) => {
    const { subject, body, category, priority } = req.body || {};
    if (!subject || !subject.trim()) return res.status(400).json({ error: 'subject required' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'message required' });
    const cat = VALID_CATEGORY.includes(category) ? category : 'general';
    const pri = req.user.role === 'admin' && VALID_PRIORITY.includes(priority) ? priority : 'normal';
    try {
      const { rows: [ticket] } = await db.query(
        `INSERT INTO tickets(user_id, subject, category, priority) VALUES($1,$2,$3,$4)
         RETURNING id, subject, status, category, priority, created_at, updated_at`,
        [req.user.id, subject.trim(), cat, pri]
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
    if (req.params.id === 'stats') return res.status(404).json({ error: 'not found' });
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
  r.post('/:id/reply', requireAuth, async (req, res) => {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'message required' });
    try {
      const { rows: [ticket] } = await db.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
      if (!ticket) return res.status(404).json({ error: 'not found' });
      if (req.user.role !== 'admin' && ticket.user_id !== req.user.id)
        return res.status(403).json({ error: 'forbidden' });
      if (['closed', 'resolved'].includes(ticket.status) && req.user.role !== 'admin')
        return res.status(400).json({ error: 'ticket is closed' });
      const isAdmin = req.user.role === 'admin';
      const { rows: [msg] } = await db.query(
        'INSERT INTO ticket_messages(ticket_id,user_id,body,is_admin) VALUES($1,$2,$3,$4) RETURNING id,body,is_admin,created_at',
        [req.params.id, req.user.id, body.trim(), isAdmin]
      );
      const newStatus = isAdmin && ticket.status === 'open' ? 'in_progress' : ticket.status;
      await db.query('UPDATE tickets SET status=$1, updated_at=now() WHERE id=$2', [newStatus, req.params.id]);
      res.json(msg);
    } catch (e) {
      console.error('[tickets/reply]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // DELETE /api/tickets/:id — admin: any; user: own tickets only
  r.delete('/:id', requireAuth, async (req, res) => {
    try {
      const { rows: [ticket] } = await db.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
      if (!ticket) return res.status(404).json({ error: 'not found' });
      const isAdmin = req.user.role === 'admin';
      if (!isAdmin && ticket.user_id !== req.user.id)
        return res.status(403).json({ error: 'forbidden' });
      await db.query('DELETE FROM tickets WHERE id=$1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[tickets/delete]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // PATCH /api/tickets/:id — admin: full control; user: close own ticket
  r.patch('/:id', requireAuth, async (req, res) => {
    const { status, priority, category } = req.body || {};
    try {
      const { rows: [ticket] } = await db.query('SELECT * FROM tickets WHERE id=$1', [req.params.id]);
      if (!ticket) return res.status(404).json({ error: 'not found' });
      const isAdmin = req.user.role === 'admin';
      if (!isAdmin && ticket.user_id !== req.user.id)
        return res.status(403).json({ error: 'forbidden' });

      const updates = [];
      const params = [];
      let n = 1;

      if (status !== undefined) {
        if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'invalid status' });
        if (!isAdmin && !['closed', 'resolved'].includes(status))
          return res.status(403).json({ error: 'users may only close tickets' });
        updates.push(`status=$${n++}`);
        params.push(status);
      }
      if (isAdmin && priority !== undefined) {
        if (!VALID_PRIORITY.includes(priority)) return res.status(400).json({ error: 'invalid priority' });
        updates.push(`priority=$${n++}`);
        params.push(priority);
      }
      if (isAdmin && category !== undefined) {
        if (!VALID_CATEGORY.includes(category)) return res.status(400).json({ error: 'invalid category' });
        updates.push(`category=$${n++}`);
        params.push(category);
      }

      if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
      updates.push('updated_at=now()');
      params.push(req.params.id);

      const { rows: [t] } = await db.query(
        `UPDATE tickets SET ${updates.join(', ')} WHERE id=$${n} RETURNING *`,
        params
      );
      res.json(t);
    } catch (e) {
      console.error('[tickets/patch]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  return r;
}

module.exports = { makeTicketsRouter };