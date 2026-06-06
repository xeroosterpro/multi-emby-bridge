// ─── Unit tests for lib/audioRanking.js ──────────────────────────────────────
// Run with: node test/audioRanking.test.js
const A = require('../lib/audioRanking');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else      { console.error(`  ✗ ${msg}`); failed++; }
}
function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✓ ${msg}`); passed++; }
  else    { console.error(`  ✗ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++; }
}

console.log('\nTaxonomy & order:');
assertEqual(A.AUDIO_FORMATS.length, 11, '11 formats defined');
assertEqual(A.DEFAULT_ORDER, ['atmos','dtsx','truehd','dtshd_ma','lpcm','flac','ddplus','dts','dd','aac','other'], 'default order ids');
assert(A.AUDIO_FORMATS.every(f => f.id && f.token && f.label && f.chans), 'every row has id/token/label/chans');

console.log('\nToken converters:');
assertEqual(A.idsToTokens(['atmos','aac']), ['atm','aac'], 'idsToTokens');
assertEqual(A.tokensToIds(['atm','aac']), ['atmos','aac'], 'tokensToIds');
assertEqual(A.tokensToIds(['atm','BOGUS','aac']), ['atmos','aac'], 'tokensToIds drops unknown tokens');

console.log('\nresolveOrder:');
assertEqual(A.resolveOrder(undefined), A.DEFAULT_ORDER, 'undefined -> default order');
assertEqual(A.resolveOrder(['aac','atm']).slice(0,2), ['aac','atmos'], 'user order honored, then defaults appended');
assertEqual(A.resolveOrder(['aac','atm']).length, 11, 'resolveOrder always returns all 11 ids');
assertEqual(A.resolveOrder(['BOGUS']), A.DEFAULT_ORDER, 'all-garbage -> default order');

console.log('\nresRank:');
assertEqual(A.resRank('4K'), 0, '4K -> 0');
assertEqual(A.resRank('1080p'), 1, '1080p -> 1');
assertEqual(A.resRank('720p'), 2, '720p -> 2');
assertEqual(A.resRank(null), 3, 'null -> 3');
assertEqual(A.resRank('480p'), 3, 'other -> 3');

console.log('\nclassifyAudio:');
assertEqual(A.classifyAudio('truehd', 'Atmos'), 'atmos', 'TrueHD+Atmos -> atmos');
assertEqual(A.classifyAudio('truehd', ''), 'truehd', 'TrueHD plain -> truehd');
assertEqual(A.classifyAudio('eac3', 'Dolby Atmos'), 'atmos', 'EAC3+Atmos -> atmos');
assertEqual(A.classifyAudio('eac3', ''), 'ddplus', 'EAC3 plain -> ddplus');
assertEqual(A.classifyAudio('e-ac-3', ''), 'ddplus', 'e-ac-3 -> ddplus');
assertEqual(A.classifyAudio('eac-3', ''), 'ddplus', 'eac-3 -> ddplus');
assertEqual(A.classifyAudio('dca', 'DTS:X'), 'dtsx', 'DTS profile DTS:X -> dtsx');
assertEqual(A.classifyAudio('dts', 'DTS-HD MA'), 'dtshd_ma', 'DTS profile MA -> dtshd_ma');
assertEqual(A.classifyAudio('dtshd', ''), 'dtshd_ma', 'dtshd codec -> dtshd_ma');
assertEqual(A.classifyAudio('dts', ''), 'dts', 'DTS plain -> dts');
assertEqual(A.classifyAudio('pcm_s24le', ''), 'lpcm', 'pcm -> lpcm');
assertEqual(A.classifyAudio('flac', ''), 'flac', 'flac -> flac');
assertEqual(A.classifyAudio('ac3', ''), 'dd', 'ac3 -> dd');
assertEqual(A.classifyAudio('aac', ''), 'aac', 'aac -> aac');
assertEqual(A.classifyAudio('opus', ''), 'other', 'opus -> other');
assertEqual(A.classifyAudio('', ''), 'other', 'empty -> other');
assertEqual(A.classifyAudio(null, null), 'other', 'null -> other (no throw)');

console.log('\nbuildAudioKeys:');
const order = A.DEFAULT_ORDER; // atmos best ... other worst
// File with TrueHD + AC3: best track = truehd (idx 2)
let k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, order, new Set());
assertEqual(k.bestFormat, 'truehd', 'best of [truehd,dd] = truehd');
assertEqual(k.audioIdx, 2, 'truehd idx = 2');
assertEqual(k.isDisabledClass, false, 'not disabled when nothing disabled');
// Disable truehd -> the TrueHD+AC3 file is disabled-class (best track disabled)
k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, order, new Set(['truehd']));
assertEqual(k.isDisabledClass, true, 'disabled-class when best track disabled');
// Custom order: AC3 ranked above TrueHD -> best becomes dd, not disabled
const ddFirst = A.resolveOrder(['dd','thd']);
k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, ddFirst, new Set(['truehd']));
assertEqual(k.bestFormat, 'dd', 'best follows user order (dd first)');
assertEqual(k.isDisabledClass, false, 'not disabled — best track (dd) is enabled');
// No audio formats at all
k = A.buildAudioKeys({ _audioFormats: [] }, order, new Set());
assertEqual(k.bestFormat, null, 'no formats -> bestFormat null');
assertEqual(k.audioIdx, 99, 'no formats -> audioIdx 99 (sorts last)');

console.log('\nattachAudioKeys:');
const streams = [
  { _audioFormats: ['atmos'], _resLabel: '1080p' },
  { _audioFormats: ['aac'],   _resLabel: '4K' },
];
A.attachAudioKeys(streams, { audioOrder: undefined, audioDisabled: ['aac'], audioDisableAction: 'bottom' });
assertEqual(streams[0]._audioIdx, 0, 'atmos stream idx 0');
assertEqual(streams[1]._isDisabledClass, true, 'aac stream disabled-class');
assertEqual(streams[1]._demoted, 1, 'aac stream demoted (action=bottom)');
assertEqual(streams[0]._demoted, 0, 'atmos stream not demoted');
assertEqual(streams[1]._resRank, 0, 'resRank attached (4K=0)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
