const { attachBridgeLive } = require('../bridgeLive');
const { makeLiveSessions } = require('../sessions');

const LIVE_DETAIL_CACHE_MS = 15000;

const _liveDetailCache = new Map();

function mapLiveProbes(probes) {
  return (probes || []).map(p => ({
    server: p.server,
    ok: !!p.ok,
    count: p.count || 0,
    ms: p.ms || 0,
    error: p.error || null,
    method: p.method || null,
  }));
}

async function loadLiveForUser(userId, servers, recentForBridge, liveSessions) {
  if (!servers.length) return { live: [], liveProbes: [] };

  const hit = _liveDetailCache.get(userId);
  if (hit && Date.now() - hit.at < LIVE_DETAIL_CACHE_MS) {
    return hit.data;
  }

  const detailed = await liveSessions.forUserDetailed(servers);
  let live = detailed.live || [];
  if (!live.length && Array.isArray(recentForBridge) && recentForBridge.length) {
    live = attachBridgeLive(live, recentForBridge);
  }
  const data = {
    live,
    liveProbes: mapLiveProbes(detailed.probes),
  };
  _liveDetailCache.set(userId, { at: Date.now(), data });
  return data;
}

function clearLiveCache(userId) {
  if (userId) _liveDetailCache.delete(userId);
  else _liveDetailCache.clear();
}

module.exports = {
  LIVE_DETAIL_CACHE_MS,
  mapLiveProbes,
  loadLiveForUser,
  clearLiveCache,
  makeLiveSessions,
};