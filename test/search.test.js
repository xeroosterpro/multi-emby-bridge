'use strict';
const assert = require('assert');
const path = require('path');

function stubModule(name, exports) {
  const id = path.resolve(__dirname, '..', 'lib', name + '.js');
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const apiCalls = [];
stubModule('auth', {
  apiFetch: async (server, buildUrl) => {
    const url = buildUrl().toString();
    apiCalls.push(url);
    return {
      json: async () => ({
        Items: [
          { Id: '1', Name: 'Test Movie', ProviderIds: { Imdb: 'tt9990001' }, ProductionYear: 2020 },
          { Id: '2', Name: 'Wrong', ProviderIds: { Imdb: 'tt0000001' }, ProductionYear: 1990 },
        ],
      }),
    };
  },
  fetchWithTimeout: async () => ({ json: async () => ({ meta: { name: 'Test Movie', year: '2020' } }) }),
});

stubModule('resolveCache', {
  getResolved: () => undefined,
  setResolved: () => {},
});

const { queryServerForMovie } = require('../lib/search');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(async function main() {
  apiCalls.length = 0;
  const server = { url: 'https://emby.example.com', userId: 'u1', label: 'Test', type: 'emby', apiKey: 'k' };
  const items = await queryServerForMovie(server, 'tt9990001');
  A(items.length === 1, 'filters to matching imdb id');
  A(items[0].Id === '1', 'returns validated item');
  A(apiCalls.length >= 1, 'queries emby api');
  console.log('\nsearch.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });