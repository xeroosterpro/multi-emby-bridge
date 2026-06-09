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

A(detectionWindowMs(2, 30000) === 60000, '2 checks at 30s = 1 min window');
A(detectionWindowMinutes(2, 30000) === 1, 'detection minutes rounds to 1');
A(HEALTH_CONSECUTIVE_DOWN === 2, 'default consecutive is 2');
A(HEALTH_INTERVAL_MS === 30000, 'default interval is 30s');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);