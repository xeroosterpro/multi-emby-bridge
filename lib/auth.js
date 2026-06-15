// ─── Authentication, token cache, API fetch helpers ─────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { safeAgent, SAFE_REDIRECT_LIMIT } = require('./urlSafety');
const { makeCircuitBreaker } = require('./circuitBreaker');
const { logger } = require('./logger');
const {
  SHIELD_UA, EMBY_CLIENT_HEADER, serverHost, recordCall,
  getCachedBody, setCachedBody,
} = require('./apiTraffic');
const { noteApiPathSuccess } = require('./serverPaths');

// One breaker shared across stream/health/session probes, keyed by server+user.
// After repeated failures a server is fast-failed for a growing cooldown — this
// is what stops the re-auth storm against dead/stale servers.
const authBreaker = makeCircuitBreaker({
  failureThreshold: 3,
  baseCooldownMs: 30 * 1000,
  maxCooldownMs: 15 * 60 * 1000,
});

const _delay = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransientError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(err.code)) return true;
  if ([502, 503, 504].includes(err.status)) return true;
  return false;
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_CACHE_FILE = path.join(DATA_DIR, 'token-cache.json');

// ─── Auto-renewing API key cache (persisted to disk) ─────────────────────────
const tokenCache = new Map(); // cacheKey(url+userId) → { token, ts }
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours
// Present as NVIDIA Shield Android TV so outbound traffic blends with a set-top client.
const BROWSER_UA = SHIELD_UA;

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
    const headers = { 'User-Agent': SHIELD_UA, ...(options.headers || {}) };
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
  return {
    'X-Emby-Token': key,
    'X-Emby-Authorization': `${EMBY_CLIENT_HEADER}, Token="${key}"`,
  };
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
  const authHeader = EMBY_CLIENT_HEADER;
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
            'User-Agent': SHIELD_UA,
          },
          body: JSON.stringify({ Username: server.username, Pw: server.password }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      recordCall({
        host: serverHost(server.url),
        label: server.label,
        path: '/Users/AuthenticateByName',
        cached: false,
        status: resp?.status ?? null,
        ms: null,
        ok: resp?.ok,
      });
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
  const key = tokenKey(server);
  // Fast-fail while the breaker is open — no network, no re-auth hammering.
  if (!authBreaker.allow(key)) {
    const e = new Error(`circuit open for ${server.label || server.url} (retry in ${Math.round(authBreaker.retryAfterMs(key) / 1000)}s)`);
    e.circuitOpen = true;
    throw e;
  }
  const attempt = async () => {
    const url = buildUrl();
    appendAuth(url, server);
    const urlStr = url.toString();
    const host = serverHost(server.url);
    const label = server.label;
    const path = url.pathname;
    const query = url.search || '';
    const t0 = Date.now();
    const cachedBody = getCachedBody(key, urlStr, path);
    if (cachedBody != null) {
      recordCall({ host, label, path, query, cached: true, status: 200, ms: Date.now() - t0, ok: true });
      noteApiPathSuccess(server.url, path);
      return new fetch.Response(cachedBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const headers = authHeaders(server);
    try {
      const resp = await fetchWithTimeout(urlStr, timeoutMs, { headers });
      const body = await resp.text();
      setCachedBody(key, urlStr, body, path);
      recordCall({ host, label, path, query, cached: false, status: resp.status, ms: Date.now() - t0, ok: true });
      noteApiPathSuccess(server.url, path);
      return new fetch.Response(body, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      recordCall({ host, label, path, query, cached: false, status: err.status || null, ms: Date.now() - t0, ok: false });
      throw err;
    }
  };
  let lastErr;
  for (let tryNum = 0; tryNum < 2; tryNum++) {
    try {
      const resp = await attempt();
      authBreaker.onSuccess(key);
      return resp;
    } catch (err) {
      lastErr = err;
      if (err.status === 401) {
        // Auth expired: re-authenticate once, then retry. Not a transient retry.
        if (await reauthenticate(server)) {
          try { const resp = await attempt(); authBreaker.onSuccess(key); return resp; }
          catch (err2) { lastErr = err2; }
        }
        break;
      }
      // One bounded retry with jittered backoff for clearly-transient failures.
      if (isTransientError(err) && tryNum === 0) {
        await _delay(150 + Math.floor(Math.random() * 200));
        continue;
      }
      break;
    }
  }
  const wasOpen = authBreaker.state(key) === 'open';
  authBreaker.onFailure(key);
  if (!wasOpen && authBreaker.state(key) === 'open') {
    logger.warn({ server: server.label || server.url, retryAfterMs: authBreaker.retryAfterMs(key) }, 'server circuit opened — backing off');
  }
  throw lastErr;
}

async function pingServer(server) {
  const t0 = Date.now();
  const host = serverHost(server.url);
  const label = server.label;
  const path = '/System/Ping';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${server.url}/System/Ping`, { agent: safeAgent, follow: SAFE_REDIRECT_LIMIT, headers: { 'User-Agent': SHIELD_UA }, signal: controller.signal });
      const ms = Date.now() - t0;
      if (!resp.ok) {
        recordCall({ host, label, path, cached: false, status: resp.status, ms, ok: false });
        return null;
      }
      recordCall({ host, label, path, cached: false, status: 200, ms, ok: true });
      return ms;
    } finally { clearTimeout(timer); }
  } catch {
    recordCall({ host, label, path, cached: false, status: null, ms: Date.now() - t0, ok: false });
    return null;
  }
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

function canQueryServer(server) {
  return authBreaker.allow(tokenKey(server));
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
  SHIELD_UA,
  authBreaker,
  canQueryServer,
  isTransientError,
};
