// Run with: node test/siteSettings.test.js
const { makeSiteSettings, TOGGLEABLE_TABS } = require('../lib/siteSettings');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb(configured = true) {
  const store = {};
  return {
    isConfigured: () => configured,
    async query(text, params) {
      if (/INSERT INTO site_settings/i.test(text)) { store['disabled_tabs'] = JSON.parse(params[0]); return { rows: [] }; }
      if (/SELECT value FROM site_settings/i.test(text)) {
        return store['disabled_tabs'] ? { rows: [{ value: store['disabled_tabs'] }] } : { rows: [] };
      }
      return { rows: [] };
    },
  };
}

(async () => {
  const ss = makeSiteSettings(fakeDb());
  A((await ss.getDisabledTabs()).length === 0, 'defaults to [] when unset');
  const saved = await ss.setDisabledTabs(['catalogs', 'ping']);
  A(saved.length === 2 && saved.includes('catalogs'), 'setDisabledTabs returns cleaned list');
  A((await ss.getDisabledTabs()).join(',') === 'catalogs,ping', 'get round-trips saved tabs');

  const cleaned = await ss.setDisabledTabs(['catalogs', 'admin', 'users', 'bogus']);
  A(cleaned.join(',') === 'catalogs', 'rejects non-whitelisted tabs (admin/users/bogus dropped)');

  const dup = await ss.setDisabledTabs(['ping', 'ping', 'log']);
  A(dup.length === 2, 'dedupes');

  const noDb = makeSiteSettings(fakeDb(false));
  A((await noDb.getDisabledTabs()).length === 0, 'no DB → [] (never throws)');

  A(Array.isArray(TOGGLEABLE_TABS) && TOGGLEABLE_TABS.includes('apikeys') && !TOGGLEABLE_TABS.includes('admin'),
    'whitelist includes apikeys, excludes admin');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
