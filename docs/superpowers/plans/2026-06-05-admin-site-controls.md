# Admin Site Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin "view as normal user" preview + global per-tab disable, and split the combined "API Keys & Manifest" tab into separate Install and API Keys pages.

**Architecture:** A new generic `site_settings` JSONB key/value table backs a `lib/siteSettings.js` module; a public `GET /api/site-config` exposes the disabled-tab list (+ whitelist) and an admin `POST /api/admin/site-config` saves it. A new vanilla `public/js/site-controls.js` reads role + site-config and hides/badges tabs and owns the client-only "view as user" state. The Install/API-Keys split is HTML/markup reparenting that preserves all element IDs.

**Tech Stack:** Node/Express, Postgres (`pg`), vanilla JS/CSS, hash router in `public/js/shell.js`. Tests: Node suite (`npm test`) for the pure `siteSettings` logic; browser MCP for UI.

> **Verification note:** Unit tests cover `lib/siteSettings.js` (pure, db-injected). API endpoints + all UI are verified via objective checks (curl/boot, grep) and browser MCP by the controller, since there's no HTTP test harness.

---

## File Structure
- **Create:** `migrations/008_site_settings.sql` — generic global settings table.
- **Create:** `lib/siteSettings.js` — get/set disabled tabs + `TOGGLEABLE_TABS` whitelist (db-injected, no-DB safe).
- **Create:** `test/siteSettings.test.js` — unit tests; added to `npm test`.
- **Create:** `public/js/site-controls.js` — apply tab visibility + view-as state (one responsibility).
- **Modify:** `server.js` — instantiate siteSettings + `GET /api/site-config`.
- **Modify:** `routes/admin.js` — `POST /site-config` (admin).
- **Modify:** `public/configure.html` — split Install/API-Keys pages + nav; add Site-controls card; include `site-controls.js`.
- **Modify:** `public/js/shell.js` — add `apikeys` to `PAGES`.
- **Modify:** `public/js/admin.js` — render/wire the Site-controls card.
- **Modify:** `public/css/configure.css` — `.tab-hidden`, `.tab-disabled-badge`, view-as banner.
- **Modify:** `package.json` — register the new test.

---

## Task 1: Global site-settings store + unit test

**Files:** Create `migrations/008_site_settings.sql`, `lib/siteSettings.js`, `test/siteSettings.test.js`; Modify `package.json`

- [ ] **Step 1: Write the migration**

`migrations/008_site_settings.sql`:
```sql
-- Generic global (site-wide) settings, key/value JSONB. First use: disabled_tabs.
CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing test** — `test/siteSettings.test.js`:

```js
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
```

- [ ] **Step 3: Run it — expect failure** — Run: `node test/siteSettings.test.js`
Expected: FAIL — `Cannot find module '../lib/siteSettings'`.

- [ ] **Step 4: Implement `lib/siteSettings.js`:**

```js
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
```

- [ ] **Step 5: Run test — expect pass** — Run: `node test/siteSettings.test.js` → `7 tests: 7 passed, 0 failed`.

- [ ] **Step 6: Register the test** — in `package.json`, append ` && node test/siteSettings.test.js` to the `test` script. Run `npm test` → all green.

- [ ] **Step 7: Commit**
```bash
git add migrations/008_site_settings.sql lib/siteSettings.js test/siteSettings.test.js package.json
git commit -m "feat(settings): global site_settings store + disabled-tabs (migration 008)"
```

---

## Task 2: Site-config API endpoints

**Files:** Modify `server.js`, `routes/admin.js`

- [ ] **Step 1: Instantiate siteSettings in server.js** — near the other lib requires/instantiations (e.g. by `_requestLogDb`):
```js
const { makeSiteSettings } = require('./lib/siteSettings');
const _siteSettings = makeSiteSettings();
```

- [ ] **Step 2: Add the public GET endpoint** — place near `/api/request-log` (e.g. after it):
```js
// Public: every visitor's frontend needs to know which tabs are hidden.
app.get('/api/site-config', async (req, res) => {
  const { TOGGLEABLE_TABS } = require('./lib/siteSettings');
  res.json({ disabledTabs: await _siteSettings.getDisabledTabs(), toggleable: TOGGLEABLE_TABS });
});
```

- [ ] **Step 3: Add the admin POST endpoint** — in `routes/admin.js`, instantiate near the others (`const { makeSiteSettings, TOGGLEABLE_TABS } = require('../lib/siteSettings'); const siteSettings = makeSiteSettings(db);`) and add before `return r;`:
```js
  r.get('/site-config', requireAdmin, async (req, res) => {
    res.json({ disabledTabs: await siteSettings.getDisabledTabs(), toggleable: TOGGLEABLE_TABS });
  });
  r.post('/site-config', requireAdmin, async (req, res) => {
    const tabs = (req.body && req.body.disabledTabs) || [];
    if (!Array.isArray(tabs) || tabs.some(t => !TOGGLEABLE_TABS.includes(t))) {
      return res.status(400).json({ error: 'invalid tab list' });
    }
    try { res.json({ disabledTabs: await siteSettings.setDisabledTabs(tabs) }); }
    catch (e) { console.error('[admin/site-config]', e.message); res.status(500).json({ error: 'save failed' }); }
  });
