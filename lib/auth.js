// ─── Authentication, token cache, API fetch helpers ─────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { safeAgent, SAFE_REDIRECT_LIMIT } = require('./urlSafety');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_CACHE_FILE = path.join(DATA_DIR, 'token-cache.json');

// ─── Auto-renewing API key cache (persisted to disk) ─────────────────────────
const tokenCache = new Map(); // cacheKey(url+userId) → { token, ts }
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours
// Managed/reseller Emby servers often sit behind a WAF that blocks non-browser
// User-Agents (e.g. node-fetch's default). Always present a normal browser UA.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Token cache key: scope by server URL AND user so two profiles on the same
// server with different users don't overwrite each other's access tokens.
function tokenKey(server) { return server.url + '|' + (server.userId || ''); }

function loadTokenCache() {
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
      for (const [url, entry] of Object.entries(data)) {
        if (entry.ts && (Date.now() - entry.ts) < TOKEN_TTL) {
          tokenCache.set(url, entry);
        }
      }
      console.log(`Token cache loaded: ${tokenCache.size} valid entries`);
    }
  } catch (e) { console.warn('[auth] token cache load failed:', e.message); }
}

function saveTokenCache() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [url, entry] of tokenCache) obj[url] = entry;
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) { console.warn('[auth] token cache save failed:', e.message); }
}

// Load on module init
loadTokenCache();

function getEffectiveApiKey(server) {
  const key = tokenKey(server);
  const entry = tokenCache.get(key);
  if (entry && (Date.now() - entry.ts) < TOKEN_TTL) return entry.token;
  if (entry) tokenCache.delete(key); // expired
  return server.apiKey;
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': BROWSER_UA, ...(options.headers || {}) };
    // SSRF: validate every connect (incl. redirect hops) against private IPs and
    // cap redirects. The safe agent re-checks the resolved address at socket time.
    const resp = await fetch(url, {
      agent: safeAgent,
      follow: SAFE_REDIRECT_LIMIT,
      ...options,
      headers,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(server) {
  const key = getEffectiveApiKey(server);
  if (server.type === 'jellyfin') {
    return {
      'Authorization': `MediaBrowser Token="${key}"`,
      'X-MediaBrowser-Token': key,
    };
  }
  return { 'X-Emby-Token': key };
}

function appendAuth(url, server) {
  if (server.type !== 'jellyfin') {
    url.searchParams.set('api_key', getEffectiveApiKey(server));
  }
}

// Single-flight guard: collapse concurrent reauth attempts for the same
// server+user into one in-flight AuthenticateByName request.
const _reauthInFlight = new Map(); // tokenKey -> Promise<boolean>

function reauthenticate(server) {
  const k = tokenKey(server);
  const existing = _reauthInFlight.get(k);
  if (existing) return existing;
  const p = _doReauthenticate(server).finally(() => _reauthInFlight.delete(k));
  _reauthInFlight.set(k, p);
  return p;
}

function _recordReauth(server, ok, status, message) {
  try {
    const { recordTokenEvent } = require('./tokenEvents');
    recordTokenEvent({
      serverUrl: server.url || '',
      userId: server.userId || null,
      label: server.label || null,
      ok,
      status: status != null ? status : null,
      message: message || null,
    });
  } catch (e) { console.warn('[auth] token event record failed:', e.message); }
}

async function _doReauthenticate(server) {
  if (!server.username || !server.password) {
    _recordReauth(server, false, null, 'missing username/password');
    return false;
  }
  const label = server.label || server.url || 'server';
  console.log(`[${label}] API key expired — re-authenticating automatically...`);
  const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-auto-auth", Version="1.0.0"';
  const baseUrl = server.url.replace(/\/+$/, '');
  const authPaths = [
    `${baseUrl}/Users/AuthenticateByName`,
    `${baseUrl}/emby/Users/AuthenticateByName`,
    `${baseUrl}/mediabrowser/Users/AuthenticateByName`,
  ];
  try {
    for (const authUrl of authPaths) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      let resp;
      try {
        resp = await fetch(authUrl, {
          method: 'POST',
          agent: safeAgent,
          follow: SAFE_REDIRECT_LIMIT,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
            'X-Emby-Authorization': authHeader,
            'User-Agent': BROWSER_UA,
          },
          body: JSON.stringify({ Username: server.username, Pw: server.password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (resp.status === 401 || resp.status === 403) {
        console.error(`[${label}] Re-auth failed: HTTP ${resp.status}`);
        _recordReauth(server, false, resp.status, 'auth rejected');
        return false;
      }
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.AccessToken) {
        tokenCache.set(tokenKey(server), { token: data.AccessToken, ts: Date.now() });
        saveTokenCache();
        console.log(`[${label}] Re-authenticated successfully ✓`);
        _recordReauth(server, true, 200, 'access token renewed');
        return true;
      }
    }
  } catch (err) {
    console.error(`[${label}] Re-auth error:`, err.message);
    _recordReauth(server, false, null, err.message);
  }
  _recordReauth(server, false, null, 'all auth paths failed');
  return false;
}

// ─── Server-aware fetch with auto-retry on 401 ───────────────────────────────

async function apiFetch(server, buildUrl, timeoutMs = server._timeout || 10000) {
  const attempt = async () => {
    const url = buildUrl();
    appendAuth(url, server);
    const headers = authHeaders(server);
    return fetchWithTimeout(url.toString(), timeoutMs, { headers });
  };
  try {
    return await attempt();
  } catch (err) {
    if (err.status === 401 && await reauthenticate(server)) {
      return await attempt();
    }
    throw err;
  }
}

async function pingServer(server) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${server.url}/System/Ping`, { agent: safeAgent, follow: SAFE_REDIRECT_LIMIT, headers: { 'User-Agent': BROWSER_UA }, signal: controller.signal });
      if (!resp.ok) return null;
    } finally { clearTimeout(timer); }
    return Date.now() - t0;
  } catch { return null; }
}

function buildStreamUrl(server, itemId, sourceId, container) {
  const ext = container ? `.${container.toLowerCase()}` : '';
  const key = getEffectiveApiKey(server);
  if (server.type === 'jellyfin') {
    let url = `${server.url}/Videos/${itemId}/stream${ext}?Static=true`;
    if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
    url += `&api_key=${key}`;
    return url;
  }
  let url = `${server.url}/Videos/${itemId}/stream${ext}?api_key=${key}&Static=true`;
  if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
  return url;
}

module.exports = {
  tokenCache,
  getEffectiveApiKey,
  fetchWithTimeout,
  authHeaders,
  appendAuth,
  reauthenticate,
  apiFetch,
  pingServer,
  buildStreamUrl,
  saveTokenCache,
  BROWSER_UA,
};
