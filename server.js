const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// ─── Modules ─────────────────────────────────────────────────────────────────
const { parseStreamId } = require('./lib/utils');
const { fetchWithTimeout, authHeaders, appendAuth, apiFetch, pingServer, buildStreamUrl, getEffectiveApiKey } = require('./lib/auth');
const { resolveImdbName, queryServerForMovie, queryServerForEpisode, searchServersForCatalog, getRecentlyAdded } = require('./lib/search');
const { getAllStreams } = require('./lib/streams');
const { fetchExternalCatalog } = require('./lib/catalogs');
const { healthServers, healthHistory, registerHealthServers, unregisterHealthServer, cleanupStaleServers, pingHealthServers } = require('./lib/health');
const { hashPassword, loadProfiles, saveProfiles } = require('./lib/profiles');

const app = express();
const PORT = process.env.PORT || 7000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ─── Simple rate limiter (no extra dependency) ───────────────────────────────
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  // Cleanup every windowMs
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(ip);
    }
  }, windowMs);

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || (now - entry.start) > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Rate limiters for different endpoint groups
const apiLimiter = createRateLimiter(60 * 1000, 60);     // 60 req/min for API endpoints
const streamLimiter = createRateLimiter(60 * 1000, 120);  // 120 req/min for stream endpoints
const authLimiter = createRateLimiter(60 * 1000, 10);     // 10 req/min for auth endpoints

// ─── Request log (persisted to disk, capped at 50) ──────────────────────────
const REQUEST_LOG_FILE = path.join(DATA_DIR, 'request-log.json');
const MAX_LOG = 50;
let REQUEST_LOG = [];

function loadRequestLog() {
  try {
    if (fs.existsSync(REQUEST_LOG_FILE)) {
      REQUEST_LOG = JSON.parse(fs.readFileSync(REQUEST_LOG_FILE, 'utf8'));
      if (REQUEST_LOG.length > MAX_LOG) REQUEST_LOG = REQUEST_LOG.slice(0, MAX_LOG);
    }
  } catch { REQUEST_LOG = []; }
}

function saveRequestLog() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(REQUEST_LOG_FILE, JSON.stringify(REQUEST_LOG, null, 2), 'utf8');
  } catch { /* non-critical */ }
}

function addLogEntry(entry) {
  REQUEST_LOG.unshift(entry);
  if (REQUEST_LOG.length > MAX_LOG) REQUEST_LOG.pop();
  saveRequestLog();
}

loadRequestLog();

// ─── Config encode/decode ─────────────────────────────────────────────────────

function decodeConfig(encoded) {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

// ─── CORS (required by Stremio) ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Server info (ping origin label) ─────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  const region = process.env.RAILWAY_REGION || process.env.FLY_REGION || null;
  const service = process.env.RAILWAY_SERVICE_NAME || null;
  res.json({
    region:  region  || null,
    service: service || null,
    host:    req.hostname || null,
  });
});

// ─── Server health dashboard ──────────────────────────────────────────────────
app.get('/servers', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'servers.html'));
});
app.get('/:config/servers', (req, res) => {
  res.redirect(`/servers?cfg=${encodeURIComponent(req.params.config)}`);
});

// Register servers for 24/7 health monitoring
app.post('/api/health/register', apiLimiter, express.json(), (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers must be array' });
  registerHealthServers(servers);
  res.json({ ok: true, monitoring: healthServers.length });
});

// Unregister a server from health monitoring
app.post('/api/health/unregister', apiLimiter, express.json(), (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const removed = unregisterHealthServer(url);
  res.json({ ok: true, removed, monitoring: healthServers.length });
});

// Cleanup stale servers not in the active list
app.post('/api/health/cleanup', apiLimiter, express.json(), (req, res) => {
  const { activeUrls } = req.body || {};
  if (!Array.isArray(activeUrls)) return res.status(400).json({ error: 'activeUrls must be array' });
  const removed = cleanupStaleServers(activeUrls);
  res.json({ ok: true, removed, monitoring: healthServers.length });
});

