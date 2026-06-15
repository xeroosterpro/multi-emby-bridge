'use strict';
const assert = require('assert');
const { completeServers } = require('../lib/migrateLegacyConfig');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  A(completeServers([]).length === 0, 'empty list');
  A(completeServers([{ label: 'A', url: 'http://x', apiKey: 'k', userId: 'u' }]).length === 1, 'complete server');
  A(completeServers([{ label: 'A', url: 'http://x' }]).length === 0, 'incomplete skipped');
  console.log('\nmigrateLegacyConfig.test.js: all passed');
})();