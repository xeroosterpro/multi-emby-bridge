const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// ─── Global error handlers — log then EXIT so Railway can restart cleanly ────
// After an uncaughtException the Node process is in an undefined/corrupted state.
// Keeping it alive (no exit) causes Railway's health check to see a zombie: the
// port still responds but the app is broken, so Railway never triggers a restart.
// Always exit(1) so Railway immediately restarts into a clean process.
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught Exception — exiting for clean restart:');
  console.error('[fatal] message:', err && err.message);
  console.error('[fatal] stack:', err && err.stack);
  // Delay 1s so Railway flushes logs before the process dies
  setTimeout(() => process.exit(1), 1000).unref();
});
process.on('unhandledRejection', (reason, promise) => {
  const msg   = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack   : '(no stack)';
  console.error('[fatal] Unhandled Promise Rejection — exiting for clean restart:');
  console.error('[fatal] reason:', msg);
  console.error('[fatal] stack:', stack);
  console.error('[fatal] promise:', promise);
  // Delay 1s so Railway flushes logs before the process dies
  setTimeout(() => process.exit(1), 1000).unref();
});

// ─── Modules ─────────────────────────────────────────────────────────────────
const { parseStreamId } = require('./lib/utils');
const { fetchWithTimeout, authHeaders, appendAuth, apiFetch, pingServer, buildStreamUrl, getEffectiveApiKey, BROWSER_UA } = require('./lib/auth');
const { resolveImdbName, queryServerForMovie, queryServerForEpisode, searchServersForCatalog, getRecentlyAdded } = require('./lib/search');
const { getAllStreams } = require('./lib/streams');
const { upgradeStreamProfile } = require('./lib/streamDefaults');
const { fetchExternalCatalog } = require('./lib/catalogs');
const { healthServers, healthHistory, registerHealthServers, unregisterHealthServer, cleanupStaleServers, pingHealthServers } = require('./lib/health');
const { makeUserConfig } = require('./lib/userConfig');
const { hashPassword, loadProfiles, saveProfiles } = require('./lib/profiles');
const { snapshot: systemMetrics } = require('./lib/metrics');
const { ROW_NAMES, deriveLibraryRows } = require('./server-helpers');
const audioRanking = require('./lib/audioRanking');
const { assertSafeFetchUrl, normalizeServerUrl } = require('./lib/urlSafety');
const { findServerEntry } = require('./lib/serverMatch');
const { fetchLibraryCounts, libraryStatsPayload } = require('./lib/libraryStats');
const {
  requireAuthInProduction,
  applyConfigureSecurityHeaders,
  logStartupSecurityWarnings,
} = require('./lib/security');