// Return full history for all monitored servers
app.get('/api/health/history', (req, res) => {
  const result = healthServers.map(s => ({
    url:     s.url,
    label:   s.label,
    type:    s.type,
    history: (healthHistory[s.url] || []),
  }));
  res.json(result);
});

// Trigger an immediate ping of all registered servers
app.post('/api/health/ping-now', apiLimiter, async (req, res) => {
  await pingHealthServers();
  const result = healthServers.map(s => ({
    url:    s.url,
    label:  s.label,
    latest: (healthHistory[s.url] || [])[0] || null,
  }));
  res.json(result);
});

// ─── Request log routes ───────────────────────────────────────────────────────
app.get('/api/request-log', (req, res) => {
  res.json(REQUEST_LOG);
});
app.post('/api/clear-request-log', apiLimiter, (req, res) => {
  REQUEST_LOG.length = 0;
  saveRequestLog();
  res.json({ ok: true });
});

// ─── Profile: save ────────────────────────────────────────────────────────────
app.post('/api/profile/save', authLimiter, express.json(), (req, res) => {
  const { username, password, config } = req.body || {};
  if (!username || !password || !config) {
    return res.status(400).json({ error: 'username, password and config are required.' });
  }
  if (!/^[a-zA-Z0-9_\-. ]{1,40}$/.test(username)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, spaces, _ - . (max 40 chars).' });
  }

  const profiles = loadProfiles();
  const existing = profiles[username.toLowerCase()];

  if (existing) {
    const attempt = hashPassword(password, existing.salt);
    if (attempt !== existing.passwordHash) {
      return res.status(401).json({ error: 'Wrong password for that profile name.' });
    }
    existing.config = config;
    existing.updatedAt = new Date().toISOString();
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    profiles[username.toLowerCase()] = {
      displayName: username,
      salt,
      passwordHash: hashPassword(password, salt),
      config,
      updatedAt: new Date().toISOString(),
    };
  }

  const persisted = saveProfiles(profiles);
  res.json({
    ok: true,
    message: persisted
      ? 'Profile saved.'
      : 'Profile saved in memory (will persist until server restarts).',
  });
});

// ─── Profile: load ────────────────────────────────────────────────────────────
app.post('/api/profile/load', authLimiter, express.json(), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }

  const profiles = loadProfiles();
  const profile = profiles[username.toLowerCase()];
  if (!profile) {
    return res.status(404).json({ error: 'No profile found with that name.' });
  }

  const attempt = hashPassword(password, profile.salt);
  if (attempt !== profile.passwordHash) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  res.json({ config: profile.config, updatedAt: profile.updatedAt });
});

// ─── Credential helper ────────────────────────────────────────────────────────
app.post('/api/fetch-credentials', authLimiter, express.json(), async (req, res) => {
  const { url, username, password } = req.body || {};
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username and password are required.' });
  }

  const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-setup", Version="1.0.0"';
  const authUrl = `${url.replace(/\/$/, '')}/Users/AuthenticateByName`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': authHeader,
          'Authorization': authHeader,
        },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 401 || resp.status === 403) {
      return res.status(401).json({ error: 'Authentication failed — wrong username or password.' });
    }
    if (!resp.ok) {
      return res.status(502).json({ error: `Server returned HTTP ${resp.status}. Check the URL.` });
    }

    const data = await resp.json();
    if (!data.AccessToken || !data.User?.Id) {
      return res.status(502).json({ error: 'Unexpected response — check your URL and credentials.' });
    }
    res.json({ apiKey: data.AccessToken, userId: data.User.Id });
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Connection timed out. Check the server URL.'
      : `Could not reach server: ${err.message}`;
    res.status(504).json({ error: msg });
  }
});

// ─── Test connection ──────────────────────────────────────────────────────────
app.post('/api/test-connection', apiLimiter, express.json(), async (req, res) => {
  const { url, type, apiKey, userId } = req.body || {};
  if (!url || !apiKey || !userId) {
    return res.status(400).json({ error: 'url, apiKey and userId are required.' });
  }
  const server = { url: url.replace(/\/$/, ''), type: type || 'emby', apiKey, userId };
  try {
    const infoUrl = new URL(`${server.url}/System/Info`);
    appendAuth(infoUrl, server);
    const resp = await fetchWithTimeout(infoUrl.toString(), 8000, { headers: authHeaders(server) });
    const data = await resp.json();
    const name    = data.ServerName || data.ProductName || (type === 'jellyfin' ? 'Jellyfin' : 'Emby');
    const version = data.Version ? ` v${data.Version}` : '';
    res.json({ ok: true, message: `Connected — ${name}${version}` });
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.status(401).json({ ok: false, error: 'Authentication failed — check your API key.' });
    if (err.name === 'AbortError')
      return res.status(504).json({ ok: false, error: 'Connection timed out — check the server URL.' });
    res.status(502).json({ ok: false, error: `Could not connect: ${err.message}` });
  }
});

// ─── Ping servers ─────────────────────────────────────────────────────────────
app.post('/api/ping-servers', apiLimiter, express.json(), async (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers array required' });
  const results = await Promise.all(servers.map(async s => {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try { await fetch(`${s.url}/System/Ping`, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
      return { label: s.label, ms: Date.now() - t0 };
    } catch {
      return { label: s.label, ms: null };
    }
  }));
  res.json({ results });
});

// ─── Library stats ────────────────────────────────────────────────────────────
app.post('/api/library-stats', apiLimiter, express.json(), async (req, res) => {
  const { url, type, apiKey, userId } = req.body || {};
  if (!url || !apiKey || !userId) {
    return res.status(400).json({ error: 'url, apiKey, userId required' });
  }
  const server = { url: url.replace(/\/$/, ''), type: type || 'emby', apiKey, userId, label: '' };
  try {
    const statsUrl = new URL(`${server.url}/Items/Counts`);
    statsUrl.searchParams.set('UserId', userId);
    appendAuth(statsUrl, server);
    const resp = await fetchWithTimeout(statsUrl.toString(), 8000, { headers: authHeaders(server) });
    const data = await resp.json();
    res.json({
      movies:   data.MovieCount   || 0,
      shows:    data.SeriesCount  || 0,
      episodes: data.EpisodeCount || 0,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.status(401).json({ error: 'Authentication failed' });
    if (err.name === 'AbortError')
      return res.status(504).json({ error: 'Connection timed out' });
    res.status(502).json({ error: err.message });
  }
});

// ─── Manifest ─────────────────────────────────────────────────────────────────
app.get('/:config/manifest.json', (req, res) => {
  let cfg;
  try {
    cfg = decodeConfig(req.params.config);
  } catch {
    return res.status(400).json({ error: 'Invalid config' });
  }

  const names = (cfg.servers || []).map((s) => s.label).join(', ');

  const extCats = [];
  (cfg.externalCatalogs || []).filter(c => c.enabled !== false).forEach((c, i) => {
    const types = c.mediaType === 'both' ? ['movie', 'series'] : [c.mediaType || 'movie'];
    types.forEach(t => extCats.push({ type: t, id: 'extcat-' + i, name: c.name || c.provider, extra: [] }));
  });
  res.json({
    id: 'com.multiemby.bridge',
    version: '1.0.0',
    name: 'Multi-Emby Bridge',
    description: `Streams from: ${names || 'configured servers'}`,
    types: ['movie', 'series'],
    catalogs: [
      { type: 'movie',  id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: cfg.showCatalog === false }] },
      { type: 'series', id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: cfg.showCatalog === false }] },
      ...extCats,
    ],
    resources: ['catalog', 'stream'],
    idPrefixes: ['tt'],
    behaviorHints: { configurable: true, configurationRequired: false },
  });
});

// Clicking the gear icon in Stremio opens the addon base URL in a browser
app.get('/:config/configure', (req, res) => {
  res.redirect('/configure');
});

