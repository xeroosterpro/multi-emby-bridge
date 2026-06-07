// ─── Session repository ─────────────────────────────────────────────────────
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
const { serverBaseUrl, apiPathVariants } = require('./serverPaths');

function sessionEndpointUrls(baseUrl) {
  return apiPathVariants(baseUrl, '/Sessions');
}

function userPlayingEndpointUrls(baseUrl, userId) {
  const q = 'Recursive=true&IncludeItemTypes=Movie,Episode,Video&Filters=IsPlaying'
    + '&Fields=BasicSyncInfo,RunTimeTicks,ParentIndexNumber,IndexNumber,SeriesName,Type,Name,UserData';
  return apiPathVariants(baseUrl, `/Users/${encodeURIComponent(userId)}/Items?${q}`);
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

function mapPlayingItem(np, server, source) {
  const ud = np.UserData || {};
  const ps = np.PlayState || {};
  const posTicks = ps.PositionTicks != null
    ? Number(ps.PositionTicks)
    : (ud.PlaybackPositionTicks != null ? Number(ud.PlaybackPositionTicks) : null);
  const runTicks = Number(np.RunTimeTicks) || 0;
  let progressPct = null;
  if (runTicks > 0 && posTicks != null && posTicks >= 0) {
    progressPct = Math.min(100, Math.max(0, Math.round((posTicks / runTicks) * 100)));
  }
  return {
    server: server.label || server.url,
    serverUrl: serverBaseUrl(server.url),
    serverType: server.type || 'emby',
    title: formatLiveTitle(np),
    rawTitle: np.Name || null,
    itemType: np.Type || null,
    seriesName: np.SeriesName || null,
    season: np.ParentIndexNumber ?? null,
    episode: np.IndexNumber ?? null,
    user: server._sessionUser || null,
    client: source === 'sessions' ? null : 'Playing now',
    device: null,
    positionTicks: posTicks,
    runTimeTicks: runTicks || null,
    progressPct,
    isPaused: !!ps.IsPaused,
    playMethod: ps.PlayMethod || null,
    isTranscoding: false,
    sessionId: np.Id || null,
    source,
  };
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
      serverUrl: serverBaseUrl(server.url),
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
      source: 'sessions',
    });
  }
  return out;
}

async function fetchJsonFromPaths(server, urlObjs, fetchImpl, timeoutMs = 12000) {
  let lastErr = 'unreachable';
  for (const urlObj of urlObjs) {
    try {
      let resp;
      if (fetchImpl) {
        const { appendAuth, authHeaders } = require('./auth');
        const u = new URL(urlObj.toString());
        appendAuth(u, server);
        resp = await fetchImpl(u.toString(), { headers: authHeaders(server) });
        if (!resp || !resp.ok) {
          lastErr = `HTTP ${resp?.status || 'error'}`;
          continue;
        }
      } else {
        const target = urlObj.toString();
        resp = await apiFetch(server, () => new URL(target), timeoutMs);
      }
      const data = await resp.json();
      return { ok: true, data, error: null };
    } catch (e) {
      lastErr = e.status ? `HTTP ${e.status}` : (e.name === 'AbortError' ? 'timeout' : (e.message || 'failed'));
    }
  }
  return { ok: false, data: null, error: lastErr };
}

async function fetchSessionsList(server, fetchImpl, withActiveFilter) {
  const urls = sessionEndpointUrls(server.url).map((u) => {
    const copy = new URL(u.toString());
    if (withActiveFilter) copy.searchParams.set('ActiveWithinSeconds', '7200');
    return copy;
  });
  return fetchJsonFromPaths(server, urls, fetchImpl);
}

async function fetchUserPlayingItems(server, fetchImpl) {
  if (!server?.userId) return [];
  const result = await fetchJsonFromPaths(server, userPlayingEndpointUrls(server.url, server.userId), fetchImpl);
  if (!result.ok || !result.data) return [];
  const items = result.data.Items || result.data.items || [];
  const withUser = { ...server, _sessionUser: server._sessionUser || server.username || null };
  return items.map((np) => mapPlayingItem(np, withUser, 'user-playing'));
}

function mergeLiveByItem(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      const key = [s.serverUrl || s.server, s.sessionId || s.title, s.user || ''].join('|');
      const prev = map.get(key);
      if (!prev || (prev.source === 'user-playing' && s.source === 'sessions')) {
        map.set(key, s);
      }
    }
  }
  return [...map.values()];
}

async function fetchServerSessionsDetailed(server, fetchImpl) {
  const label = server?.label || server?.url || 'server';
  if (!server || !server.url || !server.apiKey) {
    return { server: label, ok: false, live: [], count: 0, ms: 0, error: 'missing credentials', method: null };
  }
  const normalized = { ...server, url: serverBaseUrl(server.url) };
  const t0 = Date.now();

  let sessionsLive = [];
  let sessionsErr = null;
  let method = null;

  for (const withFilter of [true, false]) {
    const result = await fetchSessionsList(normalized, fetchImpl, withFilter);
    if (result.ok) {
      sessionsLive = parseLiveSessions(result.data, normalized);
      if (sessionsLive.length) {
        method = 'sessions';
        break;
      }
    } else {
      sessionsErr = result.error;
    }
  }

  let live = sessionsLive;
  if (!live.length) {
    const playing = await fetchUserPlayingItems(normalized, fetchImpl);
    if (playing.length) {
      live = playing;
      method = 'user-playing';
    }
  } else {
    live = mergeLiveByItem([sessionsLive]);
  }

  if (live.length) {
    return {
      server: normalized.label || normalized.url,
      ok: true,
      live,
      count: live.length,
      ms: Date.now() - t0,
      error: null,
      method,
    };
  }

  return {
    server: normalized.label || normalized.url,
    ok: !sessionsErr || method === 'user-playing',
    live: [],
    count: 0,
    ms: Date.now() - t0,
    error: sessionsErr || 'no active playback',
    method: null,
  };
}

async function fetchServerSessions(server, fetchImpl) {
  const probe = await fetchServerSessionsDetailed(server, fetchImpl);
  return probe.live;
}

async function fetchLiveForServers(servers, fetchImpl) {
  const probes = await Promise.all((servers || []).map((s) => fetchServerSessionsDetailed(s, fetchImpl)));
  const live = mergeLiveByItem(probes.map((p) => p.live || []));
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
  userPlayingEndpointUrls,
  fetchUserPlayingItems,
  fetchServerSessions,
  fetchServerSessionsDetailed,
  fetchLiveForServers,
  mergeLiveByItem,
  ...livePlayback,
};