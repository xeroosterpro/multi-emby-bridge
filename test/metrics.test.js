// ─── Unit tests for lib/metrics.js ──────────────────────────────────────────
// Run with: node test/metrics.test.js

const { snapshot, cpuPercent } = require('../lib/metrics');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { console.log(`  ✓ ${msg}`); passed++; } else { console.error(`  ✗ ${msg}`); failed++; } }

console.log('metrics snapshot');
const s = snapshot();
assert(typeof s.uptimeSec === 'number' && s.uptimeSec >= 0, 'uptimeSec is a non-negative number');
assert(s.rssBytes > 0, 'rssBytes positive');
assert(s.sysMemTotalBytes > 0, 'sysMemTotalBytes positive');
assert(s.sysMemUsedBytes >= 0 && s.sysMemUsedBytes <= s.sysMemTotalBytes, 'used ≤ total memory');
assert(s.sysMemPct >= 0 && s.sysMemPct <= 100, 'sysMemPct in 0..100');
assert(s.cpuCount >= 1, 'cpuCount ≥ 1');
assert(s.cpuPercent >= 0 && s.cpuPercent <= 100, 'cpuPercent in 0..100');

console.log('\ncpuPercent sampling');
// burn a little CPU, then sample
const end = Date.now() + 30; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1);
const p = cpuPercent();
assert(p >= 0 && p <= 100, 'cpuPercent stays within 0..100 after load');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