// Cross-row deduplication cache (60s TTL per config)
const _dedupCache = new Map();
function getDedupSeen(key) {
  let e = _dedupCache.get(key);
  if (!e || Date.now() - e.ts > 60000) { e = { ts: Date.now(), seen: new Set() }; _dedupCache.set(key, e); }
  return e.seen;
}
function dedupMetas(metas, key) {
  const seen = getDedupSeen(key);
  const out = metas.filter(m => !seen.has(m.id));
  out.forEach(m => seen.add(m.id));
  return out;
}
function setCatalogCache(res) {
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
}
function shuffleMetas(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const app = express();
// Railway/reverse proxies sit in front — needed for accurate req.ip rate limiting.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 7000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ─── Simple rate limiter (no extra dependency) ───────────────────────────────
function createRateLimiter(windowMs, maxRequests) {
  const hits = new Map();
  // Cleanup every windowMs
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const max = typeof maxRequests === 'function' ? maxRequests(req) : maxRequests;
    const key = req.user?.id ? `user:${req.user.id}` : `ip:${ip}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || (now - entry.start) > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

// Rate limiters for different endpoint groups
const apiLimiter = createRateLimiter(60 * 1000, (req) => (req.user ? 180 : 60));
const bundleLimiter = createRateLimiter(60 * 1000, (req) => (req.user ? 120 : 30));
const streamLimiter = createRateLimiter(60 * 1000, 120);  // 120 req/min for stream endpoints
const authLimiter = createRateLimiter(60 * 1000, 10);     // 10 req/min for auth endpoints

// ─── Request log (persisted to disk, capped at 50) ──────────────────────────
const REQUEST_LOG_FILE = path.join(DATA_DIR, 'request-log.json');
const MAX_LOG = 500;  // keep more history so per-user admin activity is meaningful
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
  if (dbLib.isConfigured()) {
    _requestLogDb.record({
      userId: entry.userId || null, ts: entry.ts, type: entry.type, imdbId: entry.imdbId,
      contentName: entry.contentName, bestServer: entry.bestServer, serverStatus: entry.serverStatus,
      season: entry.season, episode: entry.episode, ms: entry.ms, found: entry.found,
    }).catch(() => {});
  }
}

loadRequestLog();

// ─── Config encode/decode ─────────────────────────────────────────────────────

function decodeConfig(encoded) {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

function encodeConfig(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── CORS (required by Stremio) ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Single JSON parser for all API routes — avoids per-route double-read ("stream is not readable").
app.use(express.json({ limit: '1mb' }));

// Static assets with reasonable caching. Versioned files (?v=3 etc.) and ETag/304s already help a lot.
// Longer maxAge improves repeat visits without missing updates (browser still validates).
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '12h',
  etag: true,
  lastModified: true,
}));

const { makeRequestLog } = require('./lib/requestLog');
const { makeSiteSettings } = require('./lib/siteSettings');
const _siteSettings = makeSiteSettings();
// ─── Accounts / auth (no-ops gracefully without DATABASE_URL) ───────────────
const { makeAuthRouter, attachUser } = require('./routes/auth');
app.use(attachUser());
app.use('/api/auth', makeAuthRouter());

// ─── Authenticated user config / encrypted keys / manifest token ─────────────
const dbLib = require('./lib/db');
const _requestLogDb = makeRequestLog(dbLib);
const { makeManifestStore } = require('./lib/manifestStore');
const { hasActiveAccess } = require('./lib/manifest');
const { makeUserRouter } = require('./routes/user');
app.use('/api/user', makeUserRouter());
const { makeAdminRouter } = require('./routes/admin');
app.use('/api/admin', makeAdminRouter({ getRequestLog: () => REQUEST_LOG }));
const paypal = require('./lib/paypal');
const { makeBilling } = require('./lib/billing');
const { makeBillingRouter } = require('./routes/billing');
app.use('/api/billing', makeBillingRouter());
const { makeNewsRouter } = require('./routes/news');
app.use('/api/news', makeNewsRouter());
const { makeTicketsRouter } = require('./routes/tickets');
app.use('/api/tickets', makeTicketsRouter());

// ─── Per-user manifest: /u/:token/* → load the user's stored config (keys
// decrypted in-memory) and re-dispatch to the existing /:config/* handlers. ──
app.use('/u/:token', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!dbLib.isConfigured()) return res.status(404).json({ error: 'not found' });
  try {
    const rec = await makeManifestStore(dbLib).lookup(req.params.token);
    if (!rec) return res.status(410).json({ error: 'link invalid or revoked' });
    // Anti-sharing gate — only enforced once billing (PayPal) is configured.
    // Admins are always exempt; active/comped subscribers pass.
    if (paypal.isConfigured()) {
      let allowed = await makeBilling(dbLib).hasAccess(rec.user_id);
      if (!allowed) {
        const ur = await dbLib.query('SELECT role FROM users WHERE id=$1', [rec.user_id]);
        allowed = ur.rowCount > 0 && ur.rows[0].role === 'admin';
      }
      if (!allowed) return res.status(402).json({ error: 'subscription required' });
    }
    let cfg = await makeUserConfig(dbLib).getForServe(rec.user_id);
    if (!cfg) return res.status(404).json({ error: 'no configuration saved' });
    cfg = upgradeStreamProfile(cfg).cfg;
    req._mebUserId = rec.user_id;
    const rest = req.url === '/' ? '/manifest.json' : req.url; // req.url is post-mount remainder
    req.url = '/' + encodeConfig(cfg) + rest;
    return app.handle(req, res); // re-route through the existing /:config/* handlers
  } catch (e) {
    console.error('[u/token] error:', e.message);
    return res.status(500).json({ error: 'server error' });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  applyConfigureSecurityHeaders(res);
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/health',  (req, res) => res.json({ status: 'ok' }));
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// ─── System metrics (CPU/RAM/uptime) — admin only ────────────────────────────
app.get('/api/metrics', apiLimiter, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  try { res.json(systemMetrics()); }
  catch (e) { res.status(500).json({ error: 'metrics unavailable' }); }
});

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

// Audio taxonomy + device presets — single source of truth for the configure UI.
app.get('/api/audio-formats', apiLimiter, (req, res) => {
  res.json({ formats: audioRanking.AUDIO_FORMATS, presets: audioRanking.AUDIO_PRESETS });
});

// ─── Server health dashboard ──────────────────────────────────────────────────
app.get('/servers', (req, res) => res.redirect('/configure#/health'));
app.get('/:config/servers', (req, res) => {
  res.redirect(`/servers?cfg=${encodeURIComponent(req.params.config)}`);
});

// Register servers for 24/7 health monitoring
app.post('/api/health/register', apiLimiter, requireAuthInProduction, async (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers must be array' });
  try {
    for (const s of servers) {
      if (s && s.url) await assertSafeFetchUrl(s.url, 'server url');
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  registerHealthServers(servers, req.user && req.user.id);
  res.json({ ok: true, monitoring: healthServers.length });
});

// Unregister a server from health monitoring
app.post('/api/health/unregister', apiLimiter, requireAuthInProduction, (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  const removed = unregisterHealthServer(url);
  res.json({ ok: true, removed, monitoring: healthServers.length });
});

// Cleanup stale servers not in the active list
app.post('/api/health/cleanup', apiLimiter, requireAuthInProduction, (req, res) => {
  const { activeUrls } = req.body || {};
  if (!Array.isArray(activeUrls)) return res.status(400).json({ error: 'activeUrls must be array' });
  const removed = cleanupStaleServers(activeUrls);
  res.json({ ok: true, removed, monitoring: healthServers.length });
});

// Return uptime history — scoped to the signed-in user's servers, or explicit ?urls= for local config
app.get('/api/health/history', async (req, res) => {
  try {
    const { getUserServerUrlSet, historyForUrls } = require('./lib/health');
    const urlSet = new Set();
    if (req.user) {
      for (const u of getUserServerUrlSet(req.user.id)) urlSet.add(u);
      if (dbLib.isConfigured()) {
        try {
          const ed = await makeUserConfig(dbLib).getEditable(req.user.id);
          for (const s of (ed?.config?.servers || [])) {
            const u = (s.url || '').replace(/\/+$/, '');
            if (u) urlSet.add(u);
          }
        } catch { /* best-effort */ }
      }
    } else {
      String(req.query.urls || '').split(',').forEach(raw => {
        const u = raw.trim().replace(/\/+$/, '');
        if (u && /^https?:\/\//i.test(u)) urlSet.add(u);
      });
    }
    res.json(historyForUrls(urlSet));
  } catch (e) {
    res.status(500).json({ error: 'history failed' });
  }
});

// Trigger an immediate ping of all registered servers
app.post('/api/health/ping-now', apiLimiter, requireAuthInProduction, async (req, res) => {
  await pingHealthServers();
  const result = healthServers.map(s => ({
    url:    s.url,
    label:  s.label,
    latest: (healthHistory[s.url] || [])[0] || null,
  }));
  res.json(result);
});

// ─── Request log routes (per-user; requires sign-in) ─────────────────────────
function mapRequestLogRows(rows) {
  return rows.map(r => ({
    ts: r.ts, type: r.type, contentName: r.title, bestServer: r.bestFile,
    serverStatus: r.serverStatus, season: r.season, episode: r.episode, ms: r.ms, found: r.found,
  }));
}
app.get('/api/request-log', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  if (dbLib.isConfigured()) {
    try {
      const rows = await _requestLogDb.forUser(req.user.id, 50);
      return res.json(mapRequestLogRows(rows));
    } catch (e) { /* fall through to in-memory */ }
  }
  res.json(REQUEST_LOG.filter(e => !e.userId || e.userId === req.user.id));
});
app.post('/api/clear-request-log', apiLimiter, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  if (dbLib.isConfigured()) {
    try {
      await _requestLogDb.clearForUser(req.user.id);
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'clear failed' }); }
  }
  for (let i = REQUEST_LOG.length - 1; i >= 0; i--) {
    if (!REQUEST_LOG[i].userId || REQUEST_LOG[i].userId === req.user.id) REQUEST_LOG.splice(i, 1);
  }
  saveRequestLog();
  res.json({ ok: true });
});

// Public: every visitor's frontend needs to know which tabs are hidden.
app.get('/api/site-config', async (req, res) => {
  const { TOGGLEABLE_TABS } = require('./lib/siteSettings');
  res.json({
    disabledTabs: await _siteSettings.getDisabledTabs(),
    toggleable: TOGGLEABLE_TABS,
    announcement: await _siteSettings.getAnnouncement(),
  });
});


// ─── Catalog browse proxies (avoids browser CORS) ─────────────────────────────
app.post('/api/catalogs/browse-mdblist', apiLimiter, async (req, res) => {
  const { username, apiKey } = req.body || {};
  if (!username || !apiKey) return res.status(400).json({ error: 'username and apiKey required' });
  try {
    const url = `https://api.mdblist.com/lists/user/${encodeURIComponent(username)}/?apikey=${encodeURIComponent(apiKey)}`;
    const r = await fetchWithTimeout(url, 10000, { headers: { 'User-Agent': BROWSER_UA } });
    if (!r.ok) return res.status(502).json({ error: `MDbList API returned ${r.status}` });
    const lists = await r.json();
    res.json({ lists: Array.isArray(lists) ? lists : [] });
  } catch (err) {
    res.status(502).json({ error: err.message || 'browse failed' });
  }
});

