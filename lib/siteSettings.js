// ─── Global (site-wide) settings. Currently: disabled_tabs + announcement.
// db-injected + degrades gracefully without DATABASE_URL. Never throws on read.
const crypto = require('crypto');
const _db = require('./db');

const TOGGLEABLE_TABS = [
  'dashboard', 'servers', 'catalogs', 'streaming', 'appearance', 'install', 'apikeys',
  'health', 'ping', 'log', 'settings', 'billing',
];

const MAX_ANNOUNCEMENT_LEN = 280;

function makeSiteSettings(injectedDb) {
  const db = injectedDb || _db;

  async function getSetting(key) {
    if (!db.isConfigured || !db.isConfigured()) return null;
    try {
      const r = await db.query(`SELECT value FROM site_settings WHERE key=$1`, [key]);
      const v = r.rows[0] && r.rows[0].value;
      return v != null ? v : null;
    } catch { return null; }
  }

  async function setSetting(key, value) {
    await db.query(
      `INSERT INTO site_settings(key, value, updated_at) VALUES($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  function sanitizeAnnouncement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const message = String(raw.message || '').trim();
    if (!message) return null;
    if (message.length > MAX_ANNOUNCEMENT_LEN) return null;
    const link = raw.link ? String(raw.link).trim() : '';
    if (link && !/^https:\/\//i.test(link)) return null;
    const severity = raw.severity === 'warn' ? 'warn' : 'info';
    const dismissible = raw.dismissible !== false;
    const linkText = raw.linkText ? String(raw.linkText).trim().slice(0, 40) : '';
    return {
      id: raw.id || crypto.randomUUID(),
      message,
      link: link || null,
      linkText: linkText || null,
      severity,
      dismissible,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    async getDisabledTabs() {
      const v = await getSetting('disabled_tabs');
      return Array.isArray(v) ? v.filter(t => TOGGLEABLE_TABS.includes(t)) : [];
    },
    async setDisabledTabs(arr) {
      const clean = Array.from(new Set((arr || []).filter(t => TOGGLEABLE_TABS.includes(t))));
      await setSetting('disabled_tabs', clean);
      return clean;
    },
    async getAnnouncement() {
      const v = await getSetting('announcement');
      if (!v || typeof v !== 'object') return null;
      const msg = String(v.message || '').trim();
      if (!msg) return null;
      return {
        id: v.id || 'legacy',
        message: msg.slice(0, MAX_ANNOUNCEMENT_LEN),
        link: v.link && /^https:\/\//i.test(v.link) ? v.link : null,
        linkText: v.linkText || null,
        severity: v.severity === 'warn' ? 'warn' : 'info',
        dismissible: v.dismissible !== false,
        updatedAt: v.updatedAt || null,
      };
    },
    async setAnnouncement(raw) {
      if (raw === null || raw === undefined || (typeof raw === 'object' && !String(raw.message || '').trim())) {
        await db.query(`DELETE FROM site_settings WHERE key='announcement'`);
        return null;
      }
      const prev = await getSetting('announcement');
      const base = sanitizeAnnouncement({
        ...raw,
        id: crypto.randomUUID(),
        linkText: raw.linkText,
      });
      if (!base) throw new Error('invalid announcement');
      await setSetting('announcement', base);
      return base;
    },
    sanitizeAnnouncement,
    MAX_ANNOUNCEMENT_LEN,
  };
}

module.exports = { makeSiteSettings, TOGGLEABLE_TABS, MAX_ANNOUNCEMENT_LEN };