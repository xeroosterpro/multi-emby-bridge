// Run with: node test/liveSessions.test.js
const { makeLiveSessions } = require('../lib/sessions');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

// fake fetch: server A returns one playing + one idle session; server B throws; server C returns non-ok
function fakeFetch(url) {
  if (url.includes('//a')) return Promise.resolve({ ok: true, json: async () => ([
    {
      NowPlayingItem: { Name: 'Dune', Type: 'Movie' },
      UserName: 'alice',
      Client: 'Stremio',
      PlayState: { PositionTicks: 90000000000, IsPaused: false, PlayMethod: 'DirectStream' },
    },
    { UserName: 'bob' }, // idle, no NowPlayingItem
  ]) });
  if (url.includes('//b')) return Promise.reject(new Error('unreachable'));
  return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
}

(async () => {
  const ls = makeLiveSessions(fakeFetch);
  const out = await ls.forUser([
    { url: 'http://a', apiKey: 'k', label: 'ARCTV', type: 'emby' },
    { url: 'http://b', apiKey: 'k', label: 'EAGLE', type: 'emby' },
    { url: 'http://c', apiKey: 'k', label: 'BK',    type: 'jellyfin' },
    { url: '',         apiKey: 'k', label: 'NoURL' }, // skipped
  ]);
  A(out.length === 1, 'only the one actively-playing session is returned');
  A(out[0].title === 'Dune' && out[0].server === 'ARCTV', 'maps title + server label');
  A(out[0].user === 'alice' && out[0].client === 'Stremio', 'maps user + client');
  A(out[0].positionTicks === 90000000000 && out[0].isPaused === false, 'maps play state from Sessions API');
  A(out[0].playMethod === 'DirectStream', 'maps play method');
  A((await ls.forUser([])).length === 0, 'empty server list → no sessions');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
