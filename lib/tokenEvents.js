// ─── Token re-auth audit trail (DB + in-memory ring buffer) ─────────────────
const db = require('./db');

const RING_MAX = 500;
const _ring = [];

function recordTokenEvent(evt) {
  const row = {
    serverUrl: evt.serverUrl || '',
    userId: evt.userId != null ? String(evt.userId) : null,
    label: evt.label || null,
    ok: !!evt.ok,
    status: evt.status != null ? Number(evt.status) : null,
    message: evt.message || null,
    createdAt: new Date().toISOString(),
  };
  _ring.unshift(row);
  if (_ring.length > RING_MAX) _ring.length = RING_MAX;
  if (db.isConfigured()) {
    db.query(
      `INSERT INTO token_events(server_url, user_id, label, ok, status, message) VALUES($1,$2,$3,$4,$5,$6)`,
      [row.serverUrl, row.userId, row.label, row.ok, row.status, row.message]
    ).catch(e => console.error('[tokenEvents]', e.message));
  }
  return row;
}

async function recentEvents(limit = 100) {
  const n = Math.min(Math.max(1, limit), 500);
  if (db.isConfigured()) {
    try {
      const q = await db.query(
        `SELECT server_url, user_id, label, ok, status, message, created_at
           FROM token_events ORDER BY created_at DESC LIMIT $1`, [n]);
      return q.rows.map(r => ({
        serverUrl: r.server_url,
        userId: r.user_id,
        label: r.label,
        ok: r.ok,
        status: r.status,
        message: r.message,
        createdAt: r.created_at,
      }));
    } catch { /* fall through */ }
  }
  return _ring.slice(0, n);
}

async function aggregateEvents() {
  const base = { total: _ring.length, ok24h: 0, fail24h: 0, fail7d: 0, byServer: {} };
  if (!db.isConfigured()) {
    const cutoff24 = Date.now() - 86400000;
    const cutoff7 = Date.now() - 7 * 86400000;
    for (const e of _ring) {
      const t = new Date(e.createdAt).getTime();
      if (t >= cutoff24) {
        if (e.ok) base.ok24h++; else base.fail24h++;
      }
      if (t >= cutoff7 && !e.ok) base.fail7d++;
      const k = e.serverUrl || 'unknown';
      if (!base.byServer[k]) base.byServer[k] = { ok: 0, fail: 0, label: e.label };
      if (e.ok) base.byServer[k].ok++; else base.byServer[k].fail++;
    }
    return base;
  }
  try {
    const q = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ok AND created_at > now() - interval '24 hours')::int AS ok24h,
        COUNT(*) FILTER (WHERE NOT ok AND created_at > now() - interval '24 hours')::int AS fail24h,
        COUNT(*) FILTER (WHERE NOT ok AND created_at > now() - interval '7 days')::int AS fail7d
      FROM token_events`);
    const row = q.rows[0] || {};
    const by = await db.query(`
      SELECT server_url, MAX(label) AS label,
             COUNT(*) FILTER (WHERE ok)::int AS ok_n,
             COUNT(*) FILTER (WHERE NOT ok)::int AS fail_n
        FROM token_events
       WHERE created_at > now() - interval '7 days'
       GROUP BY server_url
       ORDER BY fail_n DESC
       LIMIT 50`);
    const byServer = {};
    for (const r of by.rows) {
      byServer[r.server_url] = { ok: r.ok_n, fail: r.fail_n, label: r.label };
    }
    return {
      total: row.total || 0,
      ok24h: row.ok24h || 0,
      fail24h: row.fail24h || 0,
      fail7d: row.fail7d || 0,
      byServer,
    };
  } catch {
    return base;
  }
}

async function reauthTimeSeries(days = 7) {
  if (!db.isConfigured()) {
    const buckets = new Map();
    const cutoff = Date.now() - days * 86400000;
    for (const e of _ring) {
      const t = new Date(e.createdAt).getTime();
      if (t < cutoff) continue;
      const key = e.createdAt.slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, { label: key, ok: 0, fail: 0 });
      const b = buckets.get(key);
      if (e.ok) b.ok++; else b.fail++;
    }
    return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  try {
    const q = await db.query(`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS label,
             COUNT(*) FILTER (WHERE ok)::int AS ok,
             COUNT(*) FILTER (WHERE NOT ok)::int AS fail
        FROM token_events
       WHERE created_at > now() - ($1::int || ' days')::interval
       GROUP BY 1 ORDER BY 1`, [days]);
    return q.rows;
  } catch {
    return [];
  }
}

module.exports = { recordTokenEvent, recentEvents, aggregateEvents, reauthTimeSeries, RING_MAX };