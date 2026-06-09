// Run with: node test/adminIntel.test.js
const {
  serverIntelKey,
  normUrl,
  getDataDictionary,
  summarizeProbes,
  makeTTLCache,
  TOKEN_TTL,
} = require('../lib/adminIntel');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(normUrl('https://host/emby/') === 'https://host/emby', 'normUrl strips slash');
A(serverIntelKey({ url: 'https://a', userId: 'u1' }) === 'https://a|u1', 'serverIntelKey');

const dict = getDataDictionary();
A(dict.categories && dict.categories.length >= 5, 'data dictionary has categories');
A(dict.version === 3, 'data dictionary v3');
A(dict.categories.some(c => c.id === 'tokens'), 'dictionary includes tokens');
A(dict.categories.some(c => c.id === 'unavailable'), 'dictionary includes unavailable');
A(dict.categories.flatMap(c => c.fields).every(f => f.status), 'dictionary fields have status');
A(dict.categories.some(c => c.fields.some(f => f.field === 'probes.scheduledTasks')), 'dictionary includes scheduledTasks');

const sumOk = summarizeProbes({
  ping: { ok: true, data: { ms: 12 } },
  systemInfo: { ok: true, data: { version: '1' } },
  broken: { ok: false, error: 'HTTP 403' },
});
A(sumOk.ok === 2 && sumOk.fail === 1 && sumOk.scorePct === 67, 'summarizeProbes score');
A(sumOk.details.length === 3, 'summarizeProbes details');

const cache = makeTTLCache(1000);
cache.set('a', { n: 1 });
A(cache.get('a')?.n === 1, 'TTL cache set/get');
cache.invalidate('a');
A(cache.get('a') === null, 'TTL cache invalidate');

A(TOKEN_TTL === 12 * 60 * 60 * 1000, 'token TTL 12h');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);