app.post('/api/catalogs/browse-trakt', apiLimiter, async (req, res) => {
  const { username, traktClientId } = req.body || {};
  const clientId = traktClientId || process.env.TRAKT_CLIENT_ID;
  if (!username || !clientId) return res.status(400).json({ error: 'username and traktClientId required' });
  try {
    const url = `https://api.trakt.tv/users/${encodeURIComponent(username)}/lists`;
    const r = await fetchWithTimeout(url, 10000, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': clientId,
        'User-Agent': BROWSER_UA,
      },
    });
    if (!r.ok) return res.status(502).json({ error: `Trakt API returned ${r.status}` });
    const lists = await r.json();
    res.json({ lists: Array.isArray(lists) ? lists : [] });
  } catch (err) {
    res.status(502).json({ error: err.message || 'browse failed' });
  }
});

// ─── Catalog validation ───────────────────────────────────────────────────────
app.post('/api/catalog/validate', apiLimiter, async (req, res) => {
  const { entry, rpdbKey, traktClientId, catalogLang, tmdbApiKey } = req.body || {};
  if (!entry) return res.status(400).json({ error: 'entry is required' });
  
  try {
    const startTime = Date.now();
    const metas = await fetchExternalCatalog(entry, rpdbKey || null, traktClientId || process.env.TRAKT_CLIENT_ID || null, catalogLang || null, tmdbApiKey || process.env.TMDB_API_KEY || null);
    const duration = Date.now() - startTime;
    
    const movies = metas.filter(m => m.type === 'movie').length;
    const shows  = metas.filter(m => m.type === 'series').length;
    res.json({
      valid: metas.length > 0,
      count: metas.length,
      movies,
      shows,
      duration,
      sample: metas.slice(0, 3).map(m => ({ id: m.id, name: m.name })),
      message: metas.length > 0 ? `Loaded ${metas.length} items (${movies} movies, ${shows} shows)` : 'No items found in catalog'
    });
  } catch (err) {
    const msg = err.message || String(err);
    const expected = /returned 40[0-9]|is required|No items found/i.test(msg);
    if (expected) console.warn('[catalog/validate]', msg);
    else console.error('[catalog/validate]', msg);
    res.json({
      valid: false,
      count: 0,
      duration: 0,
      error: msg,
      message: `Failed to load catalog: ${msg}`
    });
  }
});

