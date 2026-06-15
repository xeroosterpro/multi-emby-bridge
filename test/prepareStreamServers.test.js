'use strict';
const assert = require('assert');
const { prepareStreamServers, authBreaker } = require('../lib/auth');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(async function main() {
  const servers = await prepareStreamServers([
    { url: 'https://emby1.example.com', apiKey: 'k1', userId: 'u1', enabled: true, label: 'A' },
    { url: 'https://emby2.example.com', apiKey: 'k2', userId: 'u2', enabled: false, label: 'B' },
    { url: '', apiKey: 'k3', userId: 'u3', enabled: true, label: 'C' },
  ]);
  A(servers.length === 1, 'skips disabled and url-less servers');
  A(servers[0].label === 'A', 'keeps valid server');

  const openKey = 'https://circuit-open.example.com|u9';
  for (let i = 0; i < 5; i++) authBreaker.onFailure(openKey);
  const filtered = await prepareStreamServers([
    { url: 'https://circuit-open.example.com', apiKey: 'k', userId: 'u9', enabled: true, label: 'Down' },
    { url: 'https://emby3.example.com', apiKey: 'k4', userId: 'u4', enabled: true, label: 'Up' },
  ]);
  A(filtered.length === 1, 'skips circuit-open servers before auth');
  A(filtered[0].label === 'Up', 'auth only reachable servers');

  console.log('\nprepareStreamServers.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });