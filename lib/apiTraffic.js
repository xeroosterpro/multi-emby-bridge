// ─── In-memory outbound API traffic tracker ───────────────────────────────────
const { getClientIdentity, SHIELD_UA, EMBY_CLIENT_HEADER } = require('./embyClient');
const { getStats: getCacheStats, clearAll: clearEmbyCache } = require('./embyCache');
const { getPacingStats, resetPacingStats } = require('./requestPacer');

const MAX_LOG = 100;
const CATEGORY_ORDER = ['stream', 'health', 'auth', 'session', 'activity', 'other'];

const calls = [];
const byServer = new Map();
const byCategory = new Map();

function serverHost(url) {
  try { return new URL(url).host; } catch { return String(url || 'unknown'); }
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

function recordCall({
  host, label = null, path = '/', query = '', cached = false, status = null,
  ms = null, ok = true, source = null,
}) {
  const h = host || 'unknown';
  const meta = classifyPath(path, query);
  const src = source || (cached ? 'cache-L1' : 'live');
  calls.unshift({
    ts: Date.now(),
    host: h,
    label: label || h,
    path: path || '/',
    query: query || '',
    cached: !!cached,
    source: src,
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

function recordCacheHit(tier, purpose) {
  calls.unshift({
    ts: Date.now(),
    host: '—',
    label: '—',
    path: '—',
    query: '',
    cached: true,
    source: `cache-${tier}`,
    status: 200,
    ms: 0,
    ok: true,
    category: 'stream',
    purpose: purpose || `Cache hit (${tier})`,
    essential: true,
  });
  if (calls.length > MAX_LOG) calls.length = MAX_LOG;
  let row = byCategory.get('stream');
  if (!row) {
    row = { category: 'stream', count: 0, cached: 0, network: 0, errors: 0 };
    byCategory.set('stream', row);
  }
  row.count++;
  row.cached++;
}

function getSnapshot() {
  const identity = getClientIdentity();
  const cats = [...byCategory.values()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category);
    const bi = CATEGORY_ORDER.indexOf(b.category);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return {
    ua: SHIELD_UA,
    embyClient: EMBY_CLIENT_HEADER,
    clientIdentity: {
      ...identity,
      sampleHeaders: [
        `User-Agent: ${identity.ua}`,
        `X-Emby-Client: ${identity.client}`,
        `X-Emby-Device-Name: ${identity.deviceName}`,
        `X-Emby-Device-Id: ${identity.deviceId}`,
        `X-Emby-Client-Version: ${identity.clientVersion}`,
      ],
    },
    cacheTiers: getCacheStats(),
    cacheTtlMs: 60 * 60 * 1000,
    streamCacheTtlMs: 60 * 60 * 1000,
    pacing: getPacingStats(),
    byServer: [...byServer.values()].sort((a, b) => b.total - a.total),
    byCategory: cats,
    calls: calls.slice(),
  };
}

function clear() {
  calls.length = 0;
  byServer.clear();
  byCategory.clear();
  clearEmbyCache();
  resetPacingStats();
}

module.exports = {
  SHIELD_UA,
  EMBY_CLIENT_HEADER,
  CATEGORY_ORDER,
  serverHost,
  classifyPath,
  recordCall,
  recordCacheHit,
  getSnapshot,
  clear,
};