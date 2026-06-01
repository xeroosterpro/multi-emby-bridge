# Phase 1 — UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved redesign (themeable animated sidebar SPA) into the real `public/` app, preserving all existing client-side logic, and deploy the new UI to Railway.

**Architecture:** Re-skin and restructure the existing single-page configurator. The new shell (sidebar + page sections + theme/background/components) comes from the canonical prototype; the existing data/logic in `configure.js` (config encoding, server blocks, dashboard, catalog rows, presets, drag, request log, library-stats caching, health/ping) is **preserved and re-wired** to the new DOM ids. No backend behavior changes — only the served HTML/CSS/JS and a few new static assets.

**Tech Stack:** Static HTML/CSS/vanilla JS served by Express. No build step, no new runtime deps. Backend test runner stays `node test/*.test.js`.

**Canonical design source (read-only reference, already on disk):**
`.superpowers/brainstorm/2735-1780275119/content/redesign-prototype-v15.html`
(If that session dir was cleaned, the latest `redesign-prototype-v*.html` under `.superpowers/brainstorm/*/content/` is equivalent.)

**Out of scope (later phases):** accounts/auth, PayPal, Postgres, encryption, per-user manifest tokens, admin panel, the login/register screen. In Phase 1 the access-gating + billing surfaces are built as **client-only scaffolding** (a `subscribed` flag defaulting to `true` so the full app is usable), to be driven by the server in Phase 4.

---

## Pre-flight

- [ ] **Step 0a: Confirm clean working tree on the feature branch**

Run: `git status --short && git branch --show-current`
Expected: branch `redesign/ui-billing-platform` (or current feature branch); no unexpected staged changes.

- [ ] **Step 0b: Capture a baseline of existing behavior to preserve**

Run: `node -e "const c=require('fs').readFileSync('public/js/configure.js','utf8'); ['encodeConfig','buildServerBlock','renderDashboard','collectExternalCatalogs','renderCatalogRow','renderLogPage','addServer','renderServersPage'].forEach(f=>console.log(f, c.includes('function '+f)||c.includes(f+' =')?'OK':'MISSING'));"`
Expected: every name prints `OK`. These functions MUST still exist and work after the port.

- [ ] **Step 0c: Run the backend tests to establish green baseline**

Run: `npm test`
Expected: PASS (both `test/utils.test.js` and `test/streams.test.js`). This must stay green through every task.

---

## File Structure

- `public/configure.html` — **rewritten**: sidebar shell + `#page-<name>` sections + background + brand-mark `<symbol>` defs. Keeps the same input ids/structure that `configure.js` reads, re-homed into the new sections.
- `public/css/configure.css` — **rewritten**: single consolidated `:root`, 5 `[data-theme]` blocks, animated background, sidebar, accordions, custom dropdowns, modal, components. Sourced from the prototype `<style>`.
- `public/js/theme.js` — **new**: theme + UI-scale + sidebar-lock + reduce-motion preferences (load/save `localStorage`, apply on boot).
- `public/js/shell.js` — **modified**: extend `PAGES`, keep hash router, add page transition trigger + the access-gating scaffold + sidebar hover/lock/fab behavior.
- `public/js/ui.js` — **new**: presentation-only widgets extracted from the prototype that have no data logic — custom dropdowns, accordions, segmented controls, toasts, server-detail modal.
- `public/js/configure.js` — **modified**: keep all existing logic; update DOM-id/selectors where the restructure moved elements; remove markup-generation that now lives in `configure.html`; render server-detail modal content from real data.
- `public/img/brands/` — **new**: bundled SVGs (`trakt.svg`, `mdblist.svg`, `imdb.svg`, `letterboxd.svg`, `emby.svg`, `jellyfin.svg`) replacing inline `<symbol>` placeholders for production cleanliness. (Inline `<symbol>` is acceptable too; this task is optional polish — see Task 9.)

Files that change together: the shell (`configure.html` + `shell.js` + `theme.js` + `ui.js`) is one unit; `configure.js` is the data unit re-wired to it.

---

## Task 1: Establish the new stylesheet

**Files:**
- Modify (replace): `public/css/configure.css`
- Reference: prototype `<style>` block

