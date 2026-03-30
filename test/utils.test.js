// ─── Unit tests for lib/utils.js ─────────────────────────────────────────────
// Run with: node test/utils.test.js

const {
  parseStreamId,
  formatFileSize,
  detectSourceLabel,
  buildBitrateBar,
  isMatchingProviderId,
  langFlag,
} = require('../lib/utils');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── parseStreamId ───────────────────────────────────────────────────────────
console.log('\nparseStreamId');

{
  const r = parseStreamId('movie', 'tt1234567');
  assertEqual(r.imdbId, 'tt1234567', 'movie: imdbId extracted');
  assertEqual(r.season, null, 'movie: season is null');
  assertEqual(r.episode, null, 'movie: episode is null');
}

{
  const r = parseStreamId('series', 'tt1234567:2:5');
  assertEqual(r.imdbId, 'tt1234567', 'series: imdbId extracted');
  assertEqual(r.season, 2, 'series: season parsed');
  assertEqual(r.episode, 5, 'series: episode parsed');
}

// ─── formatFileSize ───────────────────────────────────────────────────────────
console.log('\nformatFileSize');

assertEqual(formatFileSize(0),          null,        'zero → null');
assertEqual(formatFileSize(null),       null,        'null → null');
assertEqual(formatFileSize(500000),     '500.0 MB',  '500 MB');
assertEqual(formatFileSize(1500000000), '1.50 GB',   '1.5 GB');
assertEqual(formatFileSize(900000),     '900.0 MB',  '900 MB');
assertEqual(formatFileSize(50000),      '50 KB',     '50 KB');
assert(formatFileSize(53687091200).endsWith('GB'), '50 GB shows GB');

// ─── detectSourceLabel ────────────────────────────────────────────────────────
console.log('\ndetectSourceLabel');

assertEqual(detectSourceLabel({ Path: '/media/Movie.REMUX.mkv',       Name: '' }), 'REMUX',   'REMUX from path');
assertEqual(detectSourceLabel({ Path: '/media/Movie.WEB-DL.mkv',      Name: '' }), 'WEB-DL',  'WEB-DL from path');
assertEqual(detectSourceLabel({ Path: '/media/Movie.WEBDL.mkv',       Name: '' }), 'WEB-DL',  'WEBDL (no hyphen)');
assertEqual(detectSourceLabel({ Path: '/media/Movie.WEBRip.mkv',      Name: '' }), 'WEB-RIP', 'WEBRip from path');
assertEqual(detectSourceLabel({ Path: '/media/Movie.BluRay.mkv',      Name: '' }), 'BluRay',  'BluRay from path');
assertEqual(detectSourceLabel({ Path: '/media/Movie.Blu-ray.mkv',     Name: '' }), 'BluRay',  'Blu-ray with hyphen');
assertEqual(detectSourceLabel({ Path: '/media/Movie.HDTV.mkv',        Name: '' }), 'HDTV',    'HDTV from path');
assertEqual(detectSourceLabel({ Path: '/media/Movie.mkv',             Name: 'Movie REMUX' }), 'REMUX', 'REMUX from Name field');
assertEqual(detectSourceLabel({ Path: '/media/normal.mkv',            Name: '' }), null,      'no match → null');
assertEqual(detectSourceLabel({ Path: '',                             Name: '' }), null,      'empty → null');

// ─── buildBitrateBar ─────────────────────────────────────────────────────────
console.log('\nbuildBitrateBar');

assertEqual(buildBitrateBar(0),                   '',        'zero bps → empty string');
assertEqual(buildBitrateBar(null),                '',        'null → empty string');
assertEqual(buildBitrateBar(1000000),             '█░░░░',   '1 Mbps → 1 filled block');
assertEqual(buildBitrateBar(5000000),             '██░░░',   '5 Mbps → 2 filled blocks');
assertEqual(buildBitrateBar(10000000),            '███░░',   '10 Mbps → 3 filled blocks');
assertEqual(buildBitrateBar(20000000),            '████░',   '20 Mbps → 4 filled blocks');
assertEqual(buildBitrateBar(35000000),            '█████',   '35 Mbps → 5 filled blocks');
assertEqual(buildBitrateBar(1000000, 'segments'), '▰▱▱▱▱',  '1 Mbps segments');
assertEqual(buildBitrateBar(35000000,'segments'), '▰▰▰▰▰',  '35 Mbps segments all filled');

// ─── isMatchingProviderId ─────────────────────────────────────────────────────
console.log('\nisMatchingProviderId');

assert( isMatchingProviderId({ Imdb: 'tt1234567' },  'tt1234567'), 'exact match Imdb key');
assert( isMatchingProviderId({ imdb: 'tt1234567' },  'tt1234567'), 'exact match imdb (lowercase) key');
assert( isMatchingProviderId({ IMDB: 'tt1234567' },  'tt1234567'), 'exact match IMDB (uppercase) key');
assert( isMatchingProviderId({ Imdb: 'TT1234567' },  'tt1234567'), 'case-insensitive match');
// leading-zero normalisation: tt0001234 vs tt1234
assert( isMatchingProviderId({ Imdb: 'tt0001234' },  'tt1234'),    'strip leading zeros — lhs has more zeros');
assert( isMatchingProviderId({ Imdb: 'tt1234' },     'tt0001234'), 'strip leading zeros — rhs has more zeros');
assert(!isMatchingProviderId({ Imdb: 'tt9999999' },  'tt1234567'), 'mismatch returns false');
assert(!isMatchingProviderId(null,                   'tt1234567'), 'null providerIds → false');
assert(!isMatchingProviderId({ Imdb: 'tt1234567' },  null),        'null imdbId → false');
assert(!isMatchingProviderId({},                     'tt1234567'), 'missing Imdb key → false');

// ─── langFlag ────────────────────────────────────────────────────────────────
console.log('\nlangFlag');

assertEqual(langFlag('eng'), '🇺🇸', 'eng → US flag');
assertEqual(langFlag('rus'), '🇷🇺', 'rus → RU flag');
assertEqual(langFlag('ENG'), '🇺🇸', 'uppercase ENG handled');
assertEqual(langFlag('xyz'), null,  'unknown code → null');
assertEqual(langFlag(''),    null,  'empty string → null');
assertEqual(langFlag(null),  null,  'null → null');

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
