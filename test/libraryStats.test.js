const assert = require('assert');
const { findServerEntry } = require('../lib/serverMatch');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function serverMatch() {
  const servers = [
    { label: 'NAS', url: 'https://emby.example.com:8096/emby', apiKey: 'k1', userId: 'u1', enabled: true },
    { label: 'Cloud', url: 'https://cloud.example.com', apiKey: 'k2', userId: 'u2', enabled: true },
  ];
  A(findServerEntry(servers, 'https://emby.example.com:8096/emby/')?.apiKey === 'k1', 'exact normalized URL match');
  A(findServerEntry(servers, 'https://emby.example.com:8096')?.apiKey === 'k1', 'origin-only URL match when unique');
  A(findServerEntry(servers, 'https://other.example.com', 'Cloud')?.apiKey === 'k2', 'label fallback match');
  A(findServerEntry(servers, 'https://missing.example.com') == null, 'no match returns null');
})();

console.log('\nlibraryStats.test.js: all passed');