// ─── Catalog handler ──────────────────────────────────────────────────────────
app.get('/:config/catalog/:type/:id/:extra.json', streamLimiter, async (req, res) => {
  const extraStr = decodeURIComponent(req.params.extra || '');
  const searchMatch = extraStr.match(/^search=(.+)$/);
  const query = searchMatch ? searchMatch[1].trim() : null;

  let cfg;
  try { cfg = decodeConfig(req.params.config); } catch { return res.json({ metas: [] }); }

  const { type } = req.params;
  if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });

  const servers = (cfg.servers || []).filter(s => s.url && s.apiKey && s.userId);
  if (servers.length === 0) return res.json({ metas: [] });

  // External catalog intercept
  if (req.params.id && req.params.id.startsWith('extcat-')) {
    const idx = parseInt(req.params.id.replace('extcat-', ''), 10);
    const extList = (cfg.externalCatalogs || []).filter(c => c.enabled !== false);
    const entry = extList[idx];
    if (!entry) return res.json({ metas: [] });
    try {
      const metas = await fetchExternalCatalog(entry, cfg.rpdbKey || null, cfg.traktClientId || process.env.TRAKT_CLIENT_ID || null, cfg.catalogLang || null);
      return res.json({ metas });
    } catch (err) {
      console.error('External catalog error:', err.message);
      return res.json({ metas: [] });
    }
  }
  try {
    if (query) {
      // Search catalog — always runs regardless of showCatalog setting
      const metas = await searchServersForCatalog(servers, type, query);
      res.json({ metas });
    } else {
      // Browse catalog (home page row)
      const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, cfg.catalogContent || 'recent', cfg.catalogLang || null);
      res.json({ metas });
    }
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.json({ metas: [] });
  }
});

// Route without extras — recently added feed
app.get('/:config/catalog/:type/:id.json', streamLimiter, async (req, res) => {
  let cfg;
  try { cfg = decodeConfig(req.params.config); } catch { return res.json({ metas: [] }); }

  const { type } = req.params;
  if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });

  const servers = (cfg.servers || []).filter(s => s.url && s.apiKey && s.userId);
  if (servers.length === 0) return res.json({ metas: [] });

  // External catalog intercept
  if (req.params.id && req.params.id.startsWith('extcat-')) {
    const idx = parseInt(req.params.id.replace('extcat-', ''), 10);
    const extList = (cfg.externalCatalogs || []).filter(c => c.enabled !== false);
    const entry = extList[idx];
    if (!entry) return res.json({ metas: [] });
    try {
      const metas = await fetchExternalCatalog(entry, cfg.rpdbKey || null, cfg.traktClientId || process.env.TRAKT_CLIENT_ID || null, cfg.catalogLang || null);
      return res.json({ metas });
    } catch (err) {
      console.error('External catalog error:', err.message);
      return res.json({ metas: [] });
    }
  }
  try {
    const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, cfg.catalogContent || 'recent', cfg.catalogLang || null);
    res.json({ metas });
  } catch (err) {
    console.error('Catalog browse error:', err.message);
    res.json({ metas: [] });
  }
});

