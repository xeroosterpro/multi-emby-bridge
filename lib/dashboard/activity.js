const {
  enrichRecentEntries,
  dedupeRecentByContent,
  mergeActivityHistory,
  mergeLiveIntoRecent,
} = require('../activityEnrich');
const { fetchServerWatchHistory } = require('../serverWatchHistory');
const { attachBridgeLive } = require('../bridgeLive');
const { filterLiveServers } = require('./servers');

const WATCH_HIST_CACHE_MS = 90000;
const _watchHistCache = new Map();

async function getCachedServerWatch(userId, servers, quick) {
  const hit = _watchHistCache.get(userId);
  if (hit && Date.now() - hit.at < WATCH_HIST_CACHE_MS) return hit.entries;
  const entries = await fetchServerWatchHistory(servers, {
    timeoutMs: quick ? 8000 : 5500,
    limitPerEndpoint: 20,
  });
  _watchHistCache.set(userId, { at: Date.now(), entries });
  return entries;
}

function clearWatchCache(userId) {
  if (userId) _watchHistCache.delete(userId);
  else _watchHistCache.clear();
}

async function buildActivityRecent(userId, cfg, requestLog, opts = {}) {
  const quick = opts.quick !== false;
  const servers = filterLiveServers(cfg);
  if (!servers.length) {
    return { servers, rawRecent: [], recent: [] };
  }

  const labels = new Set();
  servers.forEach(s => { if (s.label) labels.add(s.label.trim()); });

  const filtered = (await requestLog.forUser(userId, 80))
    .filter(e => !e.server || labels.has(e.server)
      || (e.serverStatus || []).some(s => labels.has(s.label)));
  const bridgeRecent = dedupeRecentByContent(filtered);

  let serverWatch = [];
  try {
    serverWatch = await getCachedServerWatch(userId, servers, quick);
  } catch (e) {
    console.error('[dashboard/activity:serverWatch]', e.message);
  }

  const rawRecent = mergeActivityHistory(bridgeRecent, serverWatch, { limit: 30 });
  return { servers, rawRecent, recent: rawRecent };
}

async function buildActivityBundle(userId, cfg, requestLog, liveData, opts = {}) {
  const { servers, rawRecent } = await buildActivityRecent(userId, cfg, requestLog, opts);
  let live = liveData?.live || [];
  let liveProbes = liveData?.liveProbes || [];

  if (!live.length && rawRecent.length) {
    live = attachBridgeLive([], rawRecent);
  }

  let recent = rawRecent;
  if (servers.length) {
    recent = enrichRecentEntries(rawRecent, live);
    recent = mergeLiveIntoRecent(recent, live, { limit: 30 });
  }

  return {
    servers,
    live,
    liveProbes,
    recent,
    hasServers: servers.length > 0,
    serverCount: servers.length,
  };
}

module.exports = {
  WATCH_HIST_CACHE_MS,
  getCachedServerWatch,
  clearWatchCache,
  buildActivityRecent,
  buildActivityBundle,
};