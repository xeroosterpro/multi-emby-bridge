'use strict';
const assert = require('assert');
const { makeLruCache } = require('../lib/lruCache');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  let now = 0;
  const cache = makeLruCache({ max: 10, ttlMs: 1000, now: () => now });
  cache.set('a', 1);
  A(cache.get('a') === 1, 'basic set/get');
  cache.set('b', 2, 100);
  now = 150;
  A(cache.get('b') === undefined, 'per-key ttl override expires');
  console.log('\nresolveCache.test.js: all passed');
})();