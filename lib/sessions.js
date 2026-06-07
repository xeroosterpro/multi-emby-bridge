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

// ─── Live now-playing across a user's servers (best-effort) ─────────────────
// makeLiveSessions(fetchImpl?) → forUser(servers): queries each server's
// /Sessions API (Emby/Jellyfin compatible). Any server that errors, times out,
// or denies access simply contributes nothing. Never throws.
const { apiFetch } = require('./auth');

function parseLiveSessions(sessions, server) {
  const out = [];
  for (const sess of (Array.isArray(sessions) ? sessions : [])) {
    const np = sess && sess.NowPlayingItem;
    if (!np) continue;
    out.push({
      server: server.label || server.url,
      serverType: server.type || 'emby',
      title: np.Name || 'Unknown',
      itemType: np.Type || null,
      user: sess.UserName || null,
      client: sess.Client || null,
    });
  }
  return out;
}

async function fetchServerSessions(server, fetchImpl) {
  if (!server || !server.url || !server.apiKey) return [];
  const normalized = { ...server, url: server.url.replace(/\/+$/, '') };
  let resp;
  if (fetchImpl) {
    const url = new URL(`${normalized.url}/Sessions`);
    const { appendAuth, authHeaders } = require('./auth');
    appendAuth(url, normalized);
    resp = await fetchImpl(url.toString(), { headers: authHeaders(normalized) });
  } else {
    resp = await apiFetch(normalized, () => new URL(`${normalized.url}/Sessions`), 8000);
  }
  if (!resp || !resp.ok) return [];
  const sessions = await resp.json();
  return parseLiveSessions(sessions, normalized);
}

function makeLiveSessions(fetchImpl) {
  return {
    async forUser(servers) {
      const out = [];
      await Promise.all((servers || []).map(async (s) => {
        try {
          out.push(...await fetchServerSessions(s, fetchImpl));
        } catch { /* unreachable / no permission / timeout — skip */ }
      }));
      return out;
    },
  };
}

module.exports = { makeSessions, SESSION_TTL_MS, makeLiveSessions, parseLiveSessions, fetchServerSessions };
