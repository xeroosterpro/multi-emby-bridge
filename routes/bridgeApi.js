const crypto = require('crypto');
const fetch = require('node-fetch');
const { fetchWithTimeout, apiFetch, getEffectiveApiKey, BROWSER_UA } = require('../lib/auth');
const { fetchExternalCatalog } = require('../lib/catalogs');
const {
  healthServers, healthHistory, registerHealthServers, unregisterHealthServer,
  cleanupStaleServers, pingHealthServers,
} = require('../lib/health');
const { makeUserConfig } = require('../lib/userConfig');
const { hashPassword, loadProfiles, saveProfiles } = require('../lib/profiles');
const { snapshot: systemMetrics } = require('../lib/metrics');
const audioRanking = require('../lib/audioRanking');
const { assertSafeFetchUrl, safeAgent, SAFE_REDIRECT_LIMIT } = require('../lib/urlSafety');
const { fetchLibraryCounts, libraryStatsPayload } = require('../lib/libraryStats');
const { isProduction, requireAuthInProduction } = require('../lib/security');
const { resolveServerCredentials } = require('../lib/serverCredentials');
const { mapPool } = require('../lib/dashboard/mapPool');

function mapRequestLogRows(rows) {
  return rows.map(r => ({
    ts: r.ts, type: r.type, contentName: r.title, bestServer: r.bestFile,
    serverStatus: r.serverStatus, season: r.season, episode: r.episode, ms: r.ms, found: r.found,
  }));
}

