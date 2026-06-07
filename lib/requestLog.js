// ─── Durable DB-backed request log ─────────────────────────────────────────
// makeRequestLog(db): record() inserts a stream-request row; recent()/forUser()
// return rows mapped to the shape the admin UI + adminStats expect
// ({ userId, ts, title, type, season, episode, server, ms, found }) PLUS the rich
// detail the Request-log page renders ({ bestFile, serverStatus }).
function normalizeServerLabel(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'object') return val.label || null;
  const s = String(val);
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o.label || null;
    } catch { /* legacy plain text */ }
  }
  return s;
}

function mapRow(r) {
  return {
    userId: r.user_id || null, ts: r.ts, title: r.content_name || null, type: r.type || null,
    imdbId: r.imdb_id || null,
    season: r.season ?? null, episode: r.episode ?? null, server: normalizeServerLabel(r.best_server),
    ms: r.response_ms ?? null, found: !!r.found,
    bestFile: r.best_file ?? null, serverStatus: r.server_status ?? null,
  };
}

function makeRequestLog(db) {
  return {
    async record({ userId = null, ts = null, type = null, imdbId = null, contentName = null, bestServer = null, serverStatus = null, season = null, episode = null, ms = null, found = false }) {
      // bestServer may be a plain label string (legacy) or a rich object
      // ({label,size,bitrate,...}). Persist the label in best_server (TEXT, used by
      // adminStats "busiest server") and the full object in best_file (JSONB).
      const isObj = bestServer && typeof bestServer === 'object';
      const label = isObj ? (bestServer.label || null) : (bestServer || null);
      const bestFile = isObj ? bestServer : null;
      await db.query(
        `INSERT INTO request_log(user_id, ts, type, imdb_id, content_name, best_server, best_file, server_status, season, episode, response_ms, found)
         VALUES($1, COALESCE($2, now()), $3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [userId, ts, type, imdbId, contentName, label,
         bestFile ? JSON.stringify(bestFile) : null,
         serverStatus ? JSON.stringify(serverStatus) : null,
         season, episode, ms, found]
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
    async clearForUser(userId) {
      await db.query(`DELETE FROM request_log WHERE user_id=$1`, [userId]);
    },
  };
}

module.exports = { makeRequestLog, mapRow, normalizeServerLabel };
