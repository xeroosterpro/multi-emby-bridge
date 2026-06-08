// Run with: node test/healthProbe.test.js
const {
  isPingResponseOk,
  detectionWindowMs,
  detectionWindowMinutes,
  HEALTH_INTERVAL_MS,
  HEALTH_CONSECUTIVE_DOWN,
} = require('../lib/healthProbe');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(isPingResponseOk({ ok: true }), '200 counts as up');
A(!isPingResponseOk({ ok: false }), '502 counts as down');
A(!isPingResponseOk(null), 'null response counts as down');

A(detectionWindowMs(2, 90000) === 180000, '2 checks at 90s = 3 min window');
A(detectionWindowMinutes(2, 90000) === 3, 'detection minutes rounds to 3');
A(HEALTH_CONSECUTIVE_DOWN === 2, 'default consecutive is 2');
A(HEALTH_INTERVAL_MS === 90000, 'default interval is 90s');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);