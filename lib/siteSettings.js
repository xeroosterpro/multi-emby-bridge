// ─── Global (site-wide) settings. Currently: which user-facing tabs are disabled.
// db-injected + degrades to [] without DATABASE_URL. Never throws on read.
const _db = require('./db');

const TOGGLEABLE_TABS = [
  'dashboard', 'servers', 'catalogs', 'streaming', 'appearance', 'install', 'apikeys',
  'health', 'ping', 'log', 'settings', 'billing',
];

function makeSiteSettings(injectedDb) {
  const db = injectedDb || _db;
  return {
    async getDisabledTabs() {
      if (!db.isConfigured || !db.isConfigured()) return [];
      try {
        const r = await db.query(`SELECT value FROM site_settings WHERE key='disabled_tabs'`);
        const v = r.rows[0] && r.rows[0].value;
        return Array.isArray(v) ? v.filter(t => TOGGLEABLE_TABS.includes(t)) : [];
      } catch { return []; }
    },
    async setDisabledTabs(arr) {
      const clean = Array.from(new Set((arr || []).filter(t => TOGGLEABLE_TABS.includes(t))));
      await db.query(
        `INSERT INTO site_settings(key, value, updated_at) VALUES('disabled_tabs', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
        [JSON.stringify(clean)]
      );
      return clean;
    },
  };
}

module.exports = { makeSiteSettings, TOGGLEABLE_TABS };
