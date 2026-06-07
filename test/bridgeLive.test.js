// Run with: node test/bridgeLive.test.js
const {
  inferLiveFromRecent,
  mergeLiveSources,
  attachBridgeLive,
  resolveBridgePlayback,
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

const multi = resolveBridgePlayback({
  server: 'ARCTV',
  serverStatus: [
    { label: 'ARCTV', status: 'found' },
    { label: 'Milkyway', status: 'found' },
  ],
});
A(multi.server == null && multi.serverConfirmed === false, 'multi-server does not pick ranked winner');
A(multi.pickedServer === 'ARCTV', 'keeps ranked pick for hint');

const single = resolveBridgePlayback({
  server: 'ARCTV',
  serverStatus: [{ label: 'BK', status: 'found' }],
});
A(single.server === 'BK' && single.serverConfirmed === true, 'single copy is confirmed');

const multiInfer = inferLiveFromRecent([{
  title: 'Triple Audible', server: 'ARCTV', found: true,
  season: 1, episode: 8,
  serverStatus: [
    { label: 'ARCTV', status: 'found' },
    { label: 'Milkyway', status: 'found' },
  ],
  ts: new Date(now - 60000).toISOString(),
}]);
A(multiInfer[0].server == null, 'inferred multi-server has no fake server');
A(multiInfer[0].availableOn.length === 2, 'lists available servers');

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

const titleDedup = mergeLiveSources([
  [{ server: 'Milkyway', title: 'Triple Audible', source: 'sessions', client: 'Stremio' }],
  [{ server: 'ARCTV', title: 'Triple Audible', source: 'bridge', pickedServer: 'ARCTV', client: 'Stremio' }],
]);
A(titleDedup.length === 1 && titleDedup[0].server === 'Milkyway', 'sessions title drops bridge pick on other server');

const attached = attachBridgeLive([], recent, { maxAgeMs: 10 * 60000 });
A(attached.length === 1, 'attachBridgeLive fills gaps');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);