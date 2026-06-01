// ─── DB-backed manifest token store ─────────────────────────────────────────
// Same interface as lib/manifest.js's in-memory store, backed by manifest_tokens.
const { generateToken } = require('./manifest');

function makeManifestStore(db) {
  return {
    async issue(userId) {
      const token = generateToken();
      await db.query('INSERT INTO manifest_tokens(token, user_id) VALUES($1,$2)', [token, userId]);
      return token;
    },
    async lookup(token) {
      if (!token) return null;
      const r = await db.query(
        'SELECT * FROM manifest_tokens WHERE token=$1 AND revoked_at IS NULL', [token]);
      return r.rowCount ? r.rows[0] : null;
    },
    async revoke(token) {
      const r = await db.query(
        'UPDATE manifest_tokens SET revoked_at=now() WHERE token=$1 AND revoked_at IS NULL', [token]);
      return r.rowCount > 0;
    },
    // Revoke all of the user's active tokens, then issue a fresh one.
    async regenerate(userId) {
      await db.query('UPDATE manifest_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      return this.issue(userId);
    },
    // The user's current active token (or null).
    async current(userId) {
      const r = await db.query(
        'SELECT token FROM manifest_tokens WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1', [userId]);
      return r.rowCount ? r.rows[0].token : null;
    },
  };
}

module.exports = { makeManifestStore };
