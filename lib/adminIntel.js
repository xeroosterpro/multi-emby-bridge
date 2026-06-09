// ─── Admin Data Center: global server inventory + Emby/Jellyfin probes ──────
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { apiFetch, pingServer, getEffectiveApiKey, tokenCache, BROWSER_UA } = require('./auth');
const { fetchServerSessionsDetailed } = require('./sessions');
const { snapshot: systemMetrics } = require('./metrics');
const { timeSeries, serverBreakdown, topContent } = require('./adminStats');
const { recentEvents, aggregateEvents, reauthTimeSeries } = require('./tokenEvents');

const TOKEN_TTL = 12 * 60 * 60 * 1000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_CACHE_FILE = path.join(DATA_DIR, 'token-cache.json');
const PROBE_TIMEOUT = 6000;
const SNAPSHOT_RETENTION_DAYS = 30;

function normUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function serverIntelKey(server) {
  return normUrl(server.url) + '|' + (server.userId || '');
}

function stripSecrets(entry) {
  const o = { ...entry };
  delete o.apiKey;
  delete o.password;
  return o;
}

function readTokenCacheFile() {
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) return JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
  } catch { /* */ }
  return {};
}

function tokenCacheEntries() {
  const file = readTokenCacheFile();
  const out = [];
  const seen = new Set();
  for (const [key, entry] of tokenCache.entries()) {
    seen.add(key);
    const [url, userId] = key.split('|');
    const ageMs = entry.ts ? Date.now() - entry.ts : null;
    out.push({
      key,
      url: url || key,
      userId: userId || '',
      cached: true,
      ageMs,
      ttlRemainingMs: ageMs != null ? Math.max(0, TOKEN_TTL - ageMs) : null,
      expiresAt: entry.ts ? new Date(entry.ts + TOKEN_TTL).toISOString() : null,
    });
  }
  for (const [key, entry] of Object.entries(file)) {
    if (seen.has(key)) continue;
    const [url, userId] = key.split('|');
    const ageMs = entry.ts ? Date.now() - entry.ts : null;
    if (ageMs != null && ageMs >= TOKEN_TTL) continue;
    out.push({
      key,
      url: url || key,
      userId: userId || '',
      cached: true,
      ageMs,
      ttlRemainingMs: ageMs != null ? Math.max(0, TOKEN_TTL - ageMs) : null,
      expiresAt: entry.ts ? new Date(entry.ts + TOKEN_TTL).toISOString() : null,
    });
  }
  return out;
}

async function safeProbe(fn) {
  const t0 = Date.now();
  try {
    const data = await fn();
    return { ok: true, ms: Date.now() - t0, data, error: null };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, data: null, error: e.status ? `HTTP ${e.status}` : (e.message || 'failed') };
  }
}