```

- [ ] **Step 4: Verify boot + endpoint shape (no DB)** — Run `node server.js` briefly, then:
`curl -s http://localhost:7000/api/site-config` → expect `{"disabledTabs":[],"toggleable":[...]}`. Stop the server.

- [ ] **Step 5: Run `npm test`** → all green (no backend logic changed beyond additive routes).

- [ ] **Step 6: Commit**
```bash
git add server.js routes/admin.js
git commit -m "feat(api): public /api/site-config + admin POST /api/admin/site-config"
```

---

## Task 3: Split Install / API Keys into two pages

**Files:** Modify `public/configure.html`, `public/js/shell.js`

- [ ] **Step 1: Add `apikeys` to the router** — in `public/js/shell.js`, change the `PAGES` array to include `'apikeys'`:
```js
const PAGES = ['dashboard','servers','catalogs','streaming','appearance','health','install','apikeys','ping','log','settings','admin','users','billing'];
```

- [ ] **Step 2: Create the API Keys page + relabel Install** — in `public/configure.html`:
  - In `#page-install` (currently titled "API Keys & Manifest", lines ~635–676): change its title to `Install` / sub `Generate your unique Stremio link`, and REMOVE the API-key fields block (the `.field`s for `#trakt-client-id`, `#tmdb-api-key`, `#mdblist-api-key`, `#rpdb-key`, the encryption `.field-hint`, and `#ak-save`). Keep `#acct-link-wrap` (with `#acct-url`, `#acct-copy`, `#acct-regen`, `#acct-install`) and `#result-section`.
  - Add a NEW section immediately after `#page-install`:
    ```html
    <section class="page" id="page-apikeys">
      <h2 class="page-title">API Keys</h2>
      <p class="page-sub">Catalog source keys · stored encrypted</p>
      <!-- paste the removed .field blocks (#trakt-client-id, #tmdb-api-key,
           #mdblist-api-key, #rpdb-key), the encryption .field-hint, and #ak-save here,
           UNCHANGED (same ids/handlers) -->
    </section>
    ```
  - **Preserve every id and inline `oninput`/handler exactly** — only the parent `.page` changes.

- [ ] **Step 3: Update the nav** — in the sidebar nav (lines ~38–41): relabel the existing `data-page="install"` item's `<span>` to `Install`, and add a new item for API Keys (reuse the key icon):
```html
<a class="nav-item" data-page="apikeys"><svg class="nav-ic" viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7.1 7.1 5 5 0 0 1 7.1-7.1Zm0 0L15 8m0 0 3 3 3-3-3-3"/></svg><span>API Keys</span></a>
```
Give the Install item a distinct icon (download/arrow), e.g. keep its current one or use `<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>`.

