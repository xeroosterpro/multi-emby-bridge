// ─── In-memory outbound API traffic tracker + short response cache ───────────
const { makeLruCache } = require('./lruCache');

const SHIELD_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 CrKey/1.56.500000';
const EMBY_CLIENT_HEADER = 'MediaBrowser Client="Emby for Android", Device="NVIDIA SHIELD Android TV", DeviceId="shield-tv", Version="4.8.0.0"';

const CACHE_TTL_MS = 45_000;
const MAX_LOG = 100;
const CATEGORY_ORDER = ['stream', 'health', 'auth', 'session', 'activity', 'other'];
const responseCache = makeLruCache({ max: 128, ttlMs: CACHE_TTL_MS });

const calls = [];
const byServer = new Map();
const byCategory = new Map();

function serverHost(url) {
  try { return new URL(url).host; } catch { return String(url || 'unknown'); }
}

function classifyPath(path) {
  const p = String(path || '/');
  if (/AuthenticateByName/i.test(p)) {
    return { category: 'auth', purpose: 'Token renewal', essential: false };
  }
  if (/\/System\/Info$/i.test(p) || /\/System\/Ping$/i.test(p)) {
    return { category: 'health', purpose: 'Server reachability check', essential: false };
  }
  if (/\/PlaybackInfo/i.test(p)) {
    return { category: 'stream', purpose: 'Stream source lookup', essential: true };
  }
  if (/\/Items\/Resume/i.test(p) || /\/PlayedItems/i.test(p)) {
    return { category: 'activity', purpose: 'Watch history sync', essential: false };
  }
  if (/\/Sessions/i.test(p)) {
    return { category: 'session', purpose: 'Live session probe', essential: false };
  }
  if (/\/Items/i.test(p) || /\/Search/i.test(p)) {
    return { category: 'stream', purpose: 'Library / search lookup', essential: true };
  }
  return { category: 'other', purpose: 'Generic API call', essential: false };
}

function bumpServer(host, label, field, incTotal = true) {
  let row = byServer.get(host);
  if (!row) {
    row = { host, label: label || host, total: 0, cached: 0, network: 0, errors: 0 };
    byServer.set(host, row);
  }
  if (label && row.label === row.host) row.label = label;
  row[field] = (row[field] || 0) + 1;
  if (incTotal) row.total = (row.total || 0) + 1;
}

function bumpCategory(category, cached, ok) {
  let row = byCategory.get(category);
  if (!row) {
    row = { category, count: 0, cached: 0, network: 0, errors: 0 };
    byCategory.set(category, row);
  }
  row.count = (row.count || 0) + 1;
  if (cached) row.cached = (row.cached || 0) + 1;
  else row.network = (row.network || 0) + 1;
  if (!ok) row.errors = (row.errors || 0) + 1;
}

function recordCall({ host, label = null, path = '/', cached = false, status = null, ms = null, ok = true }) {
  const h = host || 'unknown';
  const meta = classifyPath(path);
  calls.unshift({
    ts: Date.now(),
    host: h,
    label: label || h,
    path: path || '/',
    cached: !!cached,
    status,
    ms,
    ok: !!ok,
    category: meta.category,
    purpose: meta.purpose,
    essential: meta.essential,
  });
  if (calls.length > MAX_LOG) calls.length = MAX_LOG;
  bumpServer(h, label, cached ? 'cached' : 'network');
  if (!ok) bumpServer(h, label, 'errors', false);
  bumpCategory(meta.category, !!cached, !!ok);
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
  const cats = [...byCategory.values()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return {
    ua: SHIELD_UA,
    embyClient: EMBY_CLIENT_HEADER,
    cacheTtlMs: CACHE_TTL_MS,
    byServer: [...byServer.values()].sort((a, b) => b.total - a.total),
    byCategory: cats,
    calls: calls.slice(),
  };
}

function clear() {
  calls.length = 0;
  byServer.clear();
  byCategory.clear();
  responseCache.clear();
}

module.exports = {
  SHIELD_UA,
  EMBY_CLIENT_HEADER,
  CATEGORY_ORDER,
  serverHost,
  classifyPath,
  recordCall,
  getCachedBody,
  setCachedBody,
  getSnapshot,
  clear,
};