// Run with: node test/liveSessions.test.js
const {
  makeLiveSessions,
  parseLiveSessions,
  formatLiveTitle,
  sessionEndpointUrls,
  fetchServerSessionsDetailed,
  mergeLiveByItem,
} = require('../lib/sessions');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeFetch(url) {
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
  if (url.includes('//c') && url.includes('/Sessions')) return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
  if (url.includes('//c') && url.includes('/Users/') && url.includes('Filters=IsPlaying')) {
    return Promise.resolve({ ok: true, json: async () => ({
      Items: [{ Name: 'Heat', Type: 'Movie', RunTimeTicks: 80000000000, Id: 'mv-1', UserData: { PlaybackPositionTicks: 40000000000 } }],
    }) });
  }
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
    { url: 'http://a', apiKey: 'k', label: 'ARCTV', type: 'emby', userId: 'u1' },
    { url: 'http://b', apiKey: 'k', label: 'EAGLE', type: 'emby', userId: 'u2' },
    { url: 'http://c', apiKey: 'k', label: 'BK', type: 'jellyfin', userId: 'u3' },
    { url: '', apiKey: 'k', label: 'NoURL', userId: 'u4' },
  ]);
  A(out.length === 2, 'sessions + user-playing fallback both contribute');
  A(out.some(s => s.server === 'ARCTV' && s.title === 'Dune'), 'sessions row kept');
  A(out.some(s => s.server === 'BK' && s.source === 'user-playing'), 'IsPlaying fallback used when Sessions fails');

  const detailed = await ls.forUserDetailed([
    { url: 'http://sub', apiKey: 'k', label: 'Subpath', type: 'jellyfin', userId: 'u5' },
  ]);
  A(detailed.live.length === 1, 'falls back to /emby/Sessions for subpath hosts');
  A(detailed.probes[0].ok === true, 'probe marks success');
  A(detailed.probes[0].method === 'sessions', 'probe records method');

  const probe = await fetchServerSessionsDetailed({ url: 'http://c', apiKey: 'k', label: 'BK', userId: 'u3' }, fakeFetch);
  A(probe.ok === true && probe.method === 'user-playing', 'user-playing probe succeeds after Sessions 403');

  const merged = mergeLiveByItem([
    [{ server: 'X', serverUrl: 'http://x', title: 'A', source: 'user-playing', sessionId: '1' }],
    [{ server: 'X', serverUrl: 'http://x', title: 'A', source: 'sessions', sessionId: '1', client: 'Stremio' }],
  ]);
  A(merged[0].source === 'sessions' && merged[0].client === 'Stremio', 'sessions data wins over user-playing');

  const parsed = parseLiveSessions([{
    NowPlayingItem: { Name: 'X', Type: 'Movie', RunTimeTicks: 100 },
    PlayState: { PositionTicks: 25, IsPaused: false },
    UserName: 'u',
  }], { label: 'T', url: 'http://t' });
  A(parsed[0].progressPct === 25, 'parseLiveSessions computes progress');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();