- [ ] **Step 4: Verify the split in browser (controller)** — `node server.js`; open `/configure`; confirm an "Install" tab shows the link block and a separate "API Keys" tab shows the key fields; both nav items route; key inputs still autosave (ids intact). Stop server.

- [ ] **Step 5: Run `npm test`** → green (frontend-only change). 

- [ ] **Step 6: Commit**
```bash
git add public/configure.html public/js/shell.js
git commit -m "feat(ux): split Install (manifest link) and API Keys (catalog keys) into separate tabs"
```

---

## Task 4: site-controls.js — tab visibility + view-as

**Files:** Create `public/js/site-controls.js`; Modify `public/configure.html`, `public/css/configure.css`

- [ ] **Step 1: Create `public/js/site-controls.js`:**

```js
// ─── Site controls: hide/badge tabs per global config + admin "view as user".
// Tab hiding is client-side UX only. Disabled tabs are hidden from normal users
// (and from admins while previewing); admins otherwise see them with a "disabled" badge.
(function () {
  const state = { role: 'user', disabled: [] };
  const isViewAs = () => { try { return localStorage.getItem('viewAsUser') === '1'; } catch { return false; } };

  function navItem(page) { return document.querySelector(`.nav-item[data-page="${page}"]`); }

  function applyTabs() {
    const asUser = state.role !== 'admin' || isViewAs();
    document.documentElement.classList.toggle('view-as-user', state.role === 'admin' && isViewAs());
    // reset previous badges/hides on toggleable items
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.remove('tab-hidden');
      const b = el.querySelector('.tab-disabled-badge'); if (b) b.remove();
    });
    state.disabled.forEach(page => {
      const item = navItem(page); if (!item) return;
      if (asUser) {
        item.classList.add('tab-hidden');
      } else {
        if (!item.querySelector('.tab-disabled-badge')) {
          const badge = document.createElement('span');
          badge.className = 'tab-disabled-badge'; badge.textContent = 'disabled';
          item.appendChild(badge);
        }
      }
    });
    // if currently on a hidden page, bounce to dashboard
    const cur = (location.hash || '').replace(/^#\//, '');
    if (asUser && state.disabled.includes(cur)) location.hash = '#/dashboard';
    renderBanner();
  }

  function renderBanner() {
    const show = state.role === 'admin' && isViewAs();
    let el = document.getElementById('view-as-banner');
    if (!show) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'view-as-banner';
      el.innerHTML = `<span>👁 Viewing as a normal user</span><button type="button" id="view-as-exit">Exit preview</button>`;
      document.body.appendChild(el);
      el.querySelector('#view-as-exit').addEventListener('click', () => setViewAs(false));
    }
  }

  function setViewAs(on) {
    try { on ? localStorage.setItem('viewAsUser', '1') : localStorage.removeItem('viewAsUser'); } catch {}
    applyTabs();
    document.dispatchEvent(new CustomEvent('viewas-changed', { detail: { on } }));
  }

  async function refresh() {
    try {
      const [me, cfg] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
        fetch('/api/site-config', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
      ]);
      state.role = (me && me.user && me.user.role) || 'user';
      state.disabled = (cfg && Array.isArray(cfg.disabledTabs)) ? cfg.disabledTabs : [];
    } catch {}
    applyTabs();
  }

  window.MEBSite = { refresh, applyTabs, setViewAs, isViewAs, get disabled() { return state.disabled.slice(); }, get role() { return state.role; } };
  window.addEventListener('hashchange', applyTabs);
  document.addEventListener('DOMContentLoaded', refresh);
})();
```

- [ ] **Step 2: Include the script** — in `public/configure.html`, after `js/shell.js` (so nav exists), add `<script src="js/site-controls.js"></script>`.