// ─── Profile: save ────────────────────────────────────────────────────────────
app.post('/api/profile/save', authLimiter, (req, res) => {
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
app.post('/api/profile/load', authLimiter, (req, res) => {
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
app.post('/api/fetch-credentials', authLimiter, requireAuthInProduction, async (req, res) => {
  const { url, username, password } = req.body || {};
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username and password are required.' });
  }

  let safeOrigin;
  try {
    const parsed = await assertSafeFetchUrl(url, 'server url');
    safeOrigin = parsed.origin;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-setup", Version="1.0.0"';
  const baseUrl = safeOrigin;

  // Try multiple auth path patterns — shared/managed Emby servers sometimes
  // use a subpath prefix (/emby/, /mediabrowser/) or non-standard layouts.
  const authPaths = [
    `${baseUrl}/Users/AuthenticateByName`,
    `${baseUrl}/emby/Users/AuthenticateByName`,
    `${baseUrl}/mediabrowser/Users/AuthenticateByName`,
  ];

  const tryAuth = async (authUrl) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': authHeader,
          'Authorization': authHeader,
          'User-Agent': BROWSER_UA,
        },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let resp = null;
    let lastError = null;
    for (const authUrl of authPaths) {
      try {
        const r = await tryAuth(authUrl);
        // 401/403 means we reached Emby but creds are wrong — no point trying other paths
        if (r.status === 401 || r.status === 403) {
          return res.status(401).json({ error: 'Authentication failed — wrong username or password.' });
        }
        if (r.ok) { resp = r; break; }
        lastError = `HTTP ${r.status}`;
      } catch (e) {
        lastError = e.name === 'AbortError' ? 'timeout' : e.message;
      }
    }

    if (!resp) {
      return res.status(502).json({ error: `Could not reach auth endpoint (tried 3 paths, last error: ${lastError}). Check the URL or enter API Key and User ID manually.` });
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

// Resolve Emby/Jellyfin credentials: prefer the signed-in user's stored config
// (authoritative in production) and fall back to the request body for local/dev.
async function resolveServerCredentials(req, body) {
  const { url, type, apiKey, userId, username, password, label } = body || {};
  if (!url) return { status: 400, error: 'url is required' };
  let safeUrl;
  try {
    await assertSafeFetchUrl(url, 'server url');
    safeUrl = normalizeServerUrl(url);
    if (!safeUrl) return { status: 400, error: 'Invalid server url' };
  } catch (e) {
    return { status: 400, error: e.message };
  }
  const server = {
    url: safeUrl,
    type: type || 'emby',
    apiKey: String(apiKey || '').trim(),
    userId: String(userId || '').trim(),
    username: username || '',
    password: password || '',
    label: label || '',
  };
  if (req.user && dbLib.isConfigured()) {
    try {
      const cfg = await makeUserConfig(dbLib).getForServe(req.user.id);
      const match = findServerEntry(cfg?.servers, safeUrl, label);
      if (match) {
        if (match.apiKey) server.apiKey = match.apiKey;
        if (match.userId) server.userId = match.userId;
        if (match.type) server.type = match.type;
        if (match.username) server.username = match.username;
        if (match.password) server.password = match.password;
        if (match.label) server.label = match.label;
        if (match.url) server.url = normalizeServerUrl(match.url) || server.url;
      }
    } catch { /* best-effort */ }
  }
  if (!server.apiKey || !server.userId) {
    return { status: 400, error: 'url, apiKey and userId are required.' };
  }
  return { server };
}

// ─── Test connection ──────────────────────────────────────────────────────────
app.post('/api/test-connection', apiLimiter, requireAuthInProduction, async (req, res) => {
  const resolved = await resolveServerCredentials(req, req.body);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const server = resolved.server;
  const sentKey = server.apiKey;
  try {
    const resp = await apiFetch(server, () => new URL(`${server.url}/System/Info`));
    const data = await resp.json();
    const name    = data.ServerName || data.ProductName || (server.type === 'jellyfin' ? 'Jellyfin' : 'Emby');
    const version = data.Version ? ` v${data.Version}` : '';
    const out = { ok: true, message: `Connected — ${name}${version}` };
    const refreshed = getEffectiveApiKey(server);
    if (refreshed && refreshed !== sentKey) out.apiKey = refreshed;
    res.json(out);
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.status(401).json({ ok: false, error: 'Authentication failed — check your API key or saved login.' });
    if (err.name === 'AbortError')
      return res.status(504).json({ ok: false, error: 'Connection timed out — check the server URL.' });
    res.status(502).json({ ok: false, error: `Could not connect: ${err.message}` });
  }
});

// ─── Ping servers ─────────────────────────────────────────────────────────────
app.post('/api/ping-servers', apiLimiter, requireAuthInProduction, async (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers array required' });
  const results = await Promise.all(servers.map(async s => {
    const t0 = Date.now();
    try {
      const parsed = await assertSafeFetchUrl(s.url, 'server url');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const resp = await fetch(`${parsed.origin}/System/Ping`, { headers: { 'User-Agent': BROWSER_UA }, signal: controller.signal });
        if (!resp.ok) return { label: s.label, ms: null, up: false };
      } finally { clearTimeout(timer); }
      return { label: s.label, ms: Date.now() - t0, up: true };
    } catch {
      return { label: s.label, ms: null, up: false };
    }
  }));
  res.json({ results });
});

// ─── Live sessions (now playing) for one server ─────────────────────────────
app.post('/api/server-sessions', apiLimiter, requireAuthInProduction, async (req, res) => {
  const resolved = await resolveServerCredentials(req, req.body);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const server = resolved.server;
  const { fetchServerSessionsDetailed } = require('./lib/sessions');
  const sentKey = server.apiKey;
  const probe = await fetchServerSessionsDetailed(server);
  const out = {
    live: probe.live || [],
    probe: {
      ok: !!probe.ok,
      count: probe.count || 0,
      ms: probe.ms || 0,
      error: probe.error || null,
      method: probe.method || null,
    },
  };
  const refreshed = getEffectiveApiKey(server);
  if (refreshed && refreshed !== sentKey) out.apiKey = refreshed;
  if (!probe.ok && probe.error) {
    const status = /HTTP 401|HTTP 403/i.test(probe.error) ? 401
      : /timeout/i.test(probe.error) ? 504 : 502;
    return res.status(status).json({ ...out, error: probe.error });
  }
  res.json(out);
});

// ─── Library stats ────────────────────────────────────────────────────────────
app.post('/api/library-stats', apiLimiter, requireAuthInProduction, async (req, res) => {
  const resolved = await resolveServerCredentials(req, req.body);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const server = resolved.server;
  const sentKey = server.apiKey;
  try {
    const stats = await fetchLibraryCounts(server, 15000);
    res.json({ ...stats, ...libraryStatsPayload(server, sentKey) });
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.status(401).json({ error: 'Authentication failed' });
    if (err.name === 'AbortError')
      return res.status(504).json({ error: 'Connection timed out' });
    res.status(502).json({ error: err.message });
  }
});

async function mapPool(items, worker, concurrency = 3) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let idx = 0;
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

// Unified dashboard bundle — one orchestrated payload per scope (full | live | stats | health).
app.get('/api/dashboard/bundle', bundleLimiter, requireAuthInProduction, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  if (!dbLib.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
  const { buildDashboardBundle } = require('./lib/dashboard');
  const scope = req.query.scope || 'full';
  try {
    const bundle = await buildDashboardBundle({
      userId: req.user.id,
      scope,
      uc: makeUserConfig(dbLib),
      requestLog: _requestLogDb,
      healthHistory,
      healthServers,
    });
    res.json(bundle);
  } catch (err) {
    console.error('[dashboard/bundle]', err.message);
    res.status(500).json({ error: 'dashboard bundle failed' });
  }
});

// Batch library stats for signed-in dashboard (authoritative DB creds, no per-card URL matching).
app.post('/api/dashboard/library-stats', apiLimiter, requireAuthInProduction, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'sign in required' });
  if (!dbLib.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
  const BATCH_LIB_TIMEOUT_MS = 20000;
  const BATCH_LIB_CONCURRENCY = 3;
  try {
    const cfg = await makeUserConfig(dbLib).getForServe(req.user.id);
    const servers = (cfg?.servers || []).filter(s =>
      s && s.enabled !== false && s.url && s.apiKey && s.userId
    );
    const results = await mapPool(servers, async (s) => {
      const sentKey = s.apiKey;
      const label = s.label || s.url || '?';
      try {
        const stats = await fetchLibraryCounts(s, BATCH_LIB_TIMEOUT_MS);
        return {
          url: s.url,
          label: s.label || '',
          ok: true,
          ...stats,
          ...libraryStatsPayload(s, sentKey),
        };
      } catch (err) {
        const msg = err.status === 401 || err.status === 403
          ? 'Authentication failed'
          : err.name === 'AbortError'
            ? 'Connection timed out'
            : (err.message || 'Library stats failed');
        console.error(`[dashboard/library-stats] label=${label} err=${msg}`);
        return { url: s.url, label: s.label || '', ok: false, error: msg };
      }
    }, BATCH_LIB_CONCURRENCY);
    res.json({ servers: results });
  } catch (err) {
    console.error('[dashboard/library-stats]', err.message);
    res.status(500).json({ error: 'Library stats failed' });
  }
});

app.post('/api/addon-catalogs', apiLimiter, async (req, res) => {
  let manifestUrl = (req.body && req.body.manifestUrl || '').trim();
  if (!manifestUrl) return res.status(400).json({ error: 'manifestUrl required' });
  if (!/^https?:\/\//i.test(manifestUrl)) manifestUrl = 'https://' + manifestUrl;
  if (!/\/manifest\.json($|\?)/i.test(manifestUrl)) {
    manifestUrl = manifestUrl.replace(/\/+$/, '') + '/manifest.json';
  }
  try {
    await assertSafeFetchUrl(manifestUrl, 'manifest url');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const baseUrl = manifestUrl.replace(/\/manifest\.json.*$/i, '');
  try {
    const r = await fetchWithTimeout(manifestUrl, 8000, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' } });
    if (!r.ok) return res.status(502).json({ error: 'Manifest HTTP ' + r.status });
    const mf = await r.json();
    const catalogs = (Array.isArray(mf.catalogs) ? mf.catalogs : [])
      .map(c => ({ type: c.type, id: c.id, name: c.name || c.id }))
      .filter(c => (c.type === 'movie' || c.type === 'series') && c.id);
    res.json({ name: mf.name || 'Addon', version: mf.version || '', baseUrl, catalogs });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timed out fetching manifest' });
    res.status(502).json({ error: err.message });
  }
});

// ─── Manifest ─────────────────────────────────────────────────────────────────
app.get('/:config/manifest.json', (req, res) => {
  let cfg;
  try {
    cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg;
  } catch {
    return res.status(400).json({ error: 'Invalid config' });
  }

  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</configure#/install>; rel="successor-version"');

  const names = (cfg.servers || []).map((s) => s.label).join(', ');

  const extCats = [];
  (cfg.externalCatalogs || []).filter(c => c.enabled !== false).forEach((c, i) => {
    const types = c.mediaType === 'both' ? ['movie', 'series'] : [c.mediaType || 'movie'];
    types.forEach(t => extCats.push({ type: t, id: 'extcat-' + i, name: c.name || c.provider, extra: [] }));
  });
  const buildLibraryCatalogs = (cfg) => {
    const rows = deriveLibraryRows(cfg);
    const out = [
      { type: 'movie',  id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: true }] },
      { type: 'series', id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: true }] },
    ];
    rows.forEach(key => {
      const types = key === 'nextup' ? ['series'] : ['movie', 'series'];
      types.forEach(type => out.push({ type, id: 'myemby-' + key, name: ROW_NAMES[key], extra: [] }));
    });
    return out;
  };
  res.json({
    id: 'com.multiemby.bridge',
    version: '1.0.0',
    name: 'Stream Hub',
    description: `Streams from: ${names || 'configured servers'}`,
    types: ['movie', 'series'],
    catalogs: [
      ...buildLibraryCatalogs(cfg),
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
  try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }

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
      const allMetas = await fetchExternalCatalog(entry, cfg.rpdbKey || null, cfg.traktClientId || process.env.TRAKT_CLIENT_ID || null, cfg.catalogLang || null, cfg.tmdbApiKey || process.env.TMDB_API_KEY || null);
      let metas = allMetas.filter(m => m.type === type);
      if (entry.shuffle) metas = shuffleMetas(metas);
      const dmx = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas; setCatalogCache(res); return res.json({ metas: dmx });
    } catch (err) {
      console.error('External catalog error:', err.message);
      return res.json({ metas: [] });
    }
  }
  try {
    if (query) {
      // Search catalog — always runs regardless of showCatalog setting
      const metas = await searchServersForCatalog(servers, type, query, 8000, cfg.rpdbKey || null, cfg.catalogLang || null);
      const dme = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas; setCatalogCache(res); res.json({ metas: dme });
    } else {
      // Browse catalog (home page row)
      const libKey = (req.params.id && req.params.id.indexOf('myemby-') === 0)
        ? req.params.id.slice('myemby-'.length)
        : (cfg.catalogContent || 'recent');
      const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, libKey, cfg.catalogLang || null);
      const dme = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas; setCatalogCache(res); res.json({ metas: dme });
    }
  } catch (err) {
    console.error('Catalog error:', err.message);
    res.json({ metas: [] });
  }
});

// Route without extras — recently added feed
app.get('/:config/catalog/:type/:id.json', streamLimiter, async (req, res) => {
  let cfg;
  try { cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg; } catch { return res.json({ metas: [] }); }

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
      const allMetas = await fetchExternalCatalog(entry, cfg.rpdbKey || null, cfg.traktClientId || process.env.TRAKT_CLIENT_ID || null, cfg.catalogLang || null, cfg.tmdbApiKey || process.env.TMDB_API_KEY || null);
      let metas = allMetas.filter(m => m.type === type);
      if (entry.shuffle) metas = shuffleMetas(metas);
      const dmx = cfg.noDupes ? dedupMetas(metas, req.params.config) : metas; setCatalogCache(res); return res.json({ metas: dmx });
    } catch (err) {
      console.error('External catalog error:', err.message);
      return res.json({ metas: [] });
    }
  }
  try {
    const libKey = (req.params.id && req.params.id.indexOf('myemby-') === 0)
      ? req.params.id.slice('myemby-'.length)
      : (cfg.catalogContent || 'recent');
    const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, libKey, cfg.catalogLang || null);
    setCatalogCache(res); res.json({ metas });
  } catch (err) {
    console.error('Catalog browse error:', err.message);
    res.json({ metas: [] });
  }
});


