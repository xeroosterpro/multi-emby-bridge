'use strict';
const assert = require('assert');
const {
  canQueryServer, markAuthFailed, isAuthFailed, authBreaker,
  AUTH_FAIL_TTL_MS, authCooldownRemainingMs, applyServerCredentials,
} = require('../lib/auth');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const server = { url: 'https://dead.example.com', userId: 'u1', label: 'Dead', apiKey: 'old' };
  const key = 'https://dead.example.com|u1';
  authBreaker.onSuccess(key);
  A(canQueryServer(server), 'server queryable before auth fail');
  A(AUTH_FAIL_TTL_MS === 15 * 60 * 1000, 'default cooldown is 15 minutes');
  markAuthFailed(server, 'test');
  A(isAuthFailed(server), 'marked auth failed');
  A(!canQueryServer(server), 'skipped after auth fail');
  A(authCooldownRemainingMs(server) > 0, 'cooldown remaining reported');

  applyServerCredentials(server, { apiKey: 'new-token', userId: 'u2' });
  A(server.apiKey === 'new-token', 'applyServerCredentials updates apiKey');
  A(server.userId === 'u2', 'applyServerCredentials updates userId');

  console.log('\nauthFail.test.js: all passed');
})();