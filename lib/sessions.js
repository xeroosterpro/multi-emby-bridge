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
const { apiFetch } = require('./auth');
const { normalizeServerUrl } = require('./urlSafety');

function serverBaseUrl(url) {
  return normalizeServerUrl(url) || String(url || '').replace(/\/+$/, '');
}

function sessionEndpointUrls(baseUrl) {
  const base = serverBaseUrl(baseUrl);
  const out = [];
  const add = (path) => {
    try { out.push(new URL(`${base}${path}`)); } catch { /* skip */ }
  };
  add('/Sessions');
  if (!/\/emby$/i.test(base)) add('/emby/Sessions');
  return out;
}

function formatLiveTitle(np) {
  if (!np) return 'Unknown';
  if (np.Type === 'Episode' && np.SeriesName) {
    const s = np.ParentIndexNumber != null ? `S${np.ParentIndexNumber}` : '';
    const e = np.IndexNumber != null ? `E${np.IndexNumber}` : '';
    const ep = np.Name && np.Name !== np.SeriesName ? ` — ${np.Name}` : '';
    return `${np.SeriesName} ${s}${e}${ep}`.trim();
  }
  return np.Name || 'Unknown';
}

function parseLiveSessions(sessions, server) {
  const out = [];
  for (const sess of (Array.isArray(sessions) ? sessions : [])) {
    const np = sess && sess.NowPlayingItem;
    if (!np) continue;
    const ps = sess.PlayState || {};
    const ti = sess.TranscodingInfo || null;
    const runTicks = Number(np.RunTimeTicks) || 0;
    const posTicks = ps.PositionTicks != null ? Number(ps.PositionTicks) : null;
    let progressPct = null;
    if (runTicks > 0 && posTicks != null && posTicks >= 0) {
      progressPct = Math.min(100, Math.max(0, Math.round((posTicks / runTicks) * 100)));
    }
    out.push({
      server: server.label || server.url,
      serverType: server.type || 'emby',
      title: formatLiveTitle(np),
      rawTitle: np.Name || null,
      itemType: np.Type || null,
      seriesName: np.SeriesName || null,
      season: np.ParentIndexNumber ?? null,
      episode: np.IndexNumber ?? null,
      user: sess.UserName || sess.DeviceName || null,
      client: sess.Client || sess.AppName || null,
      device: sess.DeviceName || null,
      positionTicks: posTicks,
      runTimeTicks: runTicks || null,
      progressPct,
      isPaused: !!ps.IsPaused,
      playMethod: ps.PlayMethod || null,
      isTranscoding: !!(ti && (ti.IsVideoDirect === false || ti.IsAudioDirect === false)),
      sessionId: sess.Id || null,
    });
  }
  return out;
}

async function fetchServerSessionsDetailed(server, fetchImpl) {
  const label = server?.label || server?.url || 'server';
  if (!server || !server.url || !server.apiKey) {
    return { server: label, ok: false, live: [], count: 0, ms: 0, error: 'missing credentials' };
  }
  const normalized = { ...server, url: serverBaseUrl(server.url) };
  const t0 = Date.now();
  let lastErr = 'unreachable';
  for (const urlObj of sessionEndpointUrls(normalized.url)) {
    try {
      urlObj.searchParams.set('ActiveWithinSeconds', '7200');
      let resp;
      if (fetchImpl) {
        const { appendAuth, authHeaders } = require('./auth');
        appendAuth(urlObj, normalized);
        resp = await fetchImpl(urlObj.toString(), { headers: authHeaders(normalized) });
        if (!resp || !resp.ok) {
          lastErr = `HTTP ${resp?.status || 'error'}`;
          continue;
        }
      } else {
        const target = urlObj.toString();
        resp = await apiFetch(normalized, () => new URL(target), 12000);
      }
      const sessions = await resp.json();
      const live = parseLiveSessions(sessions, normalized);
      return {
        server: normalized.label || normalized.url,
        ok: true,
        live,
        count: live.length,
        ms: Date.now() - t0,
        error: null,
      };
    } catch (e) {
      lastErr = e.status ? `HTTP ${e.status}` : (e.name === 'AbortError' ? 'timeout' : (e.message || 'failed'));
    }
  }
  return {
    server: normalized.label || normalized.url,
    ok: false,
    live: [],
    count: 0,
    ms: Date.now() - t0,
    error: lastErr,
  };
}

async function fetchServerSessions(server, fetchImpl) {
  const probe = await fetchServerSessionsDetailed(server, fetchImpl);
  return probe.live;
}

async function fetchLiveForServers(servers, fetchImpl) {
  const probes = await Promise.all((servers || []).map((s) => fetchServerSessionsDetailed(s, fetchImpl)));
  const live = [];
  for (const p of probes) live.push(...(p.live || []));
  return { live, probes };
}

function makeLiveSessions(fetchImpl) {
  return {
    async forUser(servers) {
      const { live } = await fetchLiveForServers(servers, fetchImpl);
      return live;
    },
    async forUserDetailed(servers) {
      return fetchLiveForServers(servers, fetchImpl);
    },
  };
}

const livePlayback = require('./livePlayback');

module.exports = {
  makeSessions,
  SESSION_TTL_MS,
  makeLiveSessions,
  parseLiveSessions,
  formatLiveTitle,
  serverBaseUrl,
  sessionEndpointUrls,
  fetchServerSessions,
  fetchServerSessionsDetailed,
  fetchLiveForServers,
  ...livePlayback,
};