// ─── Per-user server uptime history persistence ─────────────────────────────
// makeServerHistory(db): logCheck() writes a raw row + upserts the day's rollup;
// listForUser() returns daily rollups + recent raw checks grouped per server;
// prune() drops raw rows older than RAW_RETENTION_DAYS (rollups kept forever).
const RAW_RETENTION_DAYS = 90;

function dayOf(ts) { return new Date(ts || Date.now()).toISOString().slice(0, 10); }

function makeServerHistory(db) {
  return {
    async logCheck({ userId, serverUrl, label = null, up, responseMs = null, day = null }) {
      const d = day || dayOf();
      await db.query(
        `INSERT INTO server_health_log(user_id, server_url, label, up, response_ms) VALUES($1,$2,$3,$4,$5)`,
        [userId, serverUrl, label, up, responseMs]
      );
      // Upsert daily rollup: increment checks/up_checks, maintain running avg_ms over non-null samples.
      await db.query(
        `INSERT INTO server_uptime_daily(user_id, server_url, label, day, checks, up_checks, avg_ms)
         VALUES($1,$2,$3,$4,1,$5,$6)
         ON CONFLICT (user_id, server_url, day) DO UPDATE SET
           checks = server_uptime_daily.checks + 1,
           up_checks = server_uptime_daily.up_checks + $5,
           label = EXCLUDED.label,
           avg_ms = CASE WHEN $6 IS NULL THEN server_uptime_daily.avg_ms
             ELSE ROUND(((COALESCE(server_uptime_daily.avg_ms,0) * server_uptime_daily.checks) + $6) / (server_uptime_daily.checks + 1)) END`,
        [userId, serverUrl, label, d, up ? 1 : 0, responseMs]
      );
    },
    async listForUser(userId) {
      const daily = await db.query(
        `SELECT server_url, label, day, checks, up_checks, avg_ms FROM server_uptime_daily WHERE user_id=$1 ORDER BY day DESC`,
        [userId]);
      const recent = await db.query(
        `SELECT server_url, label, up, response_ms, checked_at FROM server_health_log WHERE user_id=$1 AND checked_at > now() - interval '2 days' ORDER BY checked_at DESC LIMIT 1000`,
        [userId]);
      const byUrl = new Map();
      for (const row of daily.rows) {
        if (!byUrl.has(row.server_url)) byUrl.set(row.server_url, { url: row.server_url, label: row.label, daily: [], recent: [] });
        byUrl.get(row.server_url).daily.push(row);
      }
      for (const row of recent.rows) {
        if (!byUrl.has(row.server_url)) byUrl.set(row.server_url, { url: row.server_url, label: row.label, daily: [], recent: [] });
        byUrl.get(row.server_url).recent.push(row);
      }
      return { servers: [...byUrl.values()] };
    },
    async prune() {
      await db.query(`DELETE FROM server_health_log WHERE checked_at < now() - interval '${RAW_RETENTION_DAYS} days'`);
    },
  };
}

module.exports = { makeServerHistory, RAW_RETENTION_DAYS };
