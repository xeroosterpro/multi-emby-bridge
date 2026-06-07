// ─── Unit tests for mediaSourcesToStreams in lib/streams.js ──────────────────
// Run with: node test/streams.test.js
//
// streams.js requires auth.js + search.js at module load, so we stub only the
// functions it actually calls at runtime (none during mediaSourcesToStreams).

// Minimal stubs so require('../lib/streams') does not crash

// Patch require cache to intercept auth and search so we don't need real servers
const Module = require('module');
const _orig = Module._resolveFilename.bind(Module);
// We'll just stub the modules by pre-populating the cache
const path = require('path');

function stubModule(name, exports) {
  const id = path.resolve(__dirname, '..', 'lib', name + '.js');
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stubModule('auth', {
  apiFetch: async () => { throw new Error('should not be called'); },
  pingServer: async () => null,
  buildStreamUrl: (server, itemId, sourceId, container) =>
    `${server.url}/Videos/${itemId}/stream.${container || 'mkv'}?MediaSourceId=${sourceId}`,
});
stubModule('search', {
  queryServerForMovie: async () => null,
  queryServerForEpisode: async () => null,
});

const { mediaSourcesToStreams, buildItemTitle } = require('../lib/streams');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { console.log(`  ✓ ${message}`); passed++; }
  else           { console.error(`  ✗ ${message}`); failed++; }
}
function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (ok) { console.log(`  ✓ ${message}`); passed++; }
  else    { console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++; }
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const server = { url: 'http://emby.local:8096', label: 'TEST', emoji: null, userId: 'u1', apiKey: 'k1' };

function makeSource(overrides = {}) {
  return {
    Id: 'src1',
    Size: 10 * 1e9,      // 10 GB
    Bitrate: 20 * 1e6,   // 20 Mbps
    Container: 'mkv',
    Name: 'Movie',
    Path: '/media/Movie.mkv',
    MediaStreams: [
      { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160, BitDepth: 10, VideoRangeType: 'HDR10' },
      { Type: 'Audio', Codec: 'truehd', Channels: 8, Profile: 'Atmos', Language: 'eng' },
    ],
    ...overrides,
  };
}

// ─── Standard preset ─────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — standard preset');

{
  const streams = mediaSourcesToStreams(server, 'item1', [makeSource()], 'standard');
  assertEqual(streams.length, 1, 'returns one stream for one source');

  const s = streams[0];
  assert(s.name.startsWith('TEST'), 'name starts with server label');
  assert(s.name.includes('4K'), 'name includes resolution');
  assert(s.name.includes('HDR10'), 'name includes HDR');
  assert(typeof s.description === 'string', 'has description field');
  assert(typeof s.url === 'string' && s.url.includes('http'), 'url is a string with http');
}

// ─── Compact preset ──────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — compact preset');

{
  const [s] = mediaSourcesToStreams(server, 'item1', [makeSource()], 'compact');
  assert(s.name.includes('HEVC'), 'compact: codec in name');
  assert(!s.description.includes('\n'), 'compact: single-line description');
}

// ─── Detailed preset ─────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — detailed preset');

{
  const [s] = mediaSourcesToStreams(server, 'item1', [makeSource()], 'detailed');
  assert(!s.name.includes('HEVC'), 'detailed: codec NOT in name');
  assert(s.name.includes('4K'), 'detailed: res in name');
}

// ─── Cinema preset with REMUX source ─────────────────────────────────────────
console.log('\nmediaSourcesToStreams — cinema preset + REMUX');

{
  const src = makeSource({ Path: '/media/Movie.REMUX.mkv' });
  const [s] = mediaSourcesToStreams(server, 'item1', [src], 'cinema');
  assert(s.name.includes('REMUX'), 'cinema: REMUX in name');
}

// ─── Minimal preset ───────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — minimal preset');

{
  const [s] = mediaSourcesToStreams(server, 'item1', [makeSource()], 'minimal');
  assert(s.name.includes('4K'), 'minimal: res in name');
  assert(s.description.includes('GB'), 'minimal: size in desc');
}

// ─── Empty mediaSources ───────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — empty sources');

{
  const streams = mediaSourcesToStreams(server, 'item1', [], 'standard');
  assertEqual(streams.length, 0, 'empty array returns no streams');
}

// ─── No video stream (audio-only / unknown) ───────────────────────────────────
console.log('\nmediaSourcesToStreams — source with no video stream');

{
  const src = makeSource({ MediaStreams: [{ Type: 'Audio', Codec: 'aac', Channels: 2 }] });
  const streams = mediaSourcesToStreams(server, 'item1', [src], 'standard');
  assertEqual(streams.length, 1, 'still produces a stream without video');
}

// ─── Quality badges ───────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — quality badge emoji');

{
  const src = makeSource({ Path: '/media/Movie.REMUX.mkv' });
  const opts = { qualityBadge: 'emoji' };
  const [s] = mediaSourcesToStreams(server, 'item1', [src], 'standard', opts);
  // name should have an emoji badge character before/around the server label
  assert(s.name.length > 'TEST'.length, 'badge adds characters to name');
}

console.log('\nmediaSourcesToStreams — quality badge tags');

{
  const src = makeSource({ Path: '/media/Movie.REMUX.mkv' });
  const opts = { qualityBadge: 'tags' };
  const [s] = mediaSourcesToStreams(server, 'item1', [src], 'standard', opts);
  assert(s.name.includes('['), 'tags badge uses bracket notation');
}

// ── _audioFormats attached from MediaStreams ──
console.log('\nmediaSourcesToStreams — _audioFormats');

{
  const multiAudioSource = makeSource({
    MediaStreams: [
      { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160 },
      { Type: 'Audio', Codec: 'truehd', Channels: 8, Profile: 'Atmos', Language: 'eng' },
      { Type: 'Audio', Codec: 'ac3', Channels: 6, Language: 'eng' },
    ],
  });
  const af = mediaSourcesToStreams(server, 'itemX', [multiAudioSource], 'standard');
  assertEqual(af[0]._audioFormats.sort().join(','), 'atmos,dd', '_audioFormats lists all tracks classified');
}

// ─── buildItemTitle: log a meaningful name for the dashboard ─────────────────
// The bug: episodes logged their own Name ("Episode 2") instead of the series,
// so Live streaming / Watched history showed "Episode 2" with no series context.
{
  const ep = { Name: 'Episode 2', SeriesName: 'Michael Jackson: The Verdict', ParentIndexNumber: 1, IndexNumber: 2 };
  assertEqual(buildItemTitle(ep), 'Michael Jackson: The Verdict S1E2 — Episode 2', 'episode title = series + SxEy + episode name');

  const epNamed = { Name: 'The Fly', SeriesName: 'Breaking Bad', ParentIndexNumber: 3, IndexNumber: 10 };
  assertEqual(buildItemTitle(epNamed), 'Breaking Bad S3E10 — The Fly', 'episode with a real name keeps it');

  const epNoName = { Name: 'Breaking Bad', SeriesName: 'Breaking Bad', ParentIndexNumber: 1, IndexNumber: 1 };
  assertEqual(buildItemTitle(epNoName), 'Breaking Bad S1E1', 'omits episode suffix when it equals the series name');

  const movie = { Name: 'Dune: Part Two' };
  assertEqual(buildItemTitle(movie), 'Dune: Part Two', 'movie title is just its name');

  assertEqual(buildItemTitle(null), null, 'null item → null');
  assertEqual(buildItemTitle({}), null, 'empty item → null');
}

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
