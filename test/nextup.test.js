const assert = require('assert');
const { getRecentlyAdded } = require('../lib/search');
getRecentlyAdded([], 'movie', 1000, null, 'nextup', null).then(r => {
  assert.deepStrictEqual(r, [], 'nextup movie returns empty');
  return getRecentlyAdded([], 'series', 1000, null, 'nextup', null);
}).then(r => {
  assert.deepStrictEqual(r, [], 'nextup series with no servers returns empty');
  console.log('nextup tests passed');
}).catch(e => { console.error(e); process.exit(1); });
