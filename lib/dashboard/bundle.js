const { parseScope, scopeNeeds } = require('./scopes');
const { mapPool } = require('./mapPool');
const { filterLiveServers, summarizeServers } = require('./servers');
const connectionsMod = require('./connections');
const libraryMod = require('./library');
const { buildHealthRows } = require('./health');
const { buildActivityBundle, buildActivityRecent } = require('./activity');
const { loadLiveForUser, makeLiveSessions } = require('./live');
const { computeTotals } = require('./totals');

const POOL_CONCURRENCY = 3;

async function buildDashboardBundle(ctx) {
  const {
    userId,
    scope: rawScope,
    uc,
    requestLog,
    healthHistory = {},
    healthServers = [],
    liveSessions: liveSessionsIn,
  } = ctx;

  const scope = parseScope(rawScope);
  const errors = [];
  const ts = Date.now();
  const liveSessions = liveSessionsIn || makeLiveSessions();

  let cfg;
  try {
    cfg = await uc.getForServe(userId);
  } catch (e) {
    errors.push({ part: 'config', message: e.message || 'config load failed' });
    return emptyBundle(scope, ts, errors);
  }

  const servers = filterLiveServers(cfg);
  const serverSummaries = summarizeServers(servers);

  let connections = [];
  let library = [];
  let live = [];
  let liveProbes = [];
  let recent = [];
  let health = [];

  const tasks = [];

  if (scopeNeeds(scope, 'health')) {
    tasks.push((async () => {
      try {
        health = buildHealthRows(servers, healthHistory, healthServers);
      } catch (e) {
        errors.push({ part: 'health', message: e.message });
      }
    })());
  }

  if (scope === 'conn' || scopeNeeds(scope, 'stats')) {
    tasks.push((async () => {
      try {
        connections = await connectionsMod.fetchConnections(servers, healthHistory, mapPool);
        for (const row of connections) {
          if (!row.ok && row.error) {
            errors.push({ part: 'connection', server: row.label || row.url, message: row.error });
          }
        }
      } catch (e) {
        errors.push({ part: 'connection', message: e.message });
      }
    })());
  }

  if (scopeNeeds(scope, 'stats')) {
    tasks.push((async () => {
      try {
        library = await libraryMod.fetchLibraryBatch(servers, mapPool);
        for (const row of library) {
          if (!row.ok && row.error) {
            errors.push({ part: 'library', server: row.label || row.url, message: row.error });
          }
        }
      } catch (e) {
        errors.push({ part: 'library', message: e.message });
      }
    })());
  }

  if (scopeNeeds(scope, 'live')) {
    tasks.push((async () => {
      try {
        const { rawRecent } = await buildActivityRecent(userId, cfg, requestLog, { quick: true });
        const liveData = await loadLiveForUser(userId, servers, rawRecent, liveSessions);
        const activity = await buildActivityBundle(userId, cfg, requestLog, liveData, { quick: true });
        live = activity.live;
        liveProbes = activity.liveProbes;
        recent = activity.recent;
      } catch (e) {
        errors.push({ part: 'live', message: e.message });
        console.error('[dashboard/bundle:live]', e.message);
      }
    })());
  }

  await Promise.all(tasks);

  const totals = computeTotals({ servers: serverSummaries, connections, library, health });

  return {
    scope,
    ts,
    hasServers: servers.length > 0,
    serverCount: servers.length,
    servers: serverSummaries,
    connections,
    library,
    live,
    liveProbes,
    recent,
    health,
    totals,
    errors,
  };
}

function emptyBundle(scope, ts, errors) {
  return {
    scope,
    ts,
    hasServers: false,
    serverCount: 0,
    servers: [],
    connections: [],
    library: [],
    live: [],
    liveProbes: [],
    recent: [],
    health: [],
    totals: computeTotals({ servers: [], connections: [], library: [], health: [] }),
    errors,
  };
}

module.exports = { buildDashboardBundle, POOL_CONCURRENCY };