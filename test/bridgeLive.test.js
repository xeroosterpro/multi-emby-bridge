// Run with: node test/bridgeLive.test.js
const {
  inferLiveFromRecent,
  mergeLiveSources,
  attachBridgeLive,
  resolveBridgePlayback,
  suppressReachableBridge,
  DEFAULT_BRIDGE_LIVE_MS,
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

// ─── Tightened freshness window: a stopped stream clears quickly ─────────────
// No stop signal exists (streams go direct to Emby; /Sessions often blocked), so
// the window is the only lever — keep it short so stops don't linger for minutes.
A(DEFAULT_BRIDGE_LIVE_MS === 90 * 1000, 'bridge-live window tightened to 90 seconds');
const staleInfer = inferLiveFromRecent([
  { title: 'Stale Browse', server: 'BK', found: true, ts: new Date(now - 5 * 60000).toISOString() },
]);
A(staleInfer.length === 0, 'default window drops a 5-minute-old lookup');
const twoMinInfer = inferLiveFromRecent([
  { title: 'Stopped 2m ago', server: 'BK', found: true, ts: new Date(now - 2 * 60000).toISOString() },
]);
A(twoMinInfer.length === 0, 'default window drops a 2-minute-old lookup (stopped stream clears)');
const freshInfer = inferLiveFromRecent([
  { title: 'Fresh', server: 'BK', found: true, ts: new Date(now - 60000).toISOString() },
]);
A(freshInfer.length === 1, 'default window keeps a 1-minute-old lookup');

// ─── suppressReachableBridge: bridge yields to ground-truth probes ───────────
// When the browser successfully probed a server and the title isn't in its real
// session list, a bridge-inferred row for that server is a stale browse → drop.
const liveMix = [
  { source: 'sessions', title: 'Real Playback', server: 'BK' },
  { source: 'bridge', title: 'Just Browsed', availableOn: ['BK'], server: 'BK', serverConfirmed: true },
  { source: 'bridge', title: 'On Blocked Box', availableOn: ['Mars'], server: 'Mars' },
];
const probes = [{ server: 'BK', ok: true, count: 1 }]; // Mars never answered
const filtered = suppressReachableBridge(liveMix, probes);
A(filtered.some(s => s.title === 'Real Playback'), 'keeps confirmed session');
A(!filtered.some(s => s.title === 'Just Browsed'), 'drops bridge row on a reachable server (not actually playing)');
A(filtered.some(s => s.title === 'On Blocked Box'), 'keeps bridge row on an unreachable server (legit fallback)');

const noReachable = suppressReachableBridge(liveMix, [{ server: 'BK', ok: false }]);
A(noReachable.length === 3, 'no reachable server → keep all bridge fallbacks');

const unknownSrv = suppressReachableBridge(
  [{ source: 'bridge', title: 'No Server Info' }],
  [{ server: 'BK', ok: true }]
);
A(unknownSrv.length === 1, 'bridge row with unknown server kept as fallback');

const multiCandidate = suppressReachableBridge(
  [{ source: 'bridge', title: 'Two Boxes', availableOn: ['BK', 'Mars'] }],
  [{ server: 'BK', ok: true }] // Mars not probed → not fully ground-truthed
);
A(multiCandidate.length === 1, 'bridge row kept when any candidate server is unreachable');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);