// ─── Stream handler ───────────────────────────────────────────────────────────
app.get('/:config/stream/:type/:id.json', streamLimiter, async (req, res) => {
  let cfg;
  try {
    cfg = upgradeStreamProfile(decodeConfig(req.params.config)).cfg;
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
      audioRank:          cfg.audioRank === true,
      audioOrder:         cfg.audioOrder || undefined,
      audioDisabled:      cfg.audioDisabled || [],
      audioRankMode:      cfg.audioRankMode || 'audioFirst',
      audioDisableAction: cfg.audioDisableAction || 'hide',
      surroundPriority:   cfg.surroundPriority === true,
      healthHistory,
      failoverHideDown:   cfg.failoverHideDown === true,
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

    const found = (meta.serverStatus || []).some(s => s.status === 'found');
    addLogEntry({
      userId:       req._mebUserId || null,
      ts:           new Date().toISOString(),
      type,
      imdbId,
      season:       season  || null,
      episode:      episode || null,
      contentName:  meta.contentName,
      bestServer:   meta.bestServer,
      serverStatus: meta.serverStatus,
      found,
      ms:           Date.now() - _t0,
    });
    if (found && req._mebUserId && dbLib.isConfigured()) {
      makeUserConfig(dbLib).getEditable(req._mebUserId).then(cur => {
        if (cur.config && cur.config.onboarding && cur.config.onboarding.testedStream) return;
        const merged = {
          ...(cur.config || {}),
          onboarding: { ...(cur.config && cur.config.onboarding), testedStream: true },
        };
        return makeUserConfig(dbLib).save(req._mebUserId, merged);
      }).catch(() => {});
    }
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
  if (err.message === 'stream is not readable') {
    console.warn('[body] unreadable stream:', req.method, req.path);
    return res.status(400).json({ error: 'Request body could not be read.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  logStartupSecurityWarnings();
  console.log(`[startup] Stream Hub READY → http://0.0.0.0:${PORT}/configure`);
});

// Graceful shutdown to avoid abrupt DB connection resets on Railway deploys/restarts
const { getPool, isConfigured } = require('./lib/db');

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    if (isConfigured()) {
      const pool = getPool();
      if (pool) {
        pool.end(() => {
          console.log('Postgres pool closed.');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    } else {
      process.exit(0);
    }
  });
  // Force exit after timeout if graceful fails
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
});

// ─── Database init (migrations + admin seed); no-ops without DATABASE_URL ────
const { runMigrations } = require('./lib/migrate');
const { seedAdmin } = require('./lib/seed');
const { initHealthDB } = require('./lib/health');
const { startAdminIntelScheduler } = require('./lib/adminIntelScheduler');

runMigrations()
  .then(() => seedAdmin())
  .then(() => initHealthDB())
  .then(() => {
    if (dbLib.isConfigured()) {
      startAdminIntelScheduler({
        userConfig: makeUserConfig(dbLib),
        requestLog: _requestLogDb,
        getRequestLog: () => REQUEST_LOG,
      });
    }
  })
  .then(() => console.log('[ready] Server fully initialized (DB init complete, accepting connections)'))
  .catch(e => console.error('[boot] db init failed:', e.message));


