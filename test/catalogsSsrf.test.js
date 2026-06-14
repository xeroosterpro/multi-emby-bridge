'use strict';
const assert = require('assert');
const { fetchExternalCatalog } = require('../lib/catalogs');

(async () => {
  let blocked = false;
  try {
    await fetchExternalCatalog({
      provider: 'letterboxd',
      listUrl: 'http://127.0.0.1/private-list',
      enabled: true,
      mediaType: 'movie',
    }, null, null, null, null);
  } catch (e) {
    blocked = /Blocked letterboxd list url/i.test(e.message);
  }
  assert.strictEqual(blocked, true, 'letterboxd list URL should be SSRF-checked');
  console.log('catalogsSsrf.test.js: all passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});