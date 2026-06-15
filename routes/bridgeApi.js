const fetch = require('node-fetch');
const { apiFetch, getEffectiveApiKey, SHIELD_UA } = require('../lib/auth');
const { EMBY_CLIENT_HEADER, getSnapshot, clear: clearTraffic } = require('../lib/apiTraffic');
const { assertSafeFetchUrl, safeAgent, SAFE_REDIRECT_LIMIT } = require('../lib/urlSafety');
const { requireAuthInProduction } = require('../lib/security');
const { resolveServerCredentials } = require('../lib/serverCredentials');

function registerBridgeApi(app, deps) {
  const { dbLib, limiters } = deps;
  const { apiLimiter, authLimiter } = limiters;

  app.get('/api/server-info', (req, res) => {
    const region = process.env.RAILWAY_REGION || process.env.FLY_REGION || null;
    const service = process.env.RAILWAY_SERVICE_NAME || null;
    res.json({
      region: region || null,
      service: service || null,
      host: req.hostname || null,
    });
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
    const authHeader = EMBY_CLIENT_HEADER;
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
            Authorization: authHeader,
            'User-Agent': SHIELD_UA,
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

  app.get('/api/debug/traffic', apiLimiter, requireAuthInProduction, (req, res) => {
    res.json(getSnapshot());
  });

  app.post('/api/debug/traffic/clear', apiLimiter, requireAuthInProduction, (req, res) => {
    clearTraffic();
    res.json({ ok: true });
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
}

module.exports = { registerBridgeApi };