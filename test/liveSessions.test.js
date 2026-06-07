// Run with: node test/liveSessions.test.js
const {
  makeLiveSessions,
  parseLiveSessions,
  formatLiveTitle,
  sessionEndpointUrls,
  fetchServerSessionsDetailed,
} = require('../lib/sessions');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

let fetchCalls = [];
function fakeFetch(url) {
  fetchCalls.push(url);
  if (url.includes('//a') && url.includes('/Sessions')) return Promise.resolve({ ok: true, json: async () => ([
    {
      NowPlayingItem: { Name: 'Dune', Type: 'Movie', RunTimeTicks: 100000000000 },
      UserName: 'alice',
      Client: 'Stremio',
      Id: 'sess-1',
      PlayState: { PositionTicks: 90000000000, IsPaused: false, PlayMethod: 'DirectStream' },
    },
    { UserName: 'bob' },
  ]) });
  if (url.includes('//b')) return Promise.reject(new Error('unreachable'));
  if (url.includes('//c')) return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
  if (url.includes('//sub') && url.includes('/emby/Sessions')) {
    return Promise.resolve({ ok: true, json: async () => ([
      {
        NowPlayingItem: { Name: 'Show', Type: 'Episode', SeriesName: 'Arc', ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 50000000000 },
        UserName: 'zoe', Client: 'Jellyfin', PlayState: { PositionTicks: 10000000000, IsPaused: false },
      },
    ]) });
  }
  if (url.includes('//sub') && url.includes('/Sessions') && !url.includes('/emby/')) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

(async () => {
  A(formatLiveTitle({ Type: 'Episode', SeriesName: 'Breaking Bad', ParentIndexNumber: 1, IndexNumber: 3, Name: 'And the Bag\'s in the River' })
    === 'Breaking Bad S1E3 — And the Bag\'s in the River', 'episode titles include series + ep');

  const paths = sessionEndpointUrls('https://host.example/emby');
  A(paths.length === 1 && paths[0].pathname === '/emby/Sessions', 'subpath base uses /emby/Sessions only');

  const rootPaths = sessionEndpointUrls('https://host.example');
  A(rootPaths.length === 2, 'root base tries /Sessions and /emby/Sessions');

  const ls = makeLiveSessions(fakeFetch);
  const out = await ls.forUser([
    { url: 'http://a', apiKey: 'k', label: 'ARCTV', type: 'emby' },
    { url: 'http://b', apiKey: 'k', label: 'EAGLE', type: 'emby' },
    { url: 'http://c', apiKey: 'k', label: 'BK', type: 'jellyfin' },
    { url: '', apiKey: 'k', label: 'NoURL' },
  ]);
  A(out.length === 1, 'only the one actively-playing session is returned');
  A(out[0].title === 'Dune' && out[0].server === 'ARCTV', 'maps title + server label');
  A(out[0].user === 'alice' && out[0].client === 'Stremio', 'maps user + client');
  A(out[0].positionTicks === 90000000000 && out[0].isPaused === false, 'maps play state from Sessions API');
  A(out[0].progressPct === 90, 'computes progress percent');
  A((await ls.forUser([])).length === 0, 'empty server list → no sessions');

  const detailed = await ls.forUserDetailed([
    { url: 'http://sub', apiKey: 'k', label: 'Subpath', type: 'jellyfin' },
  ]);
  A(detailed.live.length === 1, 'falls back to /emby/Sessions for subpath hosts');
  A(detailed.probes[0].ok === true, 'probe marks success');
  A(detailed.probes[0].count === 1, 'probe reports playing count');

  const probe = await fetchServerSessionsDetailed({ url: 'http://c', apiKey: 'k', label: 'BK' }, fakeFetch);
  A(probe.ok === false && probe.error.includes('403'), 'failed probe surfaces HTTP error');

  const parsed = parseLiveSessions([{
    NowPlayingItem: { Name: 'X', Type: 'Movie', RunTimeTicks: 100 },
    PlayState: { PositionTicks: 25, IsPaused: false },
    UserName: 'u',
  }], { label: 'T' });
  A(parsed[0].progressPct === 25, 'parseLiveSessions computes progress');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();