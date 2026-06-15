'use strict';
const assert = require('assert');
const { get, set, getStats, clearAll, l1Key, l3Key, l1UrlForCache, l3OptsHash } = require('../lib/embyCache');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  clearAll();
  set('L1', l1Key('srv', 'https://x/Items/1'), '{"ok":true}');
  A(get('L1', l1Key('srv', 'https://x/Items/1')) === '{"ok":true}', 'L1 stores body');
  set('L3', l3Key('cfg', 'movie', 'tt123', { labelPreset: 'compact' }), { streams: [{ name: 'A' }] });
  A(get('L3', l3Key('cfg', 'movie', 'tt123', { labelPreset: 'compact' })).streams.length === 1, 'L3 stores streams');
  A(l3Key('cfg', 'movie', 'tt123', { autoSelect: false }) !== l3Key('cfg', 'movie', 'tt123', { autoSelect: true }), 'L3 key varies by stream opts');
  A(l1Key('srv', l1UrlForCache('https://x/Items/1?api_key=secret')) === l1Key('srv', 'https://x/Items/1'), 'L1 url strips api_key');
  A(l3OptsHash({ autoSelect: true }) !== l3OptsHash({ autoSelect: false }), 'opts hash differs');
  const stats = getStats();
  A(stats.L1.hits >= 1, 'L1 hit counted');
  A(stats.L3.hits >= 1, 'L3 hit counted');
  clearAll();
  A(get('L1', l1Key('srv', 'https://x/Items/1')) === undefined, 'clear resets L1');
  console.log('\nembyCache.test.js: all passed');
})();