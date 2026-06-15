'use strict';
const assert = require('assert');
const { canQueryServer, markAuthFailed, isAuthFailed, authBreaker } = require('../lib/auth');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const server = { url: 'https://dead.example.com', userId: 'u1', label: 'Dead' };
  const key = 'https://dead.example.com|u1';
  authBreaker.onSuccess(key);
  A(canQueryServer(server), 'server queryable before auth fail');
  markAuthFailed(server);
  A(isAuthFailed(server), 'marked auth failed');
  A(!canQueryServer(server), 'skipped after auth fail');
  console.log('\nauthFail.test.js: all passed');
})();