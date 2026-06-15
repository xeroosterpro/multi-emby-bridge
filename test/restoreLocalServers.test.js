'use strict';
const assert = require('assert');
const {
  mergeServerLists,
  mergeServerEntry,
  normUrl,
} = require('../lib/restoreLocalServers');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  A(normUrl('https://Emby.Example.com/') === 'https://emby.example.com', 'normUrl strips slash + lowercases');

  const merged = mergeServerEntry(
    { label: 'Old', url: 'https://a.example.com', apiKey: 'k1', userId: 'u1' },
    { label: 'New', url: 'https://a.example.com', username: 'alice', password: 'pw' },
  );
  A(merged.apiKey === 'k1' && merged.username === 'alice', 'merge keeps existing apiKey, adds username');

  const { servers, added, updated } = mergeServerLists(
    [{ label: 'A', url: 'https://one.example.com', apiKey: 'k', userId: 'u' }],
    [
      { label: 'A2', url: 'https://one.example.com', username: 'x' },
      { label: 'B', url: 'https://two.example.com', apiKey: 'k2', userId: 'u2' },
    ],
  );
  A(servers.length === 2, 'merge keeps one row per URL');
  A(added === 1, 'counts one added server');
  A(updated === 1, 'counts one updated server');
  A(servers[0].username === 'x', 'fills missing creds on existing URL');

  console.log('\nrestoreLocalServers.test.js: all passed');
})();