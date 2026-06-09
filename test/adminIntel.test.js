// Run with: node test/adminIntel.test.js
const {
  serverIntelKey,
  normUrl,
  getDataDictionary,
  TOKEN_TTL,
} = require('../lib/adminIntel');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

A(normUrl('https://host/emby/') === 'https://host/emby', 'normUrl strips slash');
A(serverIntelKey({ url: 'https://a', userId: 'u1' }) === 'https://a|u1', 'serverIntelKey');

const dict = getDataDictionary();
A(dict.categories && dict.categories.length >= 5, 'data dictionary has categories');
A(dict.categories.some(c => c.id === 'tokens'), 'dictionary includes tokens');
A(dict.categories.some(c => c.id === 'unavailable'), 'dictionary includes unavailable');

A(TOKEN_TTL === 12 * 60 * 60 * 1000, 'token TTL 12h');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);