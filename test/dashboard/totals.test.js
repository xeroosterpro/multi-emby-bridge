const assert = require('assert');
const { computeTotals, monthlyCost } = require('../../lib/dashboard/totals');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

A(monthlyCost(12, 'month') === 12, 'monthly cost passthrough');
A(monthlyCost(120, 'year') === 10, 'yearly cost converts to monthly');
A(monthlyCost(0, 'month') === 0, 'zero cost');

const totals = computeTotals({
  servers: [
    { cost: 10, costPeriod: 'month' },
    { cost: 120, costPeriod: 'year' },
  ],
  connections: [
    { ok: true, bridgeMs: 80 },
    { ok: true, bridgeMs: 42 },
    { ok: false },
  ],
  library: [
    { ok: true, movies: 100, shows: 20, episodes: 500 },
    { ok: true, movies: 50, shows: 10, episodes: 200 },
    { ok: false },
  ],
  health: [{ url: 'https://a' }, { url: 'https://b' }],
});

A(totals.serversUp === 2, 'serversUp from connections');
A(totals.serversTotal === 2, 'serversTotal from server list');
A(totals.movies === 150, 'movies summed from ok library rows');
A(totals.shows === 30, 'shows summed');
A(totals.episodes === 700, 'episodes summed');
A(totals.fastestBridgeMs === 42, 'fastest bridge ms');
A(totals.costMonthly === 20, 'cost monthly rollup');
A(totals.healthTargets === 2, 'health target count');

console.log('\ndashboard/totals.test.js: all passed');