- [ ] **Step 3: Add CSS** — append to `public/css/configure.css`:
```css
.tab-hidden { display: none !important; }
html.view-as-user .admin-only { display: none !important; }
.tab-disabled-badge { margin-left: auto; font-size: .6rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--warning); background: color-mix(in srgb, var(--warning) 16%, transparent); padding: 1px 6px; border-radius: 999px; }
#view-as-banner { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 12px; background: rgba(20,20,30,.96); backdrop-filter: blur(14px); border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--text-primary); padding: 10px 14px; border-radius: 999px; box-shadow: 0 16px 40px rgba(0,0,0,.5); font-size: .82rem; }
#view-as-banner button { background: var(--accent); color: #0a0a12; border: 0; border-radius: 999px; padding: 4px 10px; font-weight: 700; cursor: pointer; }
```

- [ ] **Step 4: Verify (controller, browser MCP, needs DB)** — Since `disabledTabs` needs DB, verify the no-DB path first: load `/configure`, confirm nothing hidden and no errors, `window.MEBSite` exists. Then exercise `MEBSite.setViewAs(true)` in the console → admin tabs hidden + banner appears; `setViewAs(false)` restores. (Full disabled-tab behavior verified in Task 6 against the deployed DB.)

- [ ] **Step 5: Commit**
```bash
git add public/js/site-controls.js public/configure.html public/css/configure.css
git commit -m "feat(site-controls): apply disabled tabs + admin view-as-user preview"
```

---

## Task 5: Admin "Site controls" card

**Files:** Modify `public/configure.html`, `public/js/admin.js`

- [ ] **Step 1: Add the card markup** — inside `#page-admin` (the System page, starts line ~727), add a card:
```html
<div class="adm-section">
  <h3 class="block-title">Site controls</h3>
  <div class="field" style="display:flex;align-items:center;justify-content:space-between">
    <div><div class="field-label">View as normal user</div><div class="field-hint">Preview the site without admin UI. You keep admin access.</div></div>
    <button type="button" class="switch" id="view-as-switch" role="switch" aria-checked="false"></button>
  </div>
  <h4 class="block-title" style="margin-top:14px;font-size:.85rem">Visible tabs</h4>
  <div class="field-hint">Turn a tab off to hide it from normal users. You still see it (badged) so you can re-enable.</div>
  <div id="site-tabs-list"></div>
</div>
```

- [ ] **Step 2: Wire it in `public/js/admin.js`** — add a loader called from `onRoute()` when `page === 'admin'` (alongside `startMetrics()`). Use the existing `.switch` styling (reuse the appearance toggle pattern). Add:
```js
const TAB_LABELS = { dashboard:'Dashboard', servers:'Servers', catalogs:'Catalogs', streaming:'Streaming', appearance:'Appearance', install:'Install', apikeys:'API Keys', health:'Health', ping:'Ping test', log:'Request log', settings:'Settings', billing:'Billing' };

async function loadSiteControls() {
  const list = $('#site-tabs-list'); if (!list) return;
  const vs = $('#view-as-switch');
  if (vs) {
    const on = window.MEBSite && window.MEBSite.isViewAs();
    vs.classList.toggle('on', !!on); vs.setAttribute('aria-checked', on ? 'true' : 'false');
    if (!vs._w) { vs._w = 1; vs.addEventListener('click', () => {
      const next = !vs.classList.contains('on');
      vs.classList.toggle('on', next); vs.setAttribute('aria-checked', next ? 'true' : 'false');
      if (window.MEBSite) window.MEBSite.setViewAs(next);
    }); }
  }
  const r = await api('/api/admin/site-config');
  if (r.status !== 200 || !r.body) { list.innerHTML = '<div class="field-hint">Site config unavailable.</div>'; return; }
  const disabled = new Set(r.body.disabledTabs || []);
  const tabs = r.body.toggleable || [];
  list.innerHTML = tabs.map(t => `<div class="field" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
    <span>${escU(TAB_LABELS[t] || t)}</span>
    <button type="button" class="switch site-tab-switch ${disabled.has(t) ? '' : 'on'}" data-tab="${escU(t)}" role="switch" aria-checked="${disabled.has(t) ? 'false' : 'true'}"></button></div>`).join('');
  list.querySelectorAll('.site-tab-switch').forEach(sw => sw.addEventListener('click', async () => {
    const enabled = !sw.classList.contains('on');
    sw.classList.toggle('on', enabled); sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
    const next = tabs.filter(t => {
      const el = list.querySelector(`.site-tab-switch[data-tab="${t}"]`);
      return el && !el.classList.contains('on'); // not-on => disabled
    });
    const res = await api('/api/admin/site-config', { method: 'POST', body: JSON.stringify({ disabledTabs: next }) });
    if (res.status === 200) { if (window.toast) window.toast('Tabs updated'); if (window.MEBSite) await window.MEBSite.refresh(); }
    else if (window.toast) window.toast('Update failed');
  }));
}
```
And in `onRoute()`: `if (page === 'admin') { startMetrics(); loadSiteControls(); } else stopMetrics();`

