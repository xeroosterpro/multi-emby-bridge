// ─── Per-user config store: non-sensitive blob + AES-encrypted API keys ─────
// Catalog API keys (Trakt, TMDB, MDBList) and per-server Emby/Jellyfin credentials
// are encrypted with lib/crypto (CONFIG_ENC_KEY) and stored separately from config_json.
const crypto = require('./crypto');

const KEY_FIELDS = [
  ['traktClientId', 'trakt_enc'],
  ['tmdbApiKey', 'tmdb_enc'],
  ['mdblistApiKey', 'mdblist_enc'],
];

const SERVER_CRED_FIELDS = ['apiKey', 'username', 'password'];

function normUrl(u) {
  return (u || '').replace(/\/+$/, '').toLowerCase();
}

function extractServerCreds(servers) {
  return (servers || []).map(s => {
    const creds = {};
    for (const f of SERVER_CRED_FIELDS) {
      const v = s && s[f];
      creds[f] = (v && String(v).length) ? String(v) : null;
    }
    return creds;
  });
}

function stripServerCreds(servers) {
  return (servers || []).map(s => {
    const out = { ...(s || {}) };
    for (const f of SERVER_CRED_FIELDS) delete out[f];
    return out;
  });
}

function serverCredFlags(creds) {
  return {
    hasApiKey: !!(creds && creds.apiKey),
    hasUsername: !!(creds && creds.username),
    hasPassword: !!(creds && creds.password),
  };
}

function mergeServerCreds(incomingServers, existingCredsByUrl) {
  return (incomingServers || []).map((s, i) => {
    const out = { ...(s || {}) };
    const stored = existingCredsByUrl.get(normUrl(s.url)) || existingCredsByUrl.get(`__idx:${i}`);
    for (const f of SERVER_CRED_FIELDS) {
      const v = out[f];
      if (!v || !String(v).length) {
        if (stored && stored[f]) out[f] = stored[f];
      }
    }
    return out;
  });
}

function makeUserConfig(db) {
  function splitAndEncrypt(full) {
    const blob = { ...(full || {}) };
    const enc = {};
    for (const [field, col] of KEY_FIELDS) {
      const v = blob[field];
      enc[col] = (v && String(v).length) ? crypto.encrypt(String(v)) : null;
      delete blob[field];
    }
    if (Array.isArray(blob.servers)) {
      blob.servers = stripServerCreds(blob.servers);
    }
    return { blob, enc };
  }

  function decryptCatalogKeys(cfg, row) {
    for (const [field, col] of KEY_FIELDS) {
      if (row[col]) {
        try { cfg[field] = crypto.decrypt(row[col]); }
        catch (e) { console.warn('[userConfig] decrypt catalog key failed:', field, e.message); }
      }
    }
  }

  function decryptServerCreds(row) {
    if (row.servers_enc) {
      try {
        const parsed = JSON.parse(crypto.decrypt(row.servers_enc));
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.warn('[userConfig] decrypt servers_enc failed:', e.message);
      }
    }
    // Legacy plaintext creds still in config_json — migrate lazily on read.
    return extractServerCreds(
      typeof row.config_json === 'string'
        ? JSON.parse(row.config_json).servers
        : (row.config_json || {}).servers
    );
  }

  function applyServerCreds(cfg, credsList) {
    if (!Array.isArray(cfg.servers) || !Array.isArray(credsList)) return cfg;
    cfg.servers = cfg.servers.map((s, i) => {
      const creds = credsList[i] || {};
      const out = { ...s };
      for (const f of SERVER_CRED_FIELDS) {
        if (creds[f]) out[f] = creds[f];
      }
      return out;
    });
    return cfg;
  }

  function credsByUrl(credsList, servers) {
    const map = new Map();
    (servers || []).forEach((s, i) => {
      const url = normUrl(s.url);
      if (url) map.set(url, credsList[i] || {});
      map.set(`__idx:${i}`, credsList[i] || {});
    });
    return map;
  }

  async function loadRow(userId) {
    const r = await db.query('SELECT * FROM user_config WHERE user_id=$1', [userId]);
    if (!r.rowCount) return null;
    return r.rows[0];
  }

  return {
    async save(userId, fullConfig) {
      let merged = { ...(fullConfig || {}) };
      const existing = await loadRow(userId);
      if (existing && Array.isArray(merged.servers)) {
        const existingCreds = decryptServerCreds(existing);
        const existingServers = typeof existing.config_json === 'string'
          ? JSON.parse(existing.config_json).servers
          : (existing.config_json || {}).servers;
        merged.servers = mergeServerCreds(merged.servers, credsByUrl(existingCreds, existingServers));
      }

      const serverCreds = extractServerCreds(merged.servers);
      const serversEnc = serverCreds.some(c => c.apiKey || c.username || c.password)
        ? crypto.encrypt(JSON.stringify(serverCreds))
        : null;

      const { blob, enc } = splitAndEncrypt(merged);
      await db.query(
        `INSERT INTO user_config(user_id, config_json, trakt_enc, tmdb_enc, mdblist_enc, servers_enc, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (user_id) DO UPDATE SET
           config_json=$2, trakt_enc=$3, tmdb_enc=$4, mdblist_enc=$5, servers_enc=$6, updated_at=now()`,
        [userId, JSON.stringify(blob), enc.trakt_enc, enc.tmdb_enc, enc.mdblist_enc, serversEnc]
      );
    },

    async getForServe(userId) {
      const row = await loadRow(userId);
      if (!row) return null;
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {});

      // Detect legacy plaintext creds in the STORED blob *before* we re-inject
      // decrypted creds. Checking after applyServerCreds() would always be true,
      // forcing a needless encrypt+write on every serve (hot path) — see SEC-2.
      const storedHasPlaintext = Array.isArray(cfg.servers)
        && cfg.servers.some(s => s && (s.apiKey || s.password || s.username));

      decryptCatalogKeys(cfg, row);
      const creds = decryptServerCreds(row);
      applyServerCreds(cfg, creds);

      // Lazy migration: only when creds are still plaintext in the stored blob,
      // or there's no servers_enc column yet but decrypted creds exist.
      const needsMigration = storedHasPlaintext
        || (!row.servers_enc && creds.some(c => c.apiKey || c.password || c.username));
      if (needsMigration) {
        try { await this.save(userId, cfg); } catch (e) {
          console.warn('[userConfig] lazy cred migration failed:', e.message);
        }
      }
      return cfg;
    },

    async getEditable(userId) {
      const row = await loadRow(userId);
      if (!row) return { config: {}, keys: { trakt: false, tmdb: false, mdblist: false } };
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : (row.config_json || {});
      const creds = decryptServerCreds(row);
      if (Array.isArray(cfg.servers)) {
        cfg.servers = cfg.servers.map((s, i) => ({
          ...s,
          ...serverCredFlags(creds[i] || {}),
        }));
      }
      return {
        config: cfg,
        keys: { trakt: !!row.trakt_enc, tmdb: !!row.tmdb_enc, mdblist: !!row.mdblist_enc },
      };
    },
  };
}

module.exports = {
  makeUserConfig,
  KEY_FIELDS,
  SERVER_CRED_FIELDS,
  stripServerCreds,
  extractServerCreds,
  mergeServerCreds,
  serverCredFlags,
};