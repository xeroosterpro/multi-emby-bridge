// ─── Authentication, token cache, API fetch helpers ─────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_CACHE_FILE = path.join(DATA_DIR, 'token-cache.json');

// ─── Auto-renewing API key cache (persisted to disk) ─────────────────────────
const tokenCache = new Map(); // serverUrl → { token, ts }
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours

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
  } catch { /* start fresh */ }
}

function saveTokenCache() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [url, entry] of tokenCache) obj[url] = entry;
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch { /* non-critical */ }
}

// Load on module init
loadTokenCache();

function getEffectiveApiKey(server) {
  const entry = tokenCache.get(server.url);
  if (entry && (Date.now() - entry.ts) < TOKEN_TTL) return entry.token;
  if (entry) tokenCache.delete(server.url); // expired
  return server.apiKey;
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
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

async function reauthenticate(server) {
  if (!server.username || !server.password) return false;
  console.log(`[${server.label}] API key expired — re-authenticating automatically...`);
  try {
    const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-auto-auth", Version="1.0.0"';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch(`${server.url}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'X-Emby-Authorization': authHeader,
        },
        body: JSON.stringify({ Username: server.username, Pw: server.password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      console.error(`[${server.label}] Re-auth failed: HTTP ${resp.status}`);
      return false;
    }
    const data = await resp.json();
    if (data.AccessToken) {
      tokenCache.set(server.url, { token: data.AccessToken, ts: Date.now() });
      saveTokenCache();
      console.log(`[${server.label}] Re-authenticated successfully ✓`);
      return true;
    }
  } catch (err) {
    console.error(`[${server.label}] Re-auth error:`, err.message);
  }
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
    try { await fetch(`${server.url}/System/Ping`, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
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
};
