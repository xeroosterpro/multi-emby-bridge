// ─── Session repository ─────────────────────────────────────────────────────
// Stores only the SHA-256 hash of the session token; the raw token lives in the
// client cookie. Injectable db for testability.
const accounts = require('./accounts');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function makeSessions(db) {
  return {
    async create(userId) {
      const token = accounts.generateSessionToken();
      const tokenHash = accounts.hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await db.query(
        'INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,$3) RETURNING *',
        [userId, tokenHash, expiresAt]
      );
      return { token, expiresAt };
    },
    async lookup(token) {
      if (!token) return null;
      const r = await db.query(
        `SELECT s.*, u.username, u.role FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [accounts.hashToken(token)]
      );
      return r.rowCount ? r.rows[0] : null;
    },
    async destroy(token) {
      if (!token) return;
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [accounts.hashToken(token)]);
    },
  };
}

module.exports = { makeSessions, SESSION_TTL_MS };