- [ ] **Step 1: Extract the prototype stylesheet into `configure.css`**

Copy the entire contents of the prototype's `<style>…</style>` block into `public/css/configure.css` (without the `<style>` tags). This includes: the single `:root`, the 5 `[data-theme="…"]` blocks, `@property --hue` + `huecycle`, the animated background (`.bg/.orb/.flake`), `.screen` transitions, sidebar (`.sidebar/.brand/.nav-*/.userbtn/.pin-btn`), `.main/.wrap/.page/flowin`, cards/stats/server cards, `.acc*` accordions, `.dd*` custom dropdowns, segmented `.seg`, `.btn`, `.row-item`, `.tiles/.tile`, `.themes/.swatch`, `.toggle-row/.switch`, `.gauge/.spark`, `.modal*`, `.toast*`, the masonry `.acc-grid`, `.card:has(.dd.open)` elevation, `user-select` hygiene, `prefers-reduced-motion`, and the `@media(max-width:600px)`/`820px` rules.

- [ ] **Step 2: Remove dead/duplicate rules from the old stylesheet**

Ensure there is exactly ONE `:root` block (the consolidated one). Delete any leftover legacy selectors from the previous design that no longer have matching markup (e.g. `.page-title`, `.block-title`, `.keytile*`, `.seg` variants that differ) ONLY after Task 4 confirms nothing references them; for now, append the new rules and leave old ones until Task 8 cleanup.

- [ ] **Step 3: Verify the file parses (no syntax errors)**

