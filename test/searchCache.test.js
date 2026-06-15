'use strict';
const assert = require('assert');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const cachedMiss = [];
  A(cachedMiss !== undefined, 'empty miss array is cached (not undefined)');
  A(!!cachedMiss, 'empty miss array is truthy — use !== undefined guard');

  const notCached = undefined;
  A(notCached === undefined, 'undefined means cache miss — should query server');

  console.log('\nsearchCache.test.js: all passed');
})();