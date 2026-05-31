const assert = require('assert');
const { mapAddonMetas } = require('../lib/catalogs');

const input = [
  { id: 'tt001', type: 'movie', name: 'A', poster: 'http://src/a.jpg', description: 'd', releaseInfo: '2020' },
  { id: 'tt001', type: 'movie', name: 'A dup', poster: 'http://src/a2.jpg' },
  { id: 'kitsu:5', type: 'movie', name: 'NoTt' },
];
const out = mapAddonMetas(input, 'movie', null);
assert.strictEqual(out.length, 1, 'dedupes by id and drops non-tt');
assert.strictEqual(out[0].id, 'tt001');
assert.strictEqual(out[0].type, 'movie');
assert.strictEqual(out[0].name, 'A');
assert.strictEqual(out[0].poster, 'http://src/a.jpg', 'keeps source poster when no rpdb key');
assert.strictEqual(out[0].description, 'd');
assert.strictEqual(out[0].releaseInfo, '2020');

const outR = mapAddonMetas(input, 'movie', 'RPDBKEY');
assert.ok(outR[0].poster.includes('ratingposterdb.com/RPDBKEY/imdb/poster-default/tt001'), 'rpdb override');

console.log('mapAddonMetas tests passed');
