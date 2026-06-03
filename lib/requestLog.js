// ─── Durable DB-backed request log ─────────────────────────────────────────
// makeRequestLog(db): record() inserts a stream-request row; recent()/forUser()
// return rows mapped to the shape the admin UI + adminStats expect
// ({ userId, ts, title, type, season, episode, server, ms, found }).
function mapRow(r) {
  return {
    userId: r.user_id || null, ts: r.ts, title: r.content_name || null, type: r.type || null,
    season: r.season ?? null, episode: r.episode ?? null, server: r.best_server || null,
    ms: r.response_ms ?? null, found: !!r.found,
  };
}

function makeRequestLog(db) {
  return {
    async record({ userId = null, ts = null, type = null, imdbId = null, contentName = null, bestServer = null, season = null, episode = null, ms = null, found = false }) {
      await db.query(
        `INSERT INTO request_log(user_id, ts, type, imdb_id, content_name, best_server, season, episode, response_ms, found)
         VALUES($1, COALESCE($2, now()), $3,$4,$5,$6,$7,$8,$9,$10)`,
        [userId, ts, type, imdbId, contentName, bestServer, season, episode, ms, found]
      );
    },
    async recent(limit = 50) {
      const r = await db.query(`SELECT * FROM request_log ORDER BY ts DESC LIMIT $1`, [limit]);
      return r.rows.map(mapRow);
    },
    async forUser(userId, limit = 50) {
      const r = await db.query(`SELECT * FROM request_log WHERE user_id=$1 ORDER BY ts DESC LIMIT $2`, [userId, limit]);
      return r.rows.map(mapRow);
    },
  };
}

module.exports = { makeRequestLog, mapRow };
