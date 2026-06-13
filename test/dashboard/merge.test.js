'use strict';

function mergeDashboardBundles(prev, next) {
  if (!next) return prev;
  const scope = next.scope || 'full';
  if (scope === 'full') return next;
  if (!prev) return null;

  const out = {
    ...prev,
    ts: next.ts || Date.now(),
    scope,
    errors: [...(prev.errors || []), ...(next.errors || [])].slice(-24),
    hasServers: next.hasServers ?? prev.hasServers,
    serverCount: next.serverCount ?? prev.serverCount,
    servers: (next.servers?.length ? next.servers : prev.servers) || [],
    totals: prev.totals ? { ...prev.totals } : prev.totals,
    connections: prev.connections || [],
    library: prev.library || [],
    live: prev.live || [],
    liveProbes: prev.liveProbes || [],
    recent: prev.recent || [],
    health: prev.health || [],
  };

  if (scope === 'live') {
    out.live = next.live ?? prev.live ?? [];
    out.liveProbes = next.liveProbes ?? prev.liveProbes ?? [];
    out.recent = next.recent ?? prev.recent ?? [];
  }
  if (scope === 'stats') {
    out.connections = next.connections ?? prev.connections ?? [];
    out.library = next.library ?? prev.library ?? [];
    out.totals = next.totals || prev.totals;
  }
  if (scope === 'health') {
    out.health = next.health ?? prev.health ?? [];
  }
  return out;
}

const full = {
  scope: 'full',
  ts: 1000,
  totals: { serversUp: 6, movies: 270196, shows: 108179 },
  connections: [{ url: 'https://a', ok: true }],
  library: [{ url: 'https://a', ok: true, movies: 100 }],
  live: [{ title: 'A' }],
  liveProbes: [{ server: 'A', ok: true }],
  recent: [{ title: 'R' }],
  health: [{ url: 'https://a', history: [{ up: true }] }],
  errors: [],
};

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

test('health scope keeps totals and library', () => {
  const merged = mergeDashboardBundles(full, {
    scope: 'health',
    ts: 2000,
    totals: { serversUp: 0, movies: 0, shows: 0 },
    connections: [],
    library: [],
    live: [],
    recent: [],
    health: [{ url: 'https://a', history: [{ up: true }, { up: true }] }],
  });
  if (merged.totals.movies !== 270196) throw new Error(`movies ${merged.totals.movies}`);
  if (merged.library.length !== 1) throw new Error('library cleared');
  if (merged.health[0].history.length !== 2) throw new Error('health not updated');
});

test('live scope keeps totals and updates recent', () => {
  const merged = mergeDashboardBundles(full, {
    scope: 'live',
    ts: 3000,
    totals: { serversUp: 0, movies: 0 },
    connections: [],
    library: [],
    live: [{ title: 'B' }],
    liveProbes: [{ server: 'B', ok: true }],
    recent: [{ title: 'New' }],
    health: [],
  });
  if (merged.totals.movies !== 270196) throw new Error('totals wiped');
  if (merged.recent[0].title !== 'New') throw new Error('recent not updated');
  if (merged.library.length !== 1) throw new Error('library cleared');
});

test('partial scope without prev returns null', () => {
  const merged = mergeDashboardBundles(null, { scope: 'health', ts: 1, health: [] });
  if (merged !== null) throw new Error('expected null');
});

test('stats scope updates library and totals', () => {
  const merged = mergeDashboardBundles(full, {
    scope: 'stats',
    ts: 4000,
    connections: [{ url: 'https://b', ok: true }],
    library: [{ url: 'https://b', ok: true, movies: 200 }],
    totals: { serversUp: 5, movies: 300000, shows: 120000 },
  });
  if (merged.totals.movies !== 300000) throw new Error('totals not updated');
  if (merged.library[0].movies !== 200) throw new Error('library not updated');
  if (merged.live[0].title !== 'A') throw new Error('live cleared');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);