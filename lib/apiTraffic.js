// ─── In-memory outbound API traffic tracker + short response cache ───────────
const { makeLruCache } = require('./lruCache');

const SHIELD_UA = 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 CrKey/1.56.500000';
const EMBY_CLIENT_HEADER = 'MediaBrowser Client="Emby for Android", Device="NVIDIA SHIELD Android TV", DeviceId="shield-tv", Version="4.8.0.0"';

const CACHE_TTL_MS = 45_000;
const STREAM_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_LOG = 100;
const CATEGORY_ORDER = ['stream', 'health', 'auth', 'session', 'activity', 'other'];
const responseCache = makeLruCache({ max: 128, ttlMs: CACHE_TTL_MS });
const streamResponseCache = makeLruCache({ max: 256, ttlMs: STREAM_CACHE_TTL_MS });

const calls = [];
const byServer = new Map();
const byCategory = new Map();

function serverHost(url) {
  try { return new URL(url).host; } catch { return String(url || 'unknown'); }
}

function isStreamPath(path) {
  const p = String(path || '');
  return /\/PlaybackInfo/i.test(p)
    || /\/Items/i.test(p)
    || /\/Shows\//i.test(p)
    || /\/Episodes/i.test(p);
}

function classifyPath(path, query = '') {
  const p = String(path || '/');
  const q = String(query || '');
  if (/AuthenticateByName/i.test(p)) {
    return { category: 'auth', purpose: 'Renew expired API token', essential: false };
  }
  if (/\/System\/Info$/i.test(p)) {
    return { category: 'health', purpose: 'Configure UI — test server online', essential: false };
  }
  if (/\/System\/Ping$/i.test(p)) {
    return { category: 'health', purpose: 'Latency ping (optional setting)', essential: false };
  }
  if (/\/PlaybackInfo/i.test(p)) {
    return { category: 'stream', purpose: 'Stremio play — read file qualities', essential: true };
  }
  if (/\/Shows\/[^/]+\/Episodes/i.test(p)) {
    return { category: 'stream', purpose: 'Stremio play — list episodes in season', essential: true };
  }
  if (/\/Items\/Resume/i.test(p) || /\/PlayedItems/i.test(p)) {
    return { category: 'activity', purpose: 'Watch history sync (disabled)', essential: false };
  }
  if (/\/Sessions/i.test(p)) {
    return { category: 'session', purpose: 'Live session probe (disabled)', essential: false };
  }
  if (/\/Items/i.test(p)) {
    if (q.includes('ImdbId=')) {
      return { category: 'stream', purpose: 'Stremio play — find title by IMDB ID', essential: true };
    }
    if (q.includes('AnyProviderIdEquals=')) {
      return { category: 'stream', purpose: 'Stremio play — find title by provider ID', essential: true };
    }
    if (q.includes('SearchTerm=')) {
      return { category: 'stream', purpose: 'Stremio play — find title by name (fallback)', essential: true };
    }
    if (q.includes('ParentIndexNumber=') && q.includes('IndexNumber=')) {
      return { category: 'stream', purpose: 'Stremio play — find episode S/E', essential: true };
    }
    return { category: 'stream', purpose: 'Stremio play — library item lookup', essential: true };
  }
  return { category: 'other', purpose: 'Other API call', essential: false };
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

function recordCall({ host, label = null, path = '/', query = '', cached = false, status = null, ms = null, ok = true }) {
  const h = host || 'unknown';
  const meta = classifyPath(path, query);
  calls.unshift({
    ts: Date.now(),
    host: h,
    label: label || h,
    path: path || '/',
    query: query || '',
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

function getCachedBody(serverKey, url, path) {
  const key = cacheKey(serverKey, url);
  if (isStreamPath(path)) return streamResponseCache.get(key);
  return responseCache.get(key);
}

function setCachedBody(serverKey, url, body, path) {
  const key = cacheKey(serverKey, url);
  if (isStreamPath(path)) streamResponseCache.set(key, body);
  else responseCache.set(key, body);
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
    streamCacheTtlMs: STREAM_CACHE_TTL_MS,
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
  streamResponseCache.clear();
}

module.exports = {
  SHIELD_UA,
  EMBY_CLIENT_HEADER,
  CATEGORY_ORDER,
  serverHost,
  classifyPath,
  isStreamPath,
  recordCall,
  getCachedBody,
  setCachedBody,
  getSnapshot,
  clear,
};