// ─── Per-user config store: non-sensitive blob + AES-encrypted API keys ─────
// API keys (Trakt client id, TMDB key, MDBList key) are encrypted with
// lib/crypto (CONFIG_ENC_KEY) and stored separately from config_json. They are
// decrypted in-memory only when serving a user's manifest/catalog/stream.
const crypto = require('./crypto');

const KEY_FIELDS = [
  ['traktClientId', 'trakt_enc'],
  ['tmdbApiKey', 'tmdb_enc'],
  ['mdblistApiKey', 'mdblist_enc'],
];

function makeUserConfig(db) {
  // Split a full config object into { blob (no keys), enc: {col: ciphertext|null} }.
  function splitAndEncrypt(full) {
    const blob = { ...(full || {}) };
    const enc = {};
    for (const [field, col] of KEY_FIELDS) {
      const v = blob[field];
      enc[col] = (v && String(v).length) ? crypto.encrypt(String(v)) : null;
      delete blob[field]; // never store key in the plaintext blob
    }
    return { blob, enc };
  }

  return {
    async save(userId, fullConfig) {
      const { blob, enc } = splitAndEncrypt(fullConfig);
      await db.query(
        `INSERT INTO user_config(user_id, config_json, trakt_enc, tmdb_enc, mdblist_enc, updated_at)
         VALUES($1,$2,$3,$4,$5,now())
         ON CONFLICT (user_id) DO UPDATE SET
           config_json=$2, trakt_enc=$3, tmdb_enc=$4, mdblist_enc=$5, updated_at=now()`,
        [userId, JSON.stringify(blob), enc.trakt_enc, enc.tmdb_enc, enc.mdblist_enc]
      );
    },

    // Full config WITH decrypted keys merged back — for serving a manifest. Never sent to a browser.
    async getForServe(userId) {
      const r = await db.query('SELECT * FROM user_config WHERE user_id=$1', [userId]);
      if (!r.rowCount) return null;
      const row = r.rows[0];
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {});
      for (const [field, col] of KEY_FIELDS) {
        if (row[col]) { try { cfg[field] = crypto.decrypt(row[col]); } catch { /* skip unreadable */ } }
      }
      return cfg;
    },

    // Config for the editor UI: the blob plus booleans for which keys are set (never the values).
    async getEditable(userId) {
      const r = await db.query('SELECT * FROM user_config WHERE user_id=$1', [userId]);
      if (!r.rowCount) return { config: {}, keys: { trakt: false, tmdb: false, mdblist: false } };
      const row = r.rows[0];
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {});
      return { config: cfg, keys: { trakt: !!row.trakt_enc, tmdb: !!row.tmdb_enc, mdblist: !!row.mdblist_enc } };
    },
  };
}

module.exports = { makeUserConfig, KEY_FIELDS };
