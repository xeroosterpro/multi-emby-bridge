'use strict';
const assert = require('assert');
const {
  classifyPath, recordCall, getCachedBody, setCachedBody, getSnapshot, clear, serverHost,
} = require('../lib/apiTraffic');
const { apiPathVariants, noteApiPathSuccess } = require('../lib/serverPaths');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  clear();

  A(serverHost('https://emby.example.com:8096/emby') === 'emby.example.com:8096', 'serverHost parses URL');

  const resume = classifyPath('/Users/abc/Items/Resume');
  A(resume.category === 'activity' && resume.purpose === 'Watch history sync', 'classify Resume');

  const playback = classifyPath('/Items/tt123/PlaybackInfo');
  A(playback.category === 'stream' && playback.essential === true, 'classify PlaybackInfo');

  const auth = classifyPath('/Users/AuthenticateByName');
  A(auth.category === 'auth', 'classify AuthenticateByName');

  recordCall({ host: 'a.example', label: 'Server A', path: '/System/Info', cached: false, status: 200, ms: 12, ok: true });
  recordCall({ host: 'a.example', label: 'Server A', path: '/Items/1/PlaybackInfo', cached: true, status: 200, ms: 1, ok: true });
  recordCall({ host: 'b.example', label: 'Server B', path: '/System/Ping', cached: false, status: null, ms: 50, ok: false });

  const snap = getSnapshot();
  A(snap.calls.length === 3, 'ring buffer has 3 entries');
  A(snap.calls.some(c => c.purpose === 'Stream source lookup'), 'call row has purpose');
  A(snap.byCategory.length >= 2, 'byCategory aggregated');
  A(snap.byCategory.some(c => c.category === 'stream'), 'stream category present');

  setCachedBody('key1', 'https://x/Items/1', '{"ok":true}');
  A(getCachedBody('key1', 'https://x/Items/1') === '{"ok":true}', 'response cache stores body');

  noteApiPathSuccess('https://host.example.com', '/Users/u1/Items');
  const variants = apiPathVariants('https://host.example.com', '/Users/u1/PlayedItems');
  A(variants.length === 1 && String(variants[0]).endsWith('/Users/u1/PlayedItems'), 'prefix memory skips /emby duplicate');

  clear();
  A(getSnapshot().calls.length === 0, 'clear resets state');

  console.log('\napiTraffic.test.js: all passed');
})();