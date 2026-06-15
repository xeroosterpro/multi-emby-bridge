// ─── In-memory outbound API traffic tracker + short response cache ───────────
const { makeLruCache } = require('./lruCache');

const SHIELD_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 CrKey/1.56.500000';
const EMBY_CLIENT_HEADER = 'MediaBrowser Client="Emby for Android", Device="NVIDIA SHIELD Android TV", DeviceId="shield-tv", Version="4.8.0.0"';

const CACHE_TTL_MS = 45_000;
const MAX_LOG = 100;
const responseCache = makeLruCache({ max: 128, ttlMs: CACHE_TTL_MS });

const calls = [];
const byServer = new Map(); // host -> { host, label, total, cached, network, errors }

function serverHost(url) {
  try { return new URL(url).host; } catch { return String(url || 'unknown'); }
}

function bump(host, label, field, incTotal = true) {
  let row = byServer.get(host);
  if (!row) {
    row = { host, label: label || host, total: 0, cached: 0, network: 0, errors: 0 };
    byServer.set(host, row);
  }
  if (label && row.label === row.host) row.label = label;
  row[field] = (row[field] || 0) + 1;
  if (incTotal) row.total = (row.total || 0) + 1;
}

function recordCall({ host, label = null, path = '/', cached = false, status = null, ms = null, ok = true }) {
  const h = host || 'unknown';
  calls.unshift({
    ts: Date.now(),
    host: h,
    label: label || h,
    path: path || '/',
    cached: !!cached,
    status,
    ms,
    ok: !!ok,
  });
  if (calls.length > MAX_LOG) calls.length = MAX_LOG;
  bump(h, label, cached ? 'cached' : 'network');
  if (!ok) bump(h, label, 'errors', false);
}

function cacheKey(serverKey, url) {
  return `${serverKey}|${url}`;
}

function getCachedBody(serverKey, url) {
  return responseCache.get(cacheKey(serverKey, url));
}

function setCachedBody(serverKey, url, body) {
  responseCache.set(cacheKey(serverKey, url), body);
}

function getSnapshot() {
  return {
    ua: SHIELD_UA,
    embyClient: EMBY_CLIENT_HEADER,
    cacheTtlMs: CACHE_TTL_MS,
    byServer: [...byServer.values()].sort((a, b) => b.total - a.total),
    calls: calls.slice(),
  };
}

function clear() {
  calls.length = 0;
  byServer.clear();
  responseCache.clear();
}

module.exports = {
  SHIELD_UA,
  EMBY_CLIENT_HEADER,
  serverHost,
  recordCall,
  getCachedBody,
  setCachedBody,
  getSnapshot,
  clear,
};