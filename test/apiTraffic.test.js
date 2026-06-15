'use strict';
const assert = require('assert');
const { recordCall, getCachedBody, setCachedBody, getSnapshot, clear, serverHost } = require('../lib/apiTraffic');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  clear();

  A(serverHost('https://emby.example.com:8096/emby') === 'emby.example.com:8096', 'serverHost parses URL');

  recordCall({ host: 'a.example', label: 'Server A', path: '/System/Info', cached: false, status: 200, ms: 12, ok: true });
  recordCall({ host: 'a.example', label: 'Server A', path: '/Items/1/PlaybackInfo', cached: true, status: 200, ms: 1, ok: true });
  recordCall({ host: 'b.example', label: 'Server B', path: '/System/Ping', cached: false, status: null, ms: 50, ok: false });

  const snap = getSnapshot();
  A(snap.calls.length === 3, 'ring buffer has 3 entries');
  A(snap.byServer.length === 2, 'two server hosts tracked');

  const a = snap.byServer.find(s => s.host === 'a.example');
  A(a.total === 2 && a.cached === 1 && a.network === 1 && a.errors === 0, 'Server A counters correct');

  const b = snap.byServer.find(s => s.host === 'b.example');
  A(b.total === 1 && b.network === 1 && b.errors === 1, 'Server B error counted');

  setCachedBody('key1', 'https://x/Items/1', '{"ok":true}');
  A(getCachedBody('key1', 'https://x/Items/1') === '{"ok":true}', 'response cache stores body');
  A(getCachedBody('key1', 'https://x/Items/2') === undefined, 'cache miss on different URL');

  for (let i = 0; i < 110; i++) {
    recordCall({ host: 'z.example', path: `/p/${i}`, cached: false, status: 200, ms: 1, ok: true });
  }
  A(getSnapshot().calls.length <= 100, 'ring buffer caps at 100');

  clear();
  A(getSnapshot().calls.length === 0 && getSnapshot().byServer.length === 0, 'clear resets state');

  console.log('\napiTraffic.test.js: all passed');
})();