async function probeServerIntel(server) {
  const s = { ...server, url: normUrl(server.url), _timeout: PROBE_TIMEOUT };
  const probes = {};

  probes.ping = await safeProbe(async () => {
    const ms = await pingServer(s);
    if (ms == null) throw new Error('unreachable');
    return { ms };
  });

  probes.systemInfo = await safeProbe(async () => {
    const resp = await apiFetch(s, () => new URL(`${s.url}/System/Info`), PROBE_TIMEOUT);
    const d = await resp.json();
    return {
      serverName: d.ServerName || d.ProductName || null,
      version: d.Version || null,
      id: d.Id || null,
      operatingSystem: d.OperatingSystemDisplayName || d.OperatingSystem || null,
      startupWizardCompleted: d.StartupWizardCompleted,
    };
  });

  probes.libraryCounts = await safeProbe(async () => {
    const resp = await apiFetch(s, () => {
      const u = new URL(`${s.url}/Items/Counts`);
      u.searchParams.set('UserId', s.userId);
      return u;
    }, PROBE_TIMEOUT);
    const d = await resp.json();
    return { movies: d.MovieCount || 0, shows: d.SeriesCount || 0, episodes: d.EpisodeCount || 0 };
  });

  if (s.userId) {
    probes.userProfile = await safeProbe(async () => {
      const resp = await apiFetch(s, () => new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}`), PROBE_TIMEOUT);
      const d = await resp.json();
      return {
        name: d.Name || null,
        lastActivityDate: d.LastActivityDate || null,
        isAdministrator: !!d.Policy?.IsAdministrator,
      };
    });

    probes.views = await safeProbe(async () => {
      const resp = await apiFetch(s, () => new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}/Views`), PROBE_TIMEOUT);
      const d = await resp.json();
      const items = d.Items || [];
      return { count: items.length, names: items.slice(0, 12).map(v => v.Name) };
    });

    probes.latest = await safeProbe(async () => {
      const resp = await apiFetch(s, () => {
        const u = new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}/Items/Latest`);
        u.searchParams.set('Limit', '5');
        u.searchParams.set('Fields', 'ProviderIds,Name,Type');
        return u;
      }, PROBE_TIMEOUT);
      const d = await resp.json();
      const items = Array.isArray(d) ? d : (d.Items || []);
      return items.map(i => ({ id: i.Id, name: i.Name, type: i.Type, imdb: i.ProviderIds?.Imdb || null }));
    });

    probes.resume = await safeProbe(async () => {
      const resp = await apiFetch(s, () => {
        const u = new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}/Items/Resume`);
        u.searchParams.set('Limit', '5');
        u.searchParams.set('Fields', 'Name,Type,UserData');
        return u;
      }, PROBE_TIMEOUT);
      const d = await resp.json();
      const items = d.Items || [];
      return { count: items.length, items: items.map(i => i.Name) };
    });

    probes.favorites = await safeProbe(async () => {
      const resp = await apiFetch(s, () => {
        const u = new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}/Items`);
        u.searchParams.set('Filters', 'IsFavorite');
        u.searchParams.set('Limit', '5');
        u.searchParams.set('Fields', 'Name,Type');
        return u;
      }, PROBE_TIMEOUT);
      const d = await resp.json();
      const items = d.Items || [];
      return { count: items.length, items: items.map(i => i.Name) };
    });

    probes.playedItems = await safeProbe(async () => {
      const resp = await apiFetch(s, () => {
        const u = new URL(`${s.url}/Users/${encodeURIComponent(s.userId)}/PlayedItems`);
        u.searchParams.set('Limit', '10');
        u.searchParams.set('Fields', 'Name,Type,UserData,ProviderIds');
        return u;
      }, PROBE_TIMEOUT);
      const d = await resp.json();
      const items = d.Items || [];
      return items.map(i => ({
        name: i.Name,
        type: i.Type,
        playedPct: i.UserData?.PlayedPercentage,
        lastPlayed: i.UserData?.LastPlayedDate,
      }));
    });
  }

  const sess = await fetchServerSessionsDetailed(s, null, { timeoutMs: PROBE_TIMEOUT });
  probes.sessions = {
    ok: sess.ok,
    ms: sess.ms,
    error: sess.error,
    data: {
      count: sess.count,
      method: sess.method,
      live: (sess.live || []).slice(0, 5).map(l => ({
        title: l.title, progressPct: l.progressPct, client: l.client, isTranscoding: l.isTranscoding,
      })),
    },
  };

  const latestItem = probes.latest?.ok && probes.latest.data?.[0];
  if (latestItem?.id && s.userId) {
    probes.playbackSample = await safeProbe(async () => {
      const resp = await apiFetch(s, () => {
        const u = new URL(`${s.url}/Items/${latestItem.id}/PlaybackInfo`);
        u.searchParams.set('UserId', s.userId);
        return u;
      }, PROBE_TIMEOUT);
      const d = await resp.json();
      const src = (d.MediaSources || [])[0];
      if (!src) return { note: 'no media sources' };
      const video = (src.MediaStreams || []).find(m => m.Type === 'Video');
      return {
        sampleTitle: latestItem.name,
        size: src.Size,
        bitrate: src.Bitrate,
        container: src.Container,
        video: video ? { codec: video.Codec, width: video.Width, height: video.Height, hdr: video.VideoRangeType } : null,
      };
    });
  }

  const cacheKey = serverIntelKey(s);
  const cacheEntry = tokenCache.get(cacheKey);
  const effectiveKey = getEffectiveApiKey(s);
  const tokenMeta = {
    hasStoredKey: !!s.apiKey,
    hasCachedToken: !!cacheEntry,
    cacheAgeMs: cacheEntry?.ts ? Date.now() - cacheEntry.ts : null,
    ttlRemainingMs: cacheEntry?.ts ? Math.max(0, TOKEN_TTL - (Date.now() - cacheEntry.ts)) : null,
    usingCache: effectiveKey !== s.apiKey,
    hasReauthCredentials: !!(s.username && s.password),
  };

  const up = probes.ping.ok || probes.systemInfo.ok;
  return {
    key: cacheKey,
    probedAt: new Date().toISOString(),
    up,
    probes,
    token: tokenMeta,
  };
}

function getDataDictionary() {
  return {
    version: 1,
    categories: [
      {
        id: 'identity',
        label: 'Server identity',
        fields: [
          { field: 'label', type: 'string', source: 'user_config.servers', sensitive: false },
          { field: 'url', type: 'string', source: 'user_config.servers', sensitive: false },
          { field: 'type', type: 'emby|jellyfin', source: 'user_config.servers', sensitive: false },
          { field: 'ownerUsername', type: 'string', source: 'users.username', sensitive: false },
        ],
      },
      {
        id: 'reachability',
        label: 'Reachability',
        fields: [
          { field: 'probes.ping.ms', type: 'number', source: 'GET /System/Ping', sensitive: false },
          { field: 'probes.systemInfo.version', type: 'string', source: 'GET /System/Info', sensitive: false },
          { field: 'up', type: 'boolean', source: 'derived', sensitive: false, notes: 'ping or systemInfo succeeded' },
        ],
      },
      {
        id: 'library',
        label: 'Library',
        fields: [
          { field: 'probes.libraryCounts.movies', type: 'number', source: 'GET /Items/Counts', sensitive: false },
          { field: 'probes.libraryCounts.shows', type: 'number', source: 'GET /Items/Counts', sensitive: false },
          { field: 'probes.libraryCounts.episodes', type: 'number', source: 'GET /Items/Counts', sensitive: false },
          { field: 'probes.views.names', type: 'string[]', source: 'GET /Users/{id}/Views', sensitive: false },
          { field: 'probes.latest', type: 'array', source: 'GET /Users/{id}/Items/Latest', sensitive: false },
        ],
      },
      {
        id: 'sessions',
        label: 'Live sessions',
        fields: [
          { field: 'probes.sessions.method', type: 'sessions|user-playing|null', source: 'GET /Sessions or Items?IsPlaying', sensitive: false },
          { field: 'probes.sessions.count', type: 'number', source: 'GET /Sessions', sensitive: false, notes: 'Often blocked on reseller hosts' },
        ],
      },
      {
        id: 'tokens',
        label: 'Tokens & auth',
        fields: [
          { field: 'token.cacheAgeMs', type: 'number', source: 'token-cache.json', sensitive: false },
          { field: 'token.ttlRemainingMs', type: 'number', source: 'derived (12h TTL)', sensitive: false },
          { field: 'token.hasReauthCredentials', type: 'boolean', source: 'user_config.servers', sensitive: false },
          { field: 'reauthEvents', type: 'array', source: 'token_events table', sensitive: false },
        ],
      },
      {
        id: 'activity',
        label: 'Bridge activity',
        fields: [
          { field: 'requests24h', type: 'number', source: 'request_log', sensitive: false },
          { field: 'successRate', type: 'percent', source: 'request_log', sensitive: false },
          { field: 'avgResponseMs', type: 'number', source: 'request_log.response_ms', sensitive: false },
        ],
      },
      {
        id: 'health',
        label: 'Health probes',
        fields: [
          { field: 'uptimePct7d', type: 'percent', source: 'server_uptime_daily', sensitive: false },
          { field: 'avgMs', type: 'number', source: 'server_health_log', sensitive: false },
        ],
      },
      {
        id: 'bridge',
        label: 'Bridge host',
        fields: [
          { field: 'cpuPercent', type: 'number', source: 'lib/metrics.js', sensitive: false },
          { field: 'sysMemPct', type: 'number', source: 'lib/metrics.js', sensitive: false },
          { field: 'rssBytes', type: 'number', source: 'process.memoryUsage', sensitive: false },
        ],
      },
      {
        id: 'unavailable',
        label: 'Requires admin token (documented N/A)',
        fields: [
          { field: 'allUsers', type: 'n/a', source: 'GET /Users', sensitive: true, notes: 'User token cannot list all users' },
          { field: 'activityLog', type: 'n/a', source: 'GET /ActivityLog', sensitive: true },
          { field: 'plugins', type: 'n/a', source: 'GET /Plugins', sensitive: false },
          { field: 'liveTv', type: 'n/a', source: 'GET /LiveTv/*', sensitive: false, notes: 'Only when Live TV configured' },
          { field: 'filePath', type: 'restricted', source: 'Items.Path', sensitive: true, notes: 'Not exposed in admin UI' },
        ],
      },
    ],
  };
}

function makeAdminIntel(deps = {}) {
  const userConfig = deps.userConfig;
  const requestLog = deps.requestLog;
  const getRequestLog = deps.getRequestLog || (() => []);

  let _lastSnapshotAt = null;
  let _refreshInFlight = null;

  async function buildInventory() {
    if (!db.isConfigured() || !userConfig) return [];
    const q = await db.query(
      `SELECT u.id, u.username FROM users u
        JOIN user_config uc ON uc.user_id = u.id
       WHERE jsonb_array_length(uc.config_json->'servers') > 0`);
    const entries = [];
    for (const row of q.rows) {
      let cfg;
      try { cfg = await userConfig.getForServe(row.id); } catch { continue; }
      for (const s of (cfg?.servers || [])) {
        if (!s?.url || !s?.apiKey || !s?.userId) continue;
        entries.push(stripSecrets({
          key: serverIntelKey(s),
          bridgeUserId: row.id,
          ownerUsername: row.username,
          label: s.label || '',
          url: normUrl(s.url),
          type: s.type || 'emby',
          embyUserId: s.userId,
          enabled: s.enabled !== false,
          hasReauthCredentials: !!(s.username && s.password),
          username: s.username || null,
          _server: s,
        }));
      }
    }
    return entries;
  }

  async function saveSnapshot(entry, payload) {
    if (!db.isConfigured()) return;
    await db.query(
      `INSERT INTO intel_snapshots(server_key, user_id, server_url, label, payload, probed_at)
       VALUES($1,$2,$3,$4,$5,now())`,
      [entry.key, entry.bridgeUserId, entry.url, entry.label, JSON.stringify(payload)]
    );
  }

  async function getLatestSnapshots() {
    if (!db.isConfigured()) return new Map();
    try {
      const q = await db.query(`
        SELECT DISTINCT ON (server_key) server_key, payload, probed_at
          FROM intel_snapshots
         ORDER BY server_key, probed_at DESC`);
      const m = new Map();
      for (const r of q.rows) m.set(r.server_key, { payload: r.payload, probedAt: r.probed_at });
      return m;
    } catch {
      return new Map();
    }
  }

  async function runSnapshotCycle() {
    const inventory = await buildInventory();
    const limit = 4;
    let i = 0;
    async function worker(batch) {
      await Promise.all(batch.map(async (entry) => {
        try {
          const payload = await probeServerIntel(entry._server);
          await saveSnapshot(entry, payload);
        } catch (e) {
          console.error('[adminIntel/probe]', entry.label || entry.url, e.message);
        }
      }));
    }
    while (i < inventory.length) {
      await worker(inventory.slice(i, i + limit));
      i += limit;
    }
    _lastSnapshotAt = new Date().toISOString();
    await pruneSnapshots();
    return { probed: inventory.length, at: _lastSnapshotAt };
  }

  async function pruneSnapshots() {
    if (!db.isConfigured()) return;
    try {
      await db.query(
        `DELETE FROM intel_snapshots WHERE probed_at < now() - ($1::int || ' days')::interval`,
        [SNAPSHOT_RETENTION_DAYS]);
      await db.query(
        `DELETE FROM token_events WHERE created_at < now() - interval '90 days'`);
      await db.query(
        `DELETE FROM bridge_metrics WHERE sampled_at < now() - interval '7 days'`);
    } catch { /* */ }
  }

  async function saveBridgeMetric() {
    if (!db.isConfigured()) return;
    const m = systemMetrics();
    try {
      await db.query(
        `INSERT INTO bridge_metrics(cpu_percent, sys_mem_pct, rss_bytes, heap_used_bytes, load_avg1, uptime_sec)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [m.cpuPercent, m.sysMemPct, m.rssBytes, m.heapUsedBytes, m.loadAvg1, m.uptimeSec]);
    } catch (e) { console.error('[adminIntel/bridgeMetric]', e.message); }
  }

  async function getServerUsageStats() {
    if (!db.isConfigured()) return { byKey: {}, byLabel: {} };
    try {
      const q = await db.query(`
        SELECT best_server, COUNT(*)::int AS n,
               COUNT(*) FILTER (WHERE found)::int AS found_n,
               ROUND(AVG(response_ms))::int AS avg_ms
          FROM request_log
         WHERE ts > now() - interval '7 days' AND best_server IS NOT NULL
         GROUP BY best_server`);
      const byLabel = {};
      for (const r of q.rows) {
        byLabel[r.best_server] = { requests7d: r.n, found7d: r.found_n, avgMs: r.avg_ms };
      }
      return { byLabel };
    } catch {
      return { byLabel: {} };
    }
  }

  async function getHealthRollup() {
    if (!db.isConfigured()) return { servers: [], series: [] };
    try {
      const daily = await db.query(`
        SELECT server_url, label,
               SUM(checks)::int AS checks,
               SUM(up_checks)::int AS up_checks,
               ROUND(AVG(avg_ms))::int AS avg_ms
          FROM server_uptime_daily
         WHERE day > CURRENT_DATE - 30
         GROUP BY server_url, label
         ORDER BY checks DESC`);
      const servers = daily.rows.map(r => ({
        url: r.server_url,
        label: r.label,
        uptimePct: r.checks ? Math.round((r.up_checks / r.checks) * 100) : null,
        avgMs: r.avg_ms,
        checks: r.checks,
      }));
      const series = await db.query(`
        SELECT day::text AS label,
               SUM(checks)::int AS checks,
               SUM(up_checks)::int AS up_checks
          FROM server_uptime_daily
         WHERE day > CURRENT_DATE - 30
         GROUP BY day ORDER BY day`);
      return { servers, series: series.rows };
    } catch {
      return { servers: [], series: [] };
    }
  }

  async function getOverview() {
    const snapshots = await getLatestSnapshots();
    const inventory = await buildInventory();
    const tokenAgg = await aggregateEvents();
    const usage = await getServerUsageStats();
    let platform = {};
    if (db.isConfigured()) {
      const u = await db.query('SELECT COUNT(*)::int AS total FROM users');
      const r24 = await db.query(`SELECT COUNT(*)::int AS n FROM request_log WHERE ts > now() - interval '24 hours'`);
      const found24 = await db.query(`SELECT COUNT(*)::int AS n FROM request_log WHERE ts > now() - interval '24 hours' AND found`);
      const avgMs = await db.query(`SELECT ROUND(AVG(response_ms))::int AS avg FROM request_log WHERE ts > now() - interval '24 hours' AND response_ms IS NOT NULL`);
      platform = {
        users: u.rows[0]?.total || 0,
        requests24h: r24.rows[0]?.n || 0,
        successRate: r24.rows[0]?.n ? Math.round((found24.rows[0]?.n / r24.rows[0]?.n) * 100) : null,
        avgResponseMs: avgMs.rows[0]?.avg ?? null,
      };
    }
    const down = [];
    const authIssues = [];
    for (const e of inventory) {
      const snap = snapshots.get(e.key);
      if (snap && snap.payload && snap.payload.up === false) down.push({ key: e.key, label: e.label, url: e.url });
      if (!e.hasReauthCredentials) authIssues.push({ key: e.key, label: e.label });
    }
    const alerts = [];
    if (down.length) alerts.push({ level: 'error', text: `${down.length} server(s) down or unreachable`, tab: 'servers' });
    if (tokenAgg.fail24h) alerts.push({ level: 'warn', text: `${tokenAgg.fail24h} re-auth failure(s) in 24h`, tab: 'tokens' });
    if (authIssues.length) alerts.push({ level: 'info', text: `${authIssues.length} server(s) missing saved credentials for auto re-auth`, tab: 'tokens' });
    return {
      snapshotAt: _lastSnapshotAt,
      snapshotCount: snapshots.size,
      serverCount: inventory.length,
      tokenCacheCount: tokenCacheEntries().length,
      tokenEvents: tokenAgg,
      platform,
      usage: usage.byLabel,
      alerts,
      downCount: down.length,
    };
  }

  async function getServers() {
    const inventory = await buildInventory();
    const snapshots = await getLatestSnapshots();
    const usage = await getServerUsageStats();
    return inventory.map(e => {
      const snap = snapshots.get(e.key);
      const p = snap?.payload || {};
      const lib = p.probes?.libraryCounts?.data;
      const usageRow = usage.byLabel[e.label] || {};
      return {
        ...e,
        probedAt: snap?.probedAt || p.probedAt || null,
        up: p.up,
        pingMs: p.probes?.ping?.data?.ms ?? null,
        version: p.probes?.systemInfo?.data?.version ?? null,
        movies: lib?.movies ?? null,
        shows: lib?.shows ?? null,
        sessions: p.probes?.sessions?.data?.count ?? 0,
        sessionMethod: p.probes?.sessions?.data?.method ?? null,
        tokenTtlMs: p.token?.ttlRemainingMs ?? null,
        requests7d: usageRow.requests7d || 0,
        avgMs: usageRow.avgMs ?? null,
      };
    });
  }

  async function getServerDetail(key) {
    const inventory = await buildInventory();
    const entry = inventory.find(e => e.key === key);
    if (!entry) return null;
    const snapshots = await getLatestSnapshots();
    const snap = snapshots.get(key);
    let payload = snap?.payload;
    if (!payload) {
      payload = await probeServerIntel(entry._server);
      await saveSnapshot(entry, payload);
    }
    const hist = db.isConfigured() ? await db.query(
      `SELECT probed_at, (payload->>'up')::boolean AS up FROM intel_snapshots
        WHERE server_key=$1 AND probed_at > now() - interval '7 days'
        ORDER BY probed_at ASC LIMIT 200`, [key]) : { rows: [] };
    return {
      entry: stripSecrets(entry),
      payload,
      history: hist.rows.map(r => ({ at: r.probed_at, up: r.up })),
    };
  }

  async function getTokensIntel() {
    const cache = tokenCacheEntries();
    const events = await recentEvents(80);
    const agg = await aggregateEvents();
    const series = await reauthTimeSeries(7);
    const inventory = await buildInventory();
    const missingCreds = inventory.filter(e => !e.hasReauthCredentials).map(stripSecrets);
    return { cache, events, aggregate: agg, series, missingCreds };
  }

  async function getActivityIntel(range = '7d') {
    const days = range === '24h' ? 1 : 7;
    let logRows = [];
    if (db.isConfigured() && requestLog) {
      try {
        const q = await db.query(
          `SELECT ts, content_name, type, season, episode, best_server, found, response_ms, user_id
             FROM request_log WHERE ts > now() - ($1::int || ' days')::interval ORDER BY ts DESC LIMIT 8000`,
          [days]);
        logRows = q.rows.map(r => ({
          ts: r.ts, contentName: r.content_name, type: r.type, season: r.season, episode: r.episode,
          bestServer: r.best_server, found: r.found, ms: r.response_ms, userId: r.user_id,
        }));
      } catch { /* */ }
    }
    if (!logRows.length) {
      logRows = getRequestLog().map(e => ({
        ts: e.ts, contentName: e.contentName, type: e.type, bestServer: e.bestServer,
        found: e.found, ms: e.ms, userId: e.userId,
      }));
    }
    const windowMs = days === 1 ? 86400000 : 7 * 86400000;
    const latencyBuckets = new Map();
    for (const e of logRows) {
      if (e.ms == null) continue;
      const key = new Date(e.ts).toISOString().slice(0, days === 1 ? 13 : 10);
      if (!latencyBuckets.has(key)) latencyBuckets.set(key, { label: key, sum: 0, n: 0 });
      const b = latencyBuckets.get(key);
      b.sum += e.ms;
      b.n++;
    }
    const latencySeries = [...latencyBuckets.values()]
      .map(b => ({ label: b.label, avgMs: Math.round(b.sum / b.n) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      requests: timeSeries(logRows, { days, hourly: days === 1 }),
      servers: serverBreakdown(logRows, { windowMs }),
      topContent: topContent(logRows, { windowMs, limit: 12 }),
      latencySeries,
      total: logRows.length,
    };
  }

  async function getBridgeIntel(range = '24h') {
    const hours = range === '7d' ? 168 : 24;
    let series = [];
    if (db.isConfigured()) {
      try {
        const q = await db.query(`
          SELECT sampled_at, cpu_percent, sys_mem_pct, rss_bytes, heap_used_bytes, load_avg1, uptime_sec
            FROM bridge_metrics
           WHERE sampled_at > now() - ($1::int || ' hours')::interval
           ORDER BY sampled_at ASC`, [hours]);
        series = q.rows.map(r => ({
          at: r.sampled_at,
          cpu: r.cpu_percent,
          ram: r.sys_mem_pct,
          rss: Number(r.rss_bytes),
          heap: Number(r.heap_used_bytes),
          load: Number(r.load_avg1),
          uptime: r.uptime_sec,
        }));
      } catch { /* */ }
    }
    return { current: systemMetrics(), series };
  }

  function triggerRefresh() {
    if (_refreshInFlight) return _refreshInFlight;
    _refreshInFlight = runSnapshotCycle().finally(() => { _refreshInFlight = null; });
    return _refreshInFlight;
  }

  return {
    buildInventory,
    probeServerIntel,
    runSnapshotCycle,
    saveBridgeMetric,
    pruneSnapshots,
    getOverview,
    getServers,
    getServerDetail,
    getTokensIntel,
    getActivityIntel,
    getHealthRollup,
    getBridgeIntel,
    getDataDictionary,
    triggerRefresh,
    getLastSnapshotAt: () => _lastSnapshotAt,
  };
}

module.exports = {
  makeAdminIntel,
  serverIntelKey,
  normUrl,
  probeServerIntel,
  getDataDictionary,
  tokenCacheEntries,
  TOKEN_TTL,
};