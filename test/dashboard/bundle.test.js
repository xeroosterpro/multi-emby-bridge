const assert = require('assert');
const serverWatch = require('../../lib/serverWatchHistory');
const connections = require('../../lib/dashboard/connections');
const library = require('../../lib/dashboard/library');
const { clearWatchCache } = require('../../lib/dashboard/activity');

serverWatch.fetchServerWatchHistory = async () => [];
clearWatchCache();
const { buildDashboardBundle } = require('../../lib/dashboard/bundle');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

const mockServers = [
  {
    url: 'https://emby1.example.com',
    label: 'NAS',
    type: 'emby',
    apiKey: 'k1',
    userId: 'u1',
    enabled: true,
    cost: 5,
    costPeriod: 'month',
  },
  {
    url: 'https://jelly.example.com',
    label: 'Cloud',
    type: 'jellyfin',
    apiKey: 'k2',
    userId: 'u2',
    enabled: true,
  },
];

const mockCfg = { servers: mockServers };

const mockUc = {
  async getForServe() { return mockCfg; },
};

const mockRequestLog = {
  async forUser() {
    return [
      {
        title: 'Dune',
        server: 'NAS',
        ts: new Date().toISOString(),
        serverStatus: [{ label: 'NAS', status: 'found' }],
      },
    ];
  },
};

const mockLiveSessions = {
  async forUserDetailed() {
    return {
      live: [{ title: 'Live Show', server: 'Cloud', source: 'sessions' }],
      probes: [{ server: 'Cloud', ok: true, count: 1, ms: 40, error: null, method: 'sessions' }],
    };
  },
};

let connCalls = 0;
let libCalls = 0;

connections.fetchConnections = async (servers) => {
  connCalls++;
  return servers.map(s => ({ url: s.url, label: s.label, ok: true, bridgeMs: 50 }));
};
library.fetchLibraryBatch = async (servers) => {
  libCalls++;
  return servers.map(s => ({
    url: s.url, label: s.label, ok: true, movies: 10, shows: 2, episodes: 20,
  }));
};

(async () => {
  const health = await buildDashboardBundle({
    userId: 'test-user',
    scope: 'health',
    uc: mockUc,
    requestLog: mockRequestLog,
    healthHistory: {},
    healthServers: [],
    liveSessions: mockLiveSessions,
  });
  A(health.scope === 'health', 'health scope echoed');
  A(Array.isArray(health.health), 'health rows present');
  A(connCalls === 0, 'health scope skips connections');
  A(libCalls === 0, 'health scope skips library');

  const live = await buildDashboardBundle({
    userId: 'test-user',
    scope: 'live',
    uc: mockUc,
    requestLog: mockRequestLog,
    healthHistory: {},
    healthServers: [],
    liveSessions: mockLiveSessions,
  });
  A(live.scope === 'live', 'live scope echoed');
  A(Array.isArray(live.live), 'live sessions present');
  A(live.live.length >= 1, 'live has sessions');
  A(Array.isArray(live.recent), 'recent activity present');

  const stats = await buildDashboardBundle({
    userId: 'test-user',
    scope: 'stats',
    uc: mockUc,
    requestLog: mockRequestLog,
    healthHistory: {},
    healthServers: [],
    liveSessions: mockLiveSessions,
  });
  A(stats.connections.length === 2, 'stats fetches connections');
  A(stats.library.length === 2, 'stats fetches library');
  A(stats.totals.movies === 20, 'stats totals computed');

  const full = await buildDashboardBundle({
    userId: 'test-user',
    scope: 'full',
    uc: mockUc,
    requestLog: mockRequestLog,
    healthHistory: {},
    healthServers: [],
    liveSessions: mockLiveSessions,
  });
  A(full.scope === 'full', 'full scope echoed');
  A(full.totals.serversUp === 2, 'full bundle totals');
  A(full.live.length >= 1, 'full includes live');
  A(full.library.length === 2, 'full includes library');
  A(Array.isArray(full.errors), 'errors array present');

  console.log('\ndashboard/bundle.test.js: all passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});