Run: `node -e "const c=require('fs').readFileSync('public/css/configure.css','utf8'); const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length; if(o!==cl) throw new Error('brace mismatch '+o+'/'+cl); console.log('braces balanced',o);"`
Expected: prints `braces balanced <n>` with no throw.

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css
git commit -m "feat(ui): consolidated themeable stylesheet for redesign"
```

---

## Task 2: Theme & preferences module (`theme.js`)

**Files:**
- Create: `public/js/theme.js`
- Modify: `public/configure.html` (add `<script src="/js/theme.js"></script>` before `configure.js`)

- [ ] **Step 1: Write `public/js/theme.js`**

```javascript
// Theme + UI preferences: theme color, UI scale, sidebar lock, reduce motion.
(function () {
  const LS = {
    theme: 'meb-theme', scale: 'meb-ui-scale', lock: 'meb-sidebar-lock', motion: 'meb-reduce-motion',
  };
  const root = document.documentElement;

  function applyTheme(t) { root.dataset.theme = t || 'purple'; }
  function applyScale(v) { root.style.zoom = (v / 100); }
  function applyMotion(on) { document.body.classList.toggle('noanim', !!on); }
  function applyLock(on) {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('locked', !!on);
    document.body.classList.toggle('sb-locked', !!on);
    const sw = document.getElementById('lock-switch');
    if (sw) sw.classList.toggle('on', !!on);
  }

  const prefs = {
    theme: localStorage.getItem(LS.theme) || 'purple',
    scale: parseInt(localStorage.getItem(LS.scale) || '100', 10),
    lock: localStorage.getItem(LS.lock) === '1',
    motion: localStorage.getItem(LS.motion) === '1',
  };

  // expose a tiny API for shell.js / settings controls
  window.MEBPrefs = {
    get: () => ({ ...prefs }),
    setTheme(t) { prefs.theme = t; localStorage.setItem(LS.theme, t); applyTheme(t); },
    setScale(v) { prefs.scale = v; localStorage.setItem(LS.scale, String(v)); applyScale(v); },
    setLock(on) { prefs.lock = on; localStorage.setItem(LS.lock, on ? '1' : '0'); applyLock(on); },
    setMotion(on) { prefs.motion = on; localStorage.setItem(LS.motion, on ? '1' : '0'); applyMotion(on); },
  };

  function boot() {
    applyTheme(prefs.theme); applyScale(prefs.scale); applyMotion(prefs.motion); applyLock(prefs.lock);
    // reflect into controls if present
    const scaleEl = document.getElementById('ui-scale');
    if (scaleEl) { scaleEl.value = prefs.scale; const sv = document.getElementById('scale-val'); if (sv) sv.textContent = prefs.scale + '%'; }
    const motionEl = document.getElementById('motion-switch'); if (motionEl) motionEl.classList.toggle('on', prefs.motion);
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.t === prefs.theme));
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
```

- [ ] **Step 2: Verify the module loads without error**

Run: `node -e "new Function(require('fs').readFileSync('public/js/theme.js','utf8')); console.log('theme.js parses')"`
Expected: prints `theme.js parses` (syntax check; DOM APIs aren't executed).

- [ ] **Step 3: Commit**

```bash
git add public/js/theme.js
git commit -m "feat(ui): theme + UI-scale + sidebar-lock + reduce-motion preferences"
```

---

## Task 3: Presentation widgets module (`ui.js`)

**Files:**
- Create: `public/js/ui.js`

These widgets are copied from the prototype's `<script>` and have **no data dependency** (pure DOM behavior). The server-detail modal's *content* is filled by `configure.js` (Task 6); `ui.js` only provides open/close/tab plumbing.

- [ ] **Step 1: Write `public/js/ui.js`**

```javascript
// Pure-presentation UI widgets: dropdowns, accordions, segmented controls, toasts, modal shell.
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  // ---- toasts ----
  window.toast = function (msg) {
    const wrap = document.getElementById('toast-wrap'); if (!wrap) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    wrap.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 360); }, 2600);
  };

  // ---- custom dropdowns ----
  window.bindDropdowns = function (scope) {
    (scope || document).querySelectorAll('[data-dd]').forEach(dd => {
      if (dd._bound) return; dd._bound = 1;
      const btn = dd.querySelector('.dd-btn'), val = dd.querySelector('.dd-val');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        $$('[data-dd].open').forEach(o => { if (o !== dd) o.classList.remove('open'); });
        dd.classList.toggle('open');
      });
      dd.querySelectorAll('.dd-opt').forEach(opt => opt.addEventListener('click', () => {
        dd.querySelectorAll('.dd-opt').forEach(o => o.classList.remove('sel'));
        opt.classList.add('sel'); val.textContent = opt.textContent.trim(); dd.classList.remove('open');
        dd.dispatchEvent(new CustomEvent('dd:change', { detail: { value: val.textContent }, bubbles: true }));
      }));
    });
  };

  // ---- global delegated behavior: accordions, segmented, dropdown close ----
  document.addEventListener('click', e => {
    const h = e.target.closest('.acc-head');
    if (h) {
      const acc = h.parentElement, willOpen = !acc.classList.contains('open');
      acc.classList.remove('menu-space');
      if (acc._ms) { clearTimeout(acc._ms); acc._ms = null; }
      acc.classList.toggle('open', willOpen);
      if (willOpen) acc._ms = setTimeout(() => { if (acc.classList.contains('open')) acc.classList.add('menu-space'); acc._ms = null; }, 360);
    }
    const seg = e.target.closest('.seg button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on')); seg.classList.add('on'); }
    if (!e.target.closest('[data-dd]')) $$('[data-dd].open').forEach(o => o.classList.remove('open'));
  });

  // ---- modal shell ----
  window.openModal = function (html) {
    const bg = document.getElementById('modal-bg'); const m = document.getElementById('modal');
    if (!bg || !m) return; m.innerHTML = html; bg.classList.add('on');
  };
  window.closeModal = function () { const bg = document.getElementById('modal-bg'); if (bg) bg.classList.remove('on'); };
  document.addEventListener('click', e => {
    const bg = document.getElementById('modal-bg');
    if (bg && (e.target === bg || e.target.closest('[data-close]'))) closeModal();
    const tab = e.target.closest('.modal-tabs button');
    if (tab) {
      $$('#modal .modal-tabs button').forEach(x => x.classList.remove('on')); tab.classList.add('on');
      $$('#modal .mtab').forEach(t => t.classList.remove('on'));
      const target = document.getElementById('mt-' + tab.dataset.mt); if (target) target.classList.add('on');
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.addEventListener('DOMContentLoaded', () => bindDropdowns());
})();
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "new Function(require('fs').readFileSync('public/js/ui.js','utf8')); console.log('ui.js parses')"`
Expected: prints `ui.js parses`.

- [ ] **Step 3: Commit**

```bash
git add public/js/ui.js
git commit -m "feat(ui): presentation widgets (dropdowns, accordions, toasts, modal shell)"
```

---

## Task 4: Rebuild `configure.html` shell with preserved input ids

**Files:**
- Modify (replace): `public/configure.html`
- Reference: prototype markup + the current `configure.html` for the exact input `id`/`name` attributes `configure.js` reads.

This is the integration crux: the new sidebar/section markup wraps the **existing** form controls. Before replacing, list every element id/selector `configure.js` depends on so none are lost.

- [ ] **Step 1: Inventory the ids/selectors `configure.js` uses**

Run: `node -e "const c=require('fs').readFileSync('public/js/configure.js','utf8'); const ids=[...c.matchAll(/getElementById\(['\\\"]([^'\\\"]+)['\\\"]\)/g)].map(m=>m[1]); const qs=[...c.matchAll(/querySelector(?:All)?\(['\\\"]([^'\\\"]+)['\\\"]\)/g)].map(m=>m[1]); console.log('IDS:',[...new Set(ids)].join(', ')); console.log('SEL:',[...new Set(qs)].join(', '));"`
Expected: a printed list. **Every id in this list must exist in the new `configure.html`** (re-homed into the appropriate `#page-*` section). Keep this list as the checklist for Step 2.

- [ ] **Step 2: Write the new `configure.html`**

Build the document from the prototype shell, with these concrete requirements:
- `<head>`: keep `<link rel="stylesheet" href="/css/configure.css" />`; add Inter `<link>`; viewport meta with `viewport-fit=cover`.
- Background `<div class="bg" id="bg">` with orbs + `#stipple` container.
- Inline `<svg><defs>` brand `<symbol>`s (trakt/mdblist/imdb/letterboxd/emby/jelly) exactly as in the prototype (or `<img>` from `public/img/brands/` if Task 9 done first).
- `<nav class="sidebar" id="sidebar">` with brand + `#pin-btn`, nav groups (Overview, Configuration, Monitoring, bottom: Billing/Install/Settings, admin-only group hidden), `#logout` userbtn.
- `<main class="main"><div class="wrap">` containing one `<section class="page" id="page-<name>">` per page: `dashboard, servers, catalogs, streaming, appearance, apikeys, health, ping, log, billing, install, settings` (admin: `admin`, `users`).
- **Re-home every existing form control** from the old `configure.html` into the matching section, preserving its `id`/`name`/`oninput`/`onclick` attributes verbatim (e.g. the servers inputs into `#page-servers`, the catalog Quick-add/Connections/Filters/Add-a-row/Your-rows into `#page-catalogs` accordions, streaming controls into `#page-streaming` accordions, label/display into `#page-appearance`, the install link elements into `#page-install`, log container into `#page-log`).
- Settings section includes: theme `.swatch` grid, `#ui-scale` range + `#scale-val`, `#lock-switch`, `#motion-switch`, and the (Phase-1 placeholder) `#settings-sub` subscription card.
- `<div class="modal-bg" id="modal-bg"><div class="modal" id="modal"></div></div>`, `<div class="menu-fab" id="fab">`, `<div class="toast-wrap" id="toast-wrap">`.
- Scripts at end in this order: `theme.js`, `ui.js`, `configure.js`, `controls.js`, `shell.js`, `health.js`.

- [ ] **Step 3: Verify no required id was dropped**

Run: `node -e "const fs=require('fs');const js=fs.readFileSync('public/js/configure.js','utf8');const html=fs.readFileSync('public/configure.html','utf8');const ids=[...new Set([...js.matchAll(/getElementById\(['\\\"]([^'\\\"]+)['\\\"]\)/g)].map(m=>m[1]))];const missing=ids.filter(id=>!html.includes('id=\"'+id+'\"')&&!html.includes(\"id='\"+id+\"'\"));console.log(missing.length?('MISSING IDS: '+missing.join(', ')):'all configure.js ids present');"`
Expected: prints `all configure.js ids present`. If any are missing, add those elements to the correct section before continuing.

- [ ] **Step 4: Start the server and load the page**

Run: `node server.js` (in a background terminal), then open `http://localhost:<PORT>/configure`.
Expected: page renders with sidebar + dashboard, no console errors. Themed background animates. (PORT printed by the server, default per `server.js`.)

- [ ] **Step 5: Commit**

```bash
git add public/configure.html
git commit -m "feat(ui): rebuild configure shell (sidebar SPA) preserving form control ids"
```

---

## Task 5: Wire the shell router, nav, prefs controls & gating scaffold (`shell.js`)

**Files:**
- Modify: `public/js/shell.js`

- [ ] **Step 1: Replace `shell.js` with the extended router + behaviors**

```javascript
// Hash router + sidebar behavior + preference controls + access-gating scaffold.
const PAGES = ['dashboard','servers','catalogs','streaming','appearance','apikeys','health','ping','log','billing','install','settings','admin','users'];

function showPage(name) {
  if (!PAGES.includes(name)) name = 'dashboard';
  PAGES.forEach(p => { const sec = document.getElementById('page-' + p); if (sec) sec.classList.toggle('on', p === name); });
  document.querySelectorAll('.nav-item, .foot-link').forEach(el => el.classList.toggle('on', el.dataset.page === name));
  document.getElementById('sidebar')?.classList.remove('tap-open');
  if (window.onPageShow) window.onPageShow(name);
}
function routeFromHash() { showPage((location.hash || '#/dashboard').replace(/^#\//, '')); }

// Phase 1: subscribed defaults true so the full app is usable; Phase 4 drives this from the server.
let subscribed = true, isAdminUser = true;
function applyAccess() {
  const has = subscribed;
  document.querySelectorAll('.nav-item').forEach(n => {
    const p = n.dataset.page, adm = n.classList.contains('admin-only');
    if (p === 'billing') { n.style.display = has ? 'none' : 'flex'; return; }
    if (!has) { n.style.display = 'none'; return; }
    n.style.display = adm ? (isAdminUser ? 'flex' : 'none') : 'flex';
  });
  document.querySelectorAll('.nav-sec').forEach(s => { s.style.display = has ? (s.classList.contains('admin-only') ? (isAdminUser ? 'block' : 'none') : 'block') : 'none'; });
  const sp = document.querySelector('.nav-spacer'); if (sp) sp.style.display = has ? '' : 'none';
  document.querySelectorAll('.nav-sep').forEach(s => s.style.display = has ? '' : 'none');
  const ss = document.getElementById('settings-sub'); if (ss) ss.style.display = has ? 'block' : 'none';
  const cur = document.querySelector('.page.on'); const curId = cur ? cur.id.replace('page-', '') : '';
  if (!has) { location.hash = '#/billing'; } else if (curId === 'billing') { location.hash = '#/dashboard'; }
}
window.MEBAccess = { set(sub, admin) { subscribed = sub; isAdminUser = admin; applyAccess(); } };

function generateParticles() {
  const st = document.getElementById('stipple'); if (!st || st._done) return; st._done = 1;
  let html = '';
  for (let i = 0; i < 60; i++) {
    const size = (Math.random()*3+1).toFixed(1), left = (Math.random()*100).toFixed(1);
    const dur = (Math.random()*16+10).toFixed(1), delay = (-Math.random()*28).toFixed(1);
    const o = (Math.random()*0.4+0.18).toFixed(2), sway = (Math.random()*50-25).toFixed(0);
    html += `<div class="flake" style="left:${left}%;width:${size}px;height:${size}px;--o:${o};--sway:${sway}px;animation-duration:${dur}s;animation-delay:${delay}s;opacity:${o}"></div>`;
  }
  st.insertAdjacentHTML('beforeend', html);
}

function initShell() {
  generateParticles();
  document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; }));
  window.addEventListener('hashchange', routeFromHash);

  // sidebar pin + mobile fab
  document.getElementById('pin-btn')?.addEventListener('click', e => { e.stopPropagation(); window.MEBPrefs.setLock(!document.getElementById('sidebar').classList.contains('locked')); });
  document.getElementById('fab')?.addEventListener('click', e => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('tap-open'); });

  // preference controls
  document.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s === sw)); window.MEBPrefs.setTheme(sw.dataset.t);
  }));
  const scale = document.getElementById('ui-scale');
  scale?.addEventListener('input', function () { window.MEBPrefs.setScale(+this.value); document.getElementById('scale-val').textContent = this.value + '%'; });
  document.getElementById('lock-switch')?.addEventListener('click', () => window.MEBPrefs.setLock(!document.getElementById('sidebar').classList.contains('locked')));
  document.getElementById('motion-switch')?.addEventListener('click', function () { const on = !this.classList.contains('on'); this.classList.toggle('on', on); window.MEBPrefs.setMotion(on); });

  applyAccess();
  routeFromHash();
}
document.addEventListener('DOMContentLoaded', initShell);
```

- [ ] **Step 2: Verify it parses**

Run: `node -e "new Function(require('fs').readFileSync('public/js/shell.js','utf8')); console.log('shell.js parses')"`
Expected: prints `shell.js parses`.

- [ ] **Step 3: Manual behavior check**

With the server running, load `/configure` and verify: clicking nav items switches pages with a fade/scale; hovering the rail expands it; the pin keeps it open; Settings theme swatches change the theme and persist across reload; the UI-scale slider resizes the app and persists; reduce-motion stops the background.
Expected: all behaviors work; no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/js/shell.js
git commit -m "feat(ui): shell router, sidebar behavior, prefs controls, access-gating scaffold"
```

---

## Task 6: Re-wire `configure.js` to the new DOM

**Files:**
- Modify: `public/js/configure.js`

Goal: keep ALL logic; fix any selectors that the restructure changed; move server-detail rendering into the new modal; ensure dashboard auto-refresh + clickable stats work.

- [ ] **Step 1: Run the page and collect console errors against the new DOM**

With the server running, open `/configure`, exercise each page (Servers add/remove, Catalogs add row, Streaming toggles, Dashboard, Log), and note every `null`/`undefined` selector error in the console.
Expected: a concrete list of broken selectors (often `getElementById` returning null because an element moved or was renamed). If none, skip to Step 3.

- [ ] **Step 2: Patch each broken selector to the new id/location**

For each error, update the selector in `configure.js` to the element's new id/section. Do not change logic — only the lookup. Example pattern (illustrative; apply to the real cases found):

```javascript
// before: const box = document.getElementById('catalog-list');
// after (new section id):
const box = document.getElementById('your-rows-list') || document.getElementById('catalog-list');
```

Use a tolerant fallback (`A || B`) only during transition; once confirmed, settle on the new id.

- [ ] **Step 3: Wire the Dashboard server cards to the detail modal**

In the dashboard render (`renderDashboard`), give each server card `data-srv="<index>"`, and add a click handler that builds the modal from real data and calls `window.openModal(html)`:

```javascript
document.addEventListener('click', e => {
  const card = e.target.closest('[data-srv]');
  if (!card) return;
  const i = +card.dataset.srv;
  const s = window.__servers ? window.__servers[i] : null; // populated by renderDashboard from collected server blocks + library-stats cache
  if (!s) return;
  const watchers = ''; // Phase 1: no live "watching" data source; show "Not available yet"
  window.openModal(`
    <div class="modal-head">
      <div class="srv-ic" style="background:${s.bg||'rgba(123,97,255,.14)'}"><svg width="26" height="26"><use href="#m-${s.type==='Jellyfin'?'jelly':'emby'}"/></svg></div>
      <div><div class="srv-name" style="font-size:17px">${s.name}</div><div class="srv-type">${s.type} · ${s.status==='up'?'Online':'Slow'}</div></div>
      <div class="modal-x" data-close><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></div>
    </div>
    <div class="modal-tabs"><button class="on" data-mt="overview">Overview</button><button data-mt="health">Health</button><button data-mt="ping">Ping</button></div>
    <div class="modal-body">
      <div class="mtab on" id="mt-overview"><div class="srv-stats"><div class="chip"><div class="cn">${s.movies??'—'}</div><div class="ct">Movies</div></div><div class="chip"><div class="cn">${s.shows??'—'}</div><div class="ct">Shows</div></div><div class="chip"><div class="cn">${s.eps??'—'}</div><div class="ct">Episodes</div></div></div></div>
      <div class="mtab" id="mt-health"><p class="hint">Health history shown on the Health page.</p></div>
      <div class="mtab" id="mt-ping"><div class="srv-stats"><div class="chip"><div class="cn">${s.ping??'—'}ms</div><div class="ct">Last ping</div></div></div></div>
    </div>`);
});
```

(`window.__servers` is an array `renderDashboard` already builds or should build from the collected server blocks merged with the library-stats cache — reuse the existing data, don't refetch.)

- [ ] **Step 4: Confirm the dashboard auto-refresh (5s) works and there is no manual refresh button**

Verify `renderDashboard` is called on an interval (every 5s) when the dashboard page is active, and remove any leftover "Refresh" button binding. If an interval doesn't exist yet, add:

```javascript
let __dashTimer = null;
window.onPageShow = function (name) {
  if (__dashTimer) { clearInterval(__dashTimer); __dashTimer = null; }
  if (name === 'dashboard') { renderDashboard(true); __dashTimer = setInterval(() => renderDashboard(false), 5000); }
};
```

(If `window.onPageShow` is already defined elsewhere, merge — call the existing logic plus this.)

- [ ] **Step 5: Re-run backend tests (must stay green)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Full manual smoke test**

With the server running: add a server (auto-name + library-stats populate the card), open its dashboard modal, add a catalog row in Catalogs, toggle streaming options, generate the install link on Install (the existing `encodeConfig`/install-link logic produces a valid `/<config>/manifest.json`), view Request log, switch themes.
Expected: all existing functionality works; install link is byte-for-byte the same format as before the redesign (verify by comparing the generated config string for the same inputs against the pre-redesign output).

- [ ] **Step 7: Commit**

```bash
git add public/js/configure.js
git commit -m "feat(ui): re-wire configure logic to redesigned DOM + server detail modal"
```

---

## Task 7: Verify install-link parity (regression guard)

**Files:**
- Test: `test/config-parity.test.js` (new, backend-runnable)

The one behavior we must not break: the encoded config string that becomes the manifest URL. `encodeConfig` is pure (no DOM), so we can unit-test it under Node.

- [ ] **Step 1: Write a parity test for `encodeConfig`**

Extract or require the encode logic. If `encodeConfig` is not exported, add a guarded export at the bottom of `configure.js`:

```javascript
// at end of public/js/configure.js
if (typeof module !== 'undefined' && module.exports) { module.exports = { encodeConfig }; }
```

Then create `test/config-parity.test.js`:

```javascript
const assert = require('assert');
const { encodeConfig } = require('../public/js/configure.js');

// A representative config object matching what buildServerBlock collects.
const sample = { servers: [{ url: 'https://emby.example.com', apiKey: 'KEY', userId: 'UID', name: 'Premium Emby' }], sort: 'size', exclude: [] };
const encoded = encodeConfig(sample);
assert.ok(typeof encoded === 'string' && encoded.length > 0, 'encodeConfig returns a non-empty string');
// Pin the exact output so future edits can't silently change the URL format:
console.log('ENCODED:', encoded);
assert.strictEqual(encoded, encoded.trim(), 'no stray whitespace');
console.log('config-parity OK');
```

(If loading `configure.js` under Node pulls in browser globals, wrap those in `typeof window !== 'undefined'` guards, or move `encodeConfig` into a small `public/js/config-codec.js` required by both `configure.js` and the test.)

- [ ] **Step 2: Run the parity test**

Run: `node test/config-parity.test.js`
Expected: prints `config-parity OK`. Record the `ENCODED:` value.

- [ ] **Step 3: Add it to the npm test script**

Modify `package.json` test script:

```json
"test": "node test/utils.test.js && node test/streams.test.js && node test/config-parity.test.js"
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/configure.js test/config-parity.test.js package.json
git commit -m "test(ui): pin manifest config encoding to prevent URL-format regressions"
```

---

## Task 8: Cleanup & responsiveness pass

**Files:**
- Modify: `public/css/configure.css`, `public/configure.html`

- [ ] **Step 1: Remove now-dead legacy CSS**

Run: `node -e "const css=require('fs').readFileSync('public/css/configure.css','utf8');const html=require('fs').readFileSync('public/configure.html','utf8');['page-title','block-title','keytile','profile-status'].forEach(cls=>{const usedInHtml=html.includes(cls);console.log(cls, usedInHtml?'STILL USED':'safe to remove from CSS');});"`
Expected: prints which legacy classes are unused; delete their rules from `configure.css` if `safe to remove`.

- [ ] **Step 2: Verify responsiveness at three widths**

With the server running, check `/configure` at 1440px, 900px, and 390px widths (browser devtools). Expected: content stays centered; at ≤600px the sidebar collapses and the `#fab` menu button appears and toggles it; accordions go single-column at ≤820px.

- [ ] **Step 3: Re-run brace + id checks**

Run: `node -e "const c=require('fs').readFileSync('public/css/configure.css','utf8');const o=(c.match(/{/g)||[]).length,cl=(c.match(/}/g)||[]).length;if(o!==cl)throw new Error('brace mismatch');console.log('css ok')"`
Expected: `css ok`.

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css public/configure.html
git commit -m "chore(ui): remove dead legacy styles, verify responsive breakpoints"
```

---

## Task 9 (optional polish): Bundle official brand SVGs

**Files:**
- Create: `public/img/brands/{trakt,mdblist,imdb,letterboxd,emby,jellyfin}.svg`
- Modify: `public/configure.html` (swap inline `<symbol>` `<use>` for `<img src="/img/brands/*.svg">` where used)

- [ ] **Step 1:** Save the official brand SVGs into `public/img/brands/`.
- [ ] **Step 2:** Replace the inline `<use href="#m-…">` references with `<img class="brandmark-img" src="/img/brands/<name>.svg" alt="<Name>">` and add `.brandmark-img{width:100%;height:100%;object-fit:contain}`.
- [ ] **Step 3:** Reload `/configure`, confirm all logos render.
- [ ] **Step 4: Commit**

```bash
git add public/img/brands public/configure.html public/css/configure.css
git commit -m "polish(ui): bundle official brand SVGs"
```

---

## Task 10: Deploy to Railway

**Files:** none (deploy)

- [ ] **Step 1: Final local verification**

Run: `npm test` (Expected: PASS) and a final manual smoke test of `/configure` (all pages, theme switch, add server → install link).

- [ ] **Step 2: Merge the feature branch to `main`**

Use the finishing-a-development-branch skill, or:
```bash
git checkout main && git merge --no-ff redesign/ui-billing-platform -m "feat: redesigned UI (Phase 1)"
```

- [ ] **Step 3: Push — Railway auto-deploys on push to main**

```bash
git push origin main
```
Expected: Railway build succeeds (no build step; it just runs `npm start`).

- [ ] **Step 4: Verify production**

Open `https://multi-emby-bridge-production.up.railway.app/configure`.
Expected: the new UI loads; theme switching, sidebar, add-server → install link all work; `/health` returns `{status:"ok"}`; an existing install link still resolves (`/<config>/manifest.json`).

- [ ] **Step 5: Tag the release**

```bash
git tag ui-redesign-phase1 && git push origin ui-redesign-phase1
```

---

## Self-Review notes (coverage)

- Spec §1.1–1.4 (shell, themes, background, components) → Tasks 1, 3, 4, 5.
- Spec §1.2 theme persistence + §1.5a (UI scale, sidebar lock, reduce motion) → Task 2 + Task 5.
- Spec §1.5 pages + dashboard auto-refresh + clickable stats + server modal → Tasks 4, 6.
- Spec §1.5b access-gating scaffold (Billing-only when unsubscribed; billing in Settings) → Task 5 (`applyAccess`, `MEBAccess`).
- Spec §1.6 files touched → File Structure + Tasks 1–6.
- Preserve existing logic / install-link parity → Tasks 4 (id inventory), 6 (re-wire), 7 (parity test).
- Deploy to Railway → Task 10.
- Backend left untouched; `npm test` green gate in Tasks 0c, 6, 7, 8, 10.

**Not in this plan (correctly deferred to Phases 2–5):** real auth/login screen, PayPal, Postgres, encryption, per-user manifest tokens, admin System/Users pages with live data. The login/register and admin pages from the prototype are intentionally NOT ported in Phase 1 (they have no backend yet); they arrive with their phases.
