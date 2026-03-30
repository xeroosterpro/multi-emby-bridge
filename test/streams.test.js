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

const { mediaSourcesToStreams } = require('../lib/streams');

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
  assert(typeof s.title === 'string', 'has title field');
  assert(typeof s.url === 'string' && s.url.includes('http'), 'url is a string with http');
}

// ─── Compact preset ──────────────────────────────────────────────────────────
console.log('\nmediaSourcesToStreams — compact preset');

{
  const [s] = mediaSourcesToStreams(server, 'item1', [makeSource()], 'compact');
  assert(s.name.includes('HEVC'), 'compact: codec in name');
  assert(!s.title.includes('\n'), 'compact: single-line description');
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
  assert(s.title.includes('GB'), 'minimal: size in desc');
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

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
