// Run with: node test/adminStats.test.js
const { summarizeRequestLog, userActivity } = require('../lib/adminStats');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const NOW = 1_000_000_000_000;
const ago = ms => new Date(NOW - ms).toISOString();
const log = [
  { userId: 'u1', ts: ago(1000),       contentName: 'Dune',   bestServer: 'ARCTV',  type: 'movie', ms: 300, found: true },
  { userId: 'u1', ts: ago(2*86400000), contentName: 'Dune',   bestServer: 'ARCTV',  type: 'movie', ms: 320, found: true },
  { userId: 'u2', ts: ago(5000),       contentName: 'Heat',   bestServer: 'EAGLE',  type: 'movie', ms: 500, found: true },
  { userId: null, ts: ago(8*86400000), contentName: 'Old',    bestServer: 'BK',     type: 'movie', ms: 100, found: false },
];

(async () => {
  const s = summarizeRequestLog(log, { now: NOW });
  A(s.requests24h === 2, '24h count excludes the 2-day and 8-day old entries');
  A(s.requests7d === 3, '7d count includes the 2-day old, excludes the 8-day old');
  A(s.topTitles[0].title === 'Dune' && s.topTitles[0].count === 1, 'top title (24h) is Dune x1');
  A(s.busiestServer && s.busiestServer.server === 'ARCTV', 'busiest server (24h) is ARCTV');

  const a = userActivity(log, 'u1', { now: NOW });
  A(a.recent.length === 2, 'userActivity returns only u1 entries');
  A(a.recent[0].title === 'Dune' && a.recent[0].server === 'ARCTV', 'recent maps title+server');
  A(a.totals.requests24h === 1 && a.totals.requests7d === 2, 'per-user 24h/7d totals correct');
  A(a.totals.lastActive === log[0].ts, 'lastActive is the newest u1 entry ts');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
