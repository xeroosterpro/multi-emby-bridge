// Run with: node test/healthAlerts.test.js
const { isServerDown, detectDownServers, filterSnoozed, normUrl } = require('../lib/healthAlerts');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const now = Date.now();
const hist = (entries) => ({ 'http://a.com': entries });

A(normUrl('http://x.com/') === 'http://x.com', 'normUrl strips trailing slash');

A(!isServerDown(hist([
  { ts: now, up: false },
  { ts: now - 1, up: false },
]), 'http://a.com', 3), 'not down with only 2 failures');

A(isServerDown(hist([
  { ts: now, up: false },
  { ts: now - 1, up: false },
  { ts: now - 2, up: false },
]), 'http://a.com/', 3), 'down after 3 consecutive failures');

A(!isServerDown(hist([
  { ts: now, up: false },
  { ts: now - 1, up: true },
  { ts: now - 2, up: false },
]), 'http://a.com', 3), 'not down when middle entry is up');

const down = detectDownServers({
  'http://eagle.com': [
    { ts: now, up: false, label: 'Eagle' },
    { ts: now - 300000, up: false },
    { ts: now - 600000, up: false },
  ],
  'http://backup.com': [
    { ts: now, up: true },
    { ts: now - 300000, up: false },
  ],
}, [
  { url: 'http://eagle.com/', label: 'Eagle 4K' },
  { url: 'http://backup.com', label: 'Backup' },
], { consecutive: 3 });

A(down.length === 1 && down[0].label === 'Eagle 4K', 'detectDownServers returns only fully-down servers');
A(down[0].failures === 3, 'failures count matches consecutive threshold');

const snoozed = filterSnoozed(down, { 'http://eagle.com': new Date(Date.now() + 3600000).toISOString() });
A(snoozed.length === 0, 'filterSnoozed hides snoozed servers');

const expired = filterSnoozed(down, { 'http://eagle.com': new Date(Date.now() - 1000).toISOString() });
A(expired.length === 1, 'filterSnoozed shows expired snooze');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);