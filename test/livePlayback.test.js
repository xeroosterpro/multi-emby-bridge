// Run with: node test/livePlayback.test.js
const {
  TICKS_PER_SEC,
  liveSessionKey,
  isPlaybackStalled,
  annotateBuffering,
} = require('../lib/livePlayback');

let passed = 0;
let failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const sess = (overrides) => ({
  server: 'Home',
  user: 'alice',
  title: 'Dune',
  client: 'Stremio',
  positionTicks: 100 * TICKS_PER_SEC,
  isPaused: false,
  ...overrides,
});

(() => {
  A(liveSessionKey(sess()) === 'Home|alice|Dune|Stremio', 'session key is stable');

  const prev = { positionTicks: 100 * TICKS_PER_SEC, stallCount: 0, ts: Date.now() };
  A(isPlaybackStalled(prev, sess({ positionTicks: 103 * TICKS_PER_SEC })) === false, 'normal progress is not stalled');
  A(isPlaybackStalled(prev, sess({ positionTicks: 100.5 * TICKS_PER_SEC })) === true, 'tiny progress is stalled');
  A(isPlaybackStalled(prev, sess({ isPaused: true })) === false, 'paused playback is not stalled');
  A(isPlaybackStalled(prev, sess({ positionTicks: null })) === false, 'missing ticks skips stall check');

  const prevMap = new Map();
  const r1 = annotateBuffering([sess()], prevMap);
  A(r1[0].buffering === false && r1[0].stallCount === 0, 'first poll never flags buffering');

  const r2 = annotateBuffering([sess()], prevMap);
  A(r2[0].buffering === false && r2[0].stallCount === 1, 'second stalled poll increments counter');

  const r3 = annotateBuffering([sess()], prevMap);
  A(r3[0].buffering === true && r3[0].stallCount === 2, 'third stalled poll marks buffering');

  const moving = annotateBuffering([sess({ positionTicks: 200 * TICKS_PER_SEC })], prevMap);
  A(moving[0].buffering === false && moving[0].stallCount === 0, 'progress clears stall counter');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();