// ─── Stream handler ───────────────────────────────────────────────────────────
app.get('/:config/stream/:type/:id.json', streamLimiter, async (req, res) => {
  let cfg;
  try {
    cfg = decodeConfig(req.params.config);
  } catch {
    return res.json({ streams: [] });
  }

  const { type, id } = req.params;
  const { imdbId, season, episode } = parseStreamId(type, id);

  if (!imdbId || !imdbId.startsWith('tt')) {
    return res.json({ streams: [] });
  }

  const timeoutMs = (cfg.timeout && cfg.timeout >= 2000 && cfg.timeout <= 10000) ? cfg.timeout : 10000;
  const servers = (cfg.servers || [])
    .filter(s => s.url && s.apiKey && s.userId)
    .map(s => ({ ...s, _timeout: timeoutMs }));

  if (servers.length === 0) {
    return res.json({ streams: [] });
  }

  const _t0 = Date.now();
  try {
    const { streams, meta } = await getAllStreams(servers, type, imdbId, season, episode, {
      sortOrder:   cfg.sortOrder,
      excludeRes:  cfg.excludeRes,
      recommend:   cfg.recommend,
      ping:        cfg.ping,
      audioLang:   cfg.audioLang,
      maxBitrate:  cfg.maxBitrate,
      prefCodec:   cfg.prefCodec,
      codecMode:   cfg.codecMode,
      labelPreset:  cfg.labelPreset,
      pingDetail:   cfg.pingDetail,
      autoSelect:   cfg.autoSelect,
      qualityBadge: cfg.qualityBadge === true ? 'emoji'  : (cfg.qualityBadge || null),
      flagEmoji:    cfg.flagEmoji    === true ? 'flag'   : (cfg.flagEmoji    || null),
      bitrateBar:   cfg.bitrateBar   === true ? 'blocks' : (cfg.bitrateBar   || null),
      subsStyle:    cfg.hideSubs     === true ? 'hidden' : (cfg.subsStyle    || 'full'),
      customNameFields: cfg.customNameFields || [],
      customDescFields: cfg.customDescFields || [],
    });

    // ── Results summary card (optional — pinned to top of stream list) ──────────
    if (cfg.showSummary) {
      const found = meta.serverStatus.filter(s => s.status === 'found');
      const total = found.reduce((n, s) => n + (s.count || 0), 0);
      const style = cfg.summaryStyle || 'compact';
      const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '…' : str;
      const eLabel = (s, maxLen) => {
        const prefix = s.emoji ? s.emoji + ' ' : '';
        return prefix + trunc(s.label, maxLen - prefix.length);
      };

      let summaryName, lines;

      if (style === 'detailed') {
        summaryName = `📊 ${total} streams · ${found.length} found`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
            return `✅ ${l} — ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `❌ ${l} — none`;
          if (s.status === 'timeout')   return `⏱ ${l} — timeout`;
          return                               `🔴 ${l} — offline`;
        });

      } else if (style === 'minimal') {
        summaryName = `${total} streams · ${found.length} servers`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ` (${s.resLabels[0]})` : '';
            return `${l}: ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `${l}: —`;
          if (s.status === 'timeout')   return `${l}: timeout`;
          return                               `${l}: offline`;
        });

      } else if (style === 'bar') {
        summaryName = `📊 Results · ${total} streams`;
        const maxCount = Math.max(...found.map(s => s.count), 1);
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 10);
          if (s.status === 'found') {
            const filled = Math.max(1, Math.round((s.count / maxCount) * 4));
            const bar = '█'.repeat(filled) + '░'.repeat(4 - filled);
            return `${l} ${bar} ${s.count}`;
          }
          if (s.status === 'not_found') return `${l} ░░░░ ✗`;
          if (s.status === 'timeout')   return `${l} ⏱`;
          return                               `${l} 🔴`;
        });

      } else {
        // compact (default)
        summaryName = `📊 ${total} streams · ${found.length} servers`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
            return `✅ ${l} · ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `❌ ${l}`;
          if (s.status === 'timeout')   return `⏱ ${l}`;
          return                               `🔴 ${l}`;
        });
      }

      streams.unshift({
        name:        total > 0 ? summaryName : `📊 No streams found`,
        description: lines.join('\n'),
        url:         `${req.protocol}://${req.get('host')}/stream-summary`,
      });
    }

    addLogEntry({
      ts:           new Date().toISOString(),
      type,
      imdbId,
      season:       season  || null,
      episode:      episode || null,
      contentName:  meta.contentName,
      bestServer:   meta.bestServer,
      serverStatus: meta.serverStatus,
      found:        (meta.serverStatus || []).some(s => s.status === 'found'),
      ms:           Date.now() - _t0,
    });
    res.json({ streams });
  } catch (err) {
    console.error('Stream handler error:', err);
    res.status(500).json({ streams: [], error: 'Internal server error' });
  }
});

// ─── JSON error handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Multi-Emby Bridge running → http://localhost:${PORT}/configure`);
});