function registerBridgeApi(app, deps) {
  const {
    dbLib, requestLogDb, siteSettings, requestLogMemory, limiters,
  } = deps;
  const { apiLimiter, bundleLimiter, authLimiter } = limiters;
  const { addLogEntry, getRequestLog, saveRequestLog } = requestLogMemory;

  app.get('/api/metrics', apiLimiter, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
    try { res.json(systemMetrics()); }
    catch (e) { res.status(500).json({ error: 'metrics unavailable' }); }
  });

  app.get('/api/server-info', (req, res) => {
    const region = process.env.RAILWAY_REGION || process.env.FLY_REGION || null;
    const service = process.env.RAILWAY_SERVICE_NAME || null;
    res.json({
      region: region || null,
      service: service || null,
      host: req.hostname || null,
    });
  });

  app.get('/api/audio-formats', apiLimiter, (req, res) => {
    res.json({ formats: audioRanking.AUDIO_FORMATS, presets: audioRanking.AUDIO_PRESETS });
  });

  app.get('/servers', (req, res) => res.redirect('/configure#/health'));
  app.get('/:config/servers', (req, res) => {
    res.redirect(`/servers?cfg=${encodeURIComponent(req.params.config)}`);
  });

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

  app.post('/api/health/unregister', apiLimiter, requireAuthInProduction, (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    const removed = unregisterHealthServer(url);
    res.json({ ok: true, removed, monitoring: healthServers.length });
  });

  app.post('/api/health/cleanup', apiLimiter, requireAuthInProduction, (req, res) => {
    const { activeUrls } = req.body || {};
    if (!Array.isArray(activeUrls)) return res.status(400).json({ error: 'activeUrls must be array' });
    const removed = cleanupStaleServers(activeUrls);
    res.json({ ok: true, removed, monitoring: healthServers.length });
  });

  app.get('/api/health/history', async (req, res) => {
    if (isProduction() && !req.user) {
      return res.status(401).json({ error: 'sign in required' });
    }
    try {
      const { getUserServerUrlSet, historyForUrls } = require('../lib/health');
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
          } catch (e) { console.warn('[health/history] user config load failed:', e.message); }
        }
      } else if (!isProduction()) {
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

  app.post('/api/health/ping-now', apiLimiter, requireAuthInProduction, async (req, res) => {
    await pingHealthServers();
    const result = healthServers.map(s => ({
      url: s.url,
      label: s.label,
      latest: (healthHistory[s.url] || [])[0] || null,
    }));
    res.json(result);
  });

  app.get('/api/request-log', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    if (dbLib.isConfigured()) {
      try {
        const rows = await requestLogDb.forUser(req.user.id, 50);
        return res.json(mapRequestLogRows(rows));
      } catch (e) { /* fall through to in-memory */ }
    }
    const REQUEST_LOG = getRequestLog();
    res.json(REQUEST_LOG.filter(e => !e.userId || e.userId === req.user.id));
  });

  app.post('/api/clear-request-log', apiLimiter, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    if (dbLib.isConfigured()) {
      try {
        await requestLogDb.clearForUser(req.user.id);
        return res.json({ ok: true });
      } catch (e) { return res.status(500).json({ error: 'clear failed' }); }
    }
    const REQUEST_LOG = getRequestLog();
    for (let i = REQUEST_LOG.length - 1; i >= 0; i--) {
      if (!REQUEST_LOG[i].userId || REQUEST_LOG[i].userId === req.user.id) REQUEST_LOG.splice(i, 1);
    }
    saveRequestLog();
    res.json({ ok: true });
  });

  app.get('/api/site-config', async (req, res) => {
    const { TOGGLEABLE_TABS } = require('../lib/siteSettings');
    res.json({
      disabledTabs: await siteSettings.getDisabledTabs(),
      toggleable: TOGGLEABLE_TABS,
      announcement: await siteSettings.getAnnouncement(),
    });
  });

  app.post('/api/catalogs/browse-mdblist', apiLimiter, requireAuthInProduction, async (req, res) => {
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

  app.post('/api/catalogs/browse-trakt', apiLimiter, requireAuthInProduction, async (req, res) => {
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

  app.post('/api/catalog/validate', apiLimiter, requireAuthInProduction, async (req, res) => {
    const { entry, rpdbKey, traktClientId, catalogLang, tmdbApiKey } = req.body || {};
    if (!entry) return res.status(400).json({ error: 'entry is required' });
    try {
      const startTime = Date.now();
      const metas = await fetchExternalCatalog(
        entry, rpdbKey || null, traktClientId || process.env.TRAKT_CLIENT_ID || null,
        catalogLang || null, tmdbApiKey || process.env.TMDB_API_KEY || null
      );
      const duration = Date.now() - startTime;
      const movies = metas.filter(m => m.type === 'movie').length;
      const shows = metas.filter(m => m.type === 'series').length;
      res.json({
        valid: metas.length > 0,
        count: metas.length,
        movies,
        shows,
        duration,
        sample: metas.slice(0, 3).map(m => ({ id: m.id, name: m.name })),
        message: metas.length > 0
          ? `Loaded ${metas.length} items (${movies} movies, ${shows} shows)`
          : 'No items found in catalog',
      });
    } catch (err) {
      const msg = err.message || String(err);
      const expected = /returned 40[0-9]|is required|No items found/i.test(msg);
      if (expected) console.warn('[catalog/validate]', msg);
      else console.error('[catalog/validate]', msg);
      res.json({
        valid: false, count: 0, duration: 0, error: msg,
        message: `Failed to load catalog: ${msg}`,
      });
    }
  });

  app.post('/api/profile/save', authLimiter, requireAuthInProduction, (req, res) => {
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

  app.post('/api/profile/load', authLimiter, requireAuthInProduction, (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required.' });
    }
    const profiles = loadProfiles();
    const profile = profiles[username.toLowerCase()];
    if (!profile) return res.status(404).json({ error: 'No profile found with that name.' });
    const attempt = hashPassword(password, profile.salt);
    if (attempt !== profile.passwordHash) return res.status(401).json({ error: 'Wrong password.' });
    res.json({ config: profile.config, updatedAt: profile.updatedAt });
  });

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
    const authPaths = [
      `${safeOrigin}/Users/AuthenticateByName`,
      `${safeOrigin}/emby/Users/AuthenticateByName`,
      `${safeOrigin}/mediabrowser/Users/AuthenticateByName`,
    ];
    const tryAuth = async (authUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        return await fetch(authUrl, {
          method: 'POST',
          agent: safeAgent,
          follow: SAFE_REDIRECT_LIMIT,
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
        return res.status(502).json({
          error: `Could not reach auth endpoint (tried 3 paths, last error: ${lastError}). Check the URL or enter API Key and User ID manually.`,
        });
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

  app.post('/api/test-connection', apiLimiter, requireAuthInProduction, async (req, res) => {
    const resolved = await resolveServerCredentials(req, req.body, dbLib);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const server = resolved.server;
    const sentKey = server.apiKey;
    try {
      const resp = await apiFetch(server, () => new URL(`${server.url}/System/Info`), 5000);
      const data = await resp.json();
      const name = data.ServerName || data.ProductName || (server.type === 'jellyfin' ? 'Jellyfin' : 'Emby');
      const version = data.Version ? ` v${data.Version}` : '';
      const out = { ok: true, message: `Connected — ${name}${version}` };
      const refreshed = getEffectiveApiKey(server);
      if (refreshed && refreshed !== sentKey) out.apiKey = refreshed;
      res.json(out);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return res.status(401).json({ ok: false, error: 'Authentication failed — check your API key or saved login.' });
      }
      if (err.name === 'AbortError') {
        return res.status(504).json({ ok: false, error: 'Connection timed out — check the server URL.' });
      }
      res.status(502).json({ ok: false, error: `Could not connect: ${err.message}` });
    }
  });

  app.post('/api/ping-servers', apiLimiter, requireAuthInProduction, async (req, res) => {
    const { servers } = req.body || {};
    if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers array required' });
    if (servers.length > 50) return res.status(400).json({ error: 'too many servers (max 50)' });
    const results = await Promise.all(servers.map(async s => {
      const t0 = Date.now();
      try {
        const parsed = await assertSafeFetchUrl(s.url, 'server url');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch(`${parsed.origin}/System/Ping`, {
            agent: safeAgent, follow: SAFE_REDIRECT_LIMIT,
            headers: { 'User-Agent': BROWSER_UA }, signal: controller.signal,
          });
          if (!resp.ok) return { label: s.label, ms: null, up: false };
        } finally { clearTimeout(timer); }
        return { label: s.label, ms: Date.now() - t0, up: true };
      } catch {
        return { label: s.label, ms: null, up: false };
      }
    }));
    res.json({ results });
  });

  app.post('/api/server-sessions', apiLimiter, requireAuthInProduction, async (req, res) => {
    const resolved = await resolveServerCredentials(req, req.body, dbLib);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const server = resolved.server;
    const { fetchServerSessionsDetailed } = require('../lib/sessions');
    const sentKey = server.apiKey;
    const probe = await fetchServerSessionsDetailed(server, { timeoutMs: 4000 });
    const out = {
      live: probe.live || [],
      probe: {
        ok: !!probe.ok, count: probe.count || 0, ms: probe.ms || 0,
        error: probe.error || null, method: probe.method || null,
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

  app.post('/api/library-stats', apiLimiter, requireAuthInProduction, async (req, res) => {
    const resolved = await resolveServerCredentials(req, req.body, dbLib);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    const server = resolved.server;
    const sentKey = server.apiKey;
    try {
      const stats = await fetchLibraryCounts(server, 15000);
      res.json({ ...stats, ...libraryStatsPayload(server, sentKey) });
    } catch (err) {
      if (err.status === 401 || err.status === 403) return res.status(401).json({ error: 'Authentication failed' });
      if (err.name === 'AbortError') return res.status(504).json({ error: 'Connection timed out' });
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/dashboard/bundle', bundleLimiter, requireAuthInProduction, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'sign in required' });
    if (!dbLib.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    const { buildDashboardBundle } = require('../lib/dashboard');
    const scope = req.query.scope || 'full';
    try {
      const bundle = await buildDashboardBundle({
        userId: req.user.id,
        scope,
        uc: makeUserConfig(dbLib),
        requestLog: requestLogDb,
        healthHistory,
        healthServers,
      });
      res.json(bundle);
    } catch (err) {
      console.error('[dashboard/bundle]', err.message);
      res.status(500).json({ error: 'dashboard bundle failed' });
    }
  });

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
            url: s.url, label: s.label || '', ok: true, ...stats,
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

  app.post('/api/addon-catalogs', apiLimiter, requireAuthInProduction, async (req, res) => {
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
      const r = await fetchWithTimeout(manifestUrl, 8000, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' },
      });
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
}

module.exports = { registerBridgeApi };