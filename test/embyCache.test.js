'use strict';
const assert = require('assert');
const { get, set, getStats, clearAll, l1Key, l3Key } = require('../lib/embyCache');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  clearAll();
  set('L1', l1Key('srv', 'https://x/Items/1'), '{"ok":true}');
  A(get('L1', l1Key('srv', 'https://x/Items/1')) === '{"ok":true}', 'L1 stores body');
  set('L3', l3Key('cfg', 'movie', 'tt123'), { streams: [{ name: 'A' }] });
  A(get('L3', l3Key('cfg', 'movie', 'tt123')).streams.length === 1, 'L3 stores streams');
  const stats = getStats();
  A(stats.L1.hits >= 1, 'L1 hit counted');
  A(stats.L3.hits >= 1, 'L3 hit counted');
  clearAll();
  A(get('L1', l1Key('srv', 'https://x/Items/1')) === undefined, 'clear resets L1');
  console.log('\nembyCache.test.js: all passed');
})();