- [ ] **Step 3: Verify (controller, browser MCP)** — On the admin page: the card renders the view-as switch + a switch per tab. Toggling view-as hides admin UI + banner. (Tab on/off persistence verified against DB in Task 6.) Confirm no console errors.

- [ ] **Step 4: Run `npm test`** → green.

- [ ] **Step 5: Commit**
```bash
git add public/configure.html public/js/admin.js
git commit -m "feat(admin): Site controls card — view-as toggle + per-tab switches"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Suite** — Run `npm test` → all suites incl. `siteSettings` green.

- [ ] **Step 2: No-DB safety** — `node server.js`; `/configure` loads, nothing hidden, `MEBSite` present, no console errors; `curl /api/site-config` → `{"disabledTabs":[],"toggleable":[...]}`.

- [ ] **Step 3: Functional (browser MCP)** — drive the UI: as admin, on System page toggle Catalogs off → admin still sees Catalogs nav with a "disabled" badge; toggle view-as on → Catalogs (and all admin tabs) vanish + banner shows; navigate to `#/catalogs` while in view-as → redirected to dashboard; exit view-as → restored. Toggle Catalogs back on → badge clears.

- [ ] **Step 4: Split check** — Install tab shows the manifest/link block only; API Keys tab shows the catalog key fields only; both route; keys autosave; the manifest "Install →" still works.

- [ ] **Step 5: Final commit (if fixes needed)**
```bash
git add -A
git commit -m "fix(site-controls): verification-pass fixes"
```

---

## Self-Review
- **Spec coverage:** site_settings store + lib (T1) ✓; public GET + admin POST (T2) ✓; Install/API-Keys split incl. PAGES + nav + preserved ids (T3) ✓; site-controls.js apply/hide/badge/redirect (T4) ✓; view-as preview + banner + command-palette-friendly global (T4; palette already skips hidden nav) ✓; admin Site-controls card with view-as + per-tab switches (T5) ✓; no-DB `[]` safety (T1/T2/T6) ✓; whitelist validation server-side (T1/T2) ✓; unit tests + browser verification (T1, T6) ✓.
- **Placeholder scan:** none; all code literal; commands have expected output.
- **Name consistency:** `TOGGLEABLE_TABS`, `getDisabledTabs`/`setDisabledTabs`, `disabledTabs`, `toggleable`, `site_settings`/`disabled_tabs` key, `window.MEBSite` (`refresh`/`applyTabs`/`setViewAs`/`isViewAs`), `viewAsUser` localStorage key, `html.view-as-user`, `.tab-hidden`/`.tab-disabled-badge`/`#view-as-banner`, `data-page="apikeys"`/`#page-apikeys` — consistent across tasks.
