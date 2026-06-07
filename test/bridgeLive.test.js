// Run with: node test/bridgeLive.test.js
const {
  inferLiveFromRecent,
  mergeLiveSources,
  attachBridgeLive,
} = require('../lib/bridgeLive');

let passed = 0;
let failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const now = Date.now();
const recent = [
  { title: 'Dune', server: 'ARCTV', found: true, ts: new Date(now - 60000).toISOString() },
  { title: 'Old Movie', server: 'BK', found: true, ts: new Date(now - 20 * 60000).toISOString() },
  { title: 'Ghost', server: 'X', found: false, ts: new Date(now - 30000).toISOString() },
];

const inferred = inferLiveFromRecent(recent, { maxAgeMs: 10 * 60000 });
A(inferred.length === 1 && inferred[0].server === 'ARCTV', 'infers recent bridge playback');
A(inferred[0].source === 'bridge', 'marks bridge source');

const merged = mergeLiveSources([
  [{ server: 'Milkyway', title: 'Oppenheimer', source: 'sessions', client: 'Stremio' }],
  [{ server: 'ARCTV', title: 'Dune', source: 'bridge', client: 'Stremio' }],
]);
A(merged.length === 2, 'merge keeps distinct titles');
A(merged.some(s => s.source === 'sessions'), 'sessions row kept');

const deduped = mergeLiveSources([
  [{ server: 'ARCTV', title: 'Dune', source: 'sessions', client: 'Stremio' }],
  [{ server: 'ARCTV', title: 'Dune', source: 'bridge', client: 'Stremio' }],
]);
A(deduped.length === 1 && deduped[0].source === 'sessions', 'sessions beats bridge duplicate');

const attached = attachBridgeLive([], recent, { maxAgeMs: 10 * 60000 });
A(attached.length === 1, 'attachBridgeLive fills gaps');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);