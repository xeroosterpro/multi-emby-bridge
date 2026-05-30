# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single long-scrolling configure page with a warm, friendly, sidebar-driven UI (OMEGA-Media inspired) that carries over every existing feature, plus a new Dashboard and animated RGB accents.

**Architecture:** Vanilla HTML/CSS/JS served by Express, no build step. `configure.html` becomes a sidebar **shell**; a tiny hash router in a new `shell.js` shows/hides page `<section>`s without reloads, keeping all `localStorage` config + autosave logic in `configure.js` alive. `servers.html` is merged in as the Health page. All existing business logic (autosave, install-link generation, `/api/library-stats`, pings) is reused unchanged.

**Tech Stack:** Express 4, vanilla JS (no framework, no bundler), CSS custom properties + keyframe animations, browser-based manual verification (Node tests only cover backend and stay green).

---

## Verification convention

There is no frontend test harness, and this is a visual reskin — do not invent one. Every task is verified the same way:

1. Run the server: `npm start` (serves on `http://localhost:7000` unless `PORT` is set — confirm the port in the `server.js` listen log).
2. Open `http://localhost:7000/configure` (add `#/<page>` where a task names a page).
3. Confirm: the page renders, the DevTools **Console has zero errors**, and the described elements appear.
4. Take a screenshot for the review record.
5. Backend tests must still pass: `npm test` → expect both `utils.test.js` and `streams.test.js` to print their pass output and exit 0.

A task "passes" when steps 3 + 5 hold. Commit only after that.

---

## File structure

- **Create** `public/js/shell.js` — sidebar nav, hash router, page registry, Dashboard render, server-card render, Quick Install modal. New presentation layer.
- **Rewrite** `public/configure.html` — sidebar shell with one `<section class="page" id="page-...">` per destination; loads `configure.js` then `shell.js`.
- **Rewrite** `public/css/configure.css` — new warm + RGB design system (tokens, base, sidebar, cards, tiles, animations, responsive, reduced-motion).
- **Modify** `public/js/configure.js` — expose render hooks the shell calls; move server-card markup into a render function the shell can call; keep all existing logic.
- **Merge** `public/servers.html` → Health page section + its script folded into `shell.js` (or a `health.js`); keep `/servers` route as a redirect.
- **Modify** `server.js:146` — change `/servers` from `sendFile(servers.html)` to `res.redirect('/configure#/health')`.

Each task below produces a self-contained, viewable increment.

---

## Task 1: Design-system CSS foundation (tokens + base + animations)

Replace the old stylesheet's top with the new design tokens and keyframes. We build the system first so every later page inherits it. Old rules remain below temporarily; they are removed as pages migrate.

**Files:**
- Modify: `public/css/configure.css` (prepend new `:root` + base + keyframes block at top of file)

- [ ] **Step 1: Add tokens, base reset, and keyframes**

Insert at the very top of `public/css/configure.css`:

```css
/* ============ Multi-Emby warm design system ============ */
:root {
  --bg-grad-a: #1a1420;
  --bg-grad-b: #0f0c14;
  --surface: #1c1622;
  --surface-2: #241c2b;
  --border: #2c2333;
  --text: #f0ebf0;
  --text-dim: #b6abb8;
  --text-mute: #8a7f88;
  --accent-a: #fb923c;   /* orange */
  --accent-b: #f472b6;   /* pink   */
  --accent-c: #818cf8;   /* indigo */
  --accent-d: #34d399;   /* mint   */
  --warn: #fcd34d;
  --grad-accent: linear-gradient(90deg, var(--accent-a), var(--accent-b));
  --grad-rgb: linear-gradient(90deg, #fb923c, #f472b6, #818cf8, #34d399, #fb923c);
  --r-sm: 11px; --r-md: 14px; --r-lg: 17px;
  --side-w: 210px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  color: var(--text);
  background: linear-gradient(160deg, var(--bg-grad-a), var(--bg-grad-b)) fixed;
  min-height: 100vh;
}
@keyframes rgbflow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
@keyframes spin    { to { transform: rotate(360deg); } }
@keyframes pulse   { 0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)} 50%{box-shadow:0 0 0 6px rgba(52,211,153,0)} }
@keyframes sheen   { 0%{transform:translateX(-120%)} 60%,100%{transform:translateX(220%)} }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 2: Verify foundation loads**

Run `npm start`, open `http://localhost:7000/configure`. The page still shows the OLD layout (expected — not migrated yet) but the **background is now the warm gradient** and Console has zero errors.

- [ ] **Step 3: Commit**

```bash
git add public/css/configure.css
git commit -m "Add warm design-system tokens, base, and keyframes"
```

---

## Task 2: Sidebar shell HTML scaffold

Rewrite `configure.html` into the shell: a sidebar plus empty page sections. Page bodies are filled by later tasks (by moving existing markup in). For now each section shows a placeholder so routing is testable.

**Files:**
- Rewrite: `public/configure.html`

- [ ] **Step 1: Replace the file body with the shell**

Replace the entire `<body>` of `public/configure.html` with:

```html
<body>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand">◢ Multi-Emby</div>
      <nav class="nav" id="nav">
        <a class="nav-item" data-page="dashboard">🏠 <span>Dashboard</span></a>
        <a class="nav-item" data-page="servers">⛁ <span>Servers</span></a>
        <a class="nav-item" data-page="catalogs">⛬ <span>Catalogs</span></a>
        <a class="nav-item" data-page="streaming">▶ <span>Streaming</span></a>
        <a class="nav-item" data-page="appearance">🎨 <span>Appearance</span></a>
        <a class="nav-item" data-page="health">♥ <span>Health</span></a>
      </nav>
      <div class="sidebar-foot">
        <button class="quick-install" id="quick-install">⬇ Quick Install</button>
        <div class="foot-links">
          <a class="foot-link" data-page="install">Install</a>
          <a class="foot-link" data-page="ping">Ping</a>
          <a class="foot-link" data-page="log">Log</a>
        </div>
        <div class="save-indicator" id="autosave-indicator">✓ Settings saved</div>
      </div>
    </aside>

    <main class="content" id="content">
      <section class="page" id="page-dashboard"><div class="page-ph">Dashboard</div></section>
      <section class="page" id="page-servers"><div class="page-ph">Servers</div></section>
      <section class="page" id="page-catalogs"><div class="page-ph">Catalogs</div></section>
      <section class="page" id="page-streaming"><div class="page-ph">Streaming</div></section>
      <section class="page" id="page-appearance"><div class="page-ph">Appearance</div></section>
      <section class="page" id="page-health"><div class="page-ph">Health</div></section>
      <section class="page" id="page-install"><div class="page-ph">Install</div></section>
      <section class="page" id="page-ping"><div class="page-ph">Ping Test</div></section>
      <section class="page" id="page-log"><div class="page-ph">Request Log</div></section>
    </main>
  </div>

  <div id="global-error"></div>
  <div id="result-section"></div>

  <script src="/js/configure.js"></script>
  <script src="/js/shell.js"></script>
</body>
```

Keep the existing `<head>` (it already links `/css/configure.css`).

- [ ] **Step 2: Verify (will look unstyled until Task 3)**

Run `npm start`, open `/configure`. Expect the nav links and placeholder page labels to appear (unstyled stacking is fine). Console may show **one** error: `shell.js 404` is NOT acceptable — create an empty `public/js/shell.js` now (`touch public/js/shell.js`) so the page has zero console errors. `configure.js` will log no errors because its DOM hooks are guarded in Task 4; if it throws because expected elements are gone, note which and proceed — Task 4 fixes init.

- [ ] **Step 3: Commit**

```bash
git add public/configure.html public/js/shell.js
git commit -m "Scaffold sidebar shell HTML with placeholder pages"
```

---

## Task 3: Style the shell (sidebar, nav, footer, responsive)

**Files:**
- Modify: `public/css/configure.css` (append shell rules after the Task 1 block)

- [ ] **Step 1: Add shell styles**

Append to `public/css/configure.css`:

```css
.app { display: flex; min-height: 100vh; }
.sidebar {
  width: var(--side-w); flex-shrink: 0; display: flex; flex-direction: column;
  padding: 18px 0; background: rgba(255,170,120,.04);
  border-right: 1px solid rgba(255,170,120,.08);
}
.brand {
  font-size: 1.12rem; font-weight: 800; padding: 0 18px 16px;
  background: var(--grad-rgb); background-size: 300% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: rgbflow 6s linear infinite;
}
.nav { display: flex; flex-direction: column; gap: 1px; }
.nav-item {
  display: flex; align-items: center; gap: 11px; padding: 10px 18px; margin: 1px 10px;
  font-size: .85rem; color: var(--text-dim); border-radius: var(--r-md);
  cursor: pointer; text-decoration: none; user-select: none;
}
.nav-item:hover { color: #fff; }
.nav-item.on {
  color: #fff; font-weight: 600;
  background: linear-gradient(90deg, rgba(251,146,60,.3), rgba(244,114,182,.18), rgba(129,140,248,.18));
  background-size: 200% 100%; animation: rgbflow 5s linear infinite;
}
.sidebar-foot { margin-top: auto; padding: 12px 12px 0; }
.quick-install {
  position: relative; width: 100%; padding: 12px; border: none; border-radius: var(--r-md);
  background: var(--bg-grad-b); color: #fff; font-weight: 800; font-size: .82rem;
  cursor: pointer; z-index: 0; overflow: hidden;
}
.quick-install::before {
  content: ''; position: absolute; inset: -2px; z-index: -2;
  background: conic-gradient(from 0deg, #fb923c, #f472b6, #818cf8, #34d399, #fb923c);
  animation: spin 4s linear infinite;
}
.quick-install::after {
  content: ''; position: absolute; inset: 2px; z-index: -1;
  border-radius: 12px; background: var(--bg-grad-b);
}
.foot-links { display: flex; gap: 10px; justify-content: center; margin: 10px 0 0; }
.foot-link { font-size: .72rem; color: var(--text-mute); cursor: pointer; text-decoration: none; }
.foot-link:hover, .foot-link.on { color: var(--accent-a); }
.save-indicator { font-size: .64rem; color: var(--text-mute); text-align: center; margin-top: 9px; }
.content { flex: 1; padding: 24px 26px; min-width: 0; }
.page { display: none; }
.page.on { display: block; }
.page-ph { color: var(--text-mute); font-size: 1.2rem; }

/* mobile: collapse sidebar to top bar */
.menu-toggle { display: none; }
@media (max-width: 720px) {
  .app { flex-direction: column; }
  .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; padding: 10px; }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .sidebar-foot { margin: 0; width: 100%; }
  .content { padding: 16px; }
}
```

- [ ] **Step 2: Verify**

Run `npm start`, open `/configure`. Expect: warm sidebar on the left, animated rainbow brand text, nav items, a Quick Install button with a spinning gradient border, footer links + save indicator. Resize below 720px → sidebar moves to top. Console zero errors. (Pages still show placeholders — routing comes in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add public/css/configure.css
git commit -m "Style sidebar shell with RGB brand + install button and responsive layout"
```

---

## Task 4: Hash router + page switching (shell.js)

Wire nav clicks and `location.hash` to show one page at a time and mark the active nav item. Also adapt `configure.js` init so it no longer throws on the new DOM.

**Files:**
- Modify: `public/js/shell.js`
- Modify: `public/js/configure.js` (guard init around removed elements)

- [ ] **Step 1: Write the router in `public/js/shell.js`**

```js
// ── Hash router ────────────────────────────────────────────────────────────
const PAGES = ['dashboard','servers','catalogs','streaming','appearance','health','install','ping','log'];

function showPage(name) {
  if (!PAGES.includes(name)) name = 'dashboard';
  PAGES.forEach(p => {
    const sec = document.getElementById('page-' + p);
    if (sec) sec.classList.toggle('on', p === name);
  });
  document.querySelectorAll('.nav-item, .foot-link').forEach(el => {
    el.classList.toggle('on', el.dataset.page === name);
  });
  if (window.onPageShow) window.onPageShow(name);   // hook for live data (Task 5+)
}

function routeFromHash() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '');
  showPage(name);
}

function initShell() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
  });
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

document.addEventListener('DOMContentLoaded', initShell);
```

- [ ] **Step 2: Guard `configure.js` init against missing elements**

`configure.js` runs init at the bottom (around `restoreFromLocalStorage()` / `addServer()` at line ~1899) and references elements that no longer exist yet (e.g. `servers-container`). Wrap the bottom init block so a missing container does not throw:

```js
// At the very bottom of configure.js, replace the bare init calls with:
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('servers-container')) return; // shell not ready / page absent
  if (!restoreFromLocalStorage()) addServer();
});
```

(If `servers-container` does not exist yet because the Servers page is still a placeholder, this safely no-ops. Task 5 adds the container.)

- [ ] **Step 3: Verify routing**

Run `npm start`, open `/configure`. Expect: Dashboard placeholder shows by default, clicking each nav item swaps the visible page and highlights the active item, the URL hash updates (`#/servers`, etc.), reloading on a hash restores that page. Console zero errors.

- [ ] **Step 4: Commit**

```bash
git add public/js/shell.js public/js/configure.js
git commit -m "Add hash router and page switching; guard configure init"
```

---

## Task 5: Servers page — cards, add, manage-in-place, library stats

Fill the Servers page. Reuse the existing server-block logic (`buildServerBlock`, `addServer`, `collectConfig`, `/api/library-stats`) but present each server as an OMEGA-style card whose "Manage" button reveals the existing edit form inline.

**Files:**
- Modify: `public/configure.html` (fill `#page-servers`)
- Modify: `public/js/configure.js` (expose `renderServersPage`; add status + stats fetch)
- Modify: `public/css/configure.css` (server-card styles)

- [ ] **Step 1: Fill the Servers page section**

Replace `<section class="page" id="page-servers">…</section>` with:

```html
<section class="page" id="page-servers">
  <h2 class="page-title">Your servers</h2>
  <p class="page-sub">Connected Emby &amp; Jellyfin servers. Click Manage to edit credentials.</p>
  <div id="servers-container"></div>
  <button class="btn-add" id="btn-add" onclick="addServer()">+ Add Server</button>

  <div class="profile-block">
    <h3 class="block-title">Saved profile</h3>
    <div class="profile-row">
      <input type="text" id="p-username" placeholder="Profile name" autocomplete="off" />
      <input type="password" id="p-password" placeholder="Password" autocomplete="off" />
    </div>
    <div class="profile-actions">
      <button class="btn-soft" onclick="saveProfile()">Save</button>
      <button class="btn-soft" onclick="loadProfile()">Load</button>
      <button class="btn-soft" onclick="exportConfig()">Export</button>
      <button class="btn-soft" onclick="document.getElementById('import-file').click()">Import</button>
      <input type="file" id="import-file" accept=".json" style="display:none" onchange="importConfig(event)" />
    </div>
    <div class="profile-status" id="profile-status"></div>
  </div>
</section>
```

The existing `addServer()` / `buildServerBlock()` append `.server-block` elements into `#servers-container` exactly as before — those forms ARE the "Manage" edit view. The card chrome wraps each block.

- [ ] **Step 2: Wrap each server block in card chrome + add status/stats**

In `configure.js`, locate `buildServerBlock(id)` (line ~952). It returns a `.server-block` element. Add a card header above the existing fields and a collapsed/expanded behavior. Modify the start of `buildServerBlock` so the returned element is structured as:

```js
// inside buildServerBlock, after creating the outer element `block`:
block.classList.add('server-card');           // add card styling hook
block.innerHTML = `
  <div class="sc-top"></div>
  <div class="sc-head">
    <div class="sc-ico">🎬</div>
    <div class="sc-id">
      <div class="sc-name" data-bind="name">New server</div>
      <div class="sc-host" data-bind="host">not configured</div>
    </div>
    <span class="sc-badge unknown" data-bind="badge">● —</span>
  </div>
  <div class="sc-stats" data-bind="stats">
    <div class="sc-row"><span>🎞 Movies</span><span data-bind="movies">—</span></div>
    <div class="sc-row"><span>📺 Shows</span><span data-bind="shows">—</span></div>
    <div class="sc-row"><span>▦ Episodes</span><span data-bind="episodes">—</span></div>
  </div>
  <button type="button" class="sc-manage" onclick="toggleManage(${id})">Manage Server →</button>
  <div class="sc-edit" id="edit-${id}" style="display:none">
    ${SERVER_FIELDS_HTML}     /* the existing field markup that buildServerBlock used to set */
  </div>`;
```

Where `SERVER_FIELDS_HTML` is the exact field markup the current `buildServerBlock` already produces (the `.f-label`, `.f-url`, `.f-apikey`, `.f-userid`, `.f-username`, `.f-password`, `.f-thumbnail`, `.f-type`, `.f-enabled`, `.f-emoji` inputs). Keep those identical so `collectConfig()` (line ~1154) and `addServer()` data-binding (lines ~1129-1140) keep working unchanged.

Add the toggle + live-update helpers to `configure.js`:

```js
function toggleManage(id) {
  const e = document.getElementById('edit-' + id);
  if (e) e.style.display = e.style.display === 'none' ? 'block' : 'none';
}

// Refresh a card header from its current field values + live status/stats.
async function refreshServerCard(block) {
  const get = sel => block.querySelector(sel)?.value.trim() || '';
  const label = get('.f-label'), url = get('.f-url').replace(/\/+$/, '');
  const type = block.querySelector('.f-type')?.value || 'emby';
  const apiKey = get('.f-apikey'), userId = get('.f-userid');
  const nameEl = block.querySelector('[data-bind=name]');
  const hostEl = block.querySelector('[data-bind=host]');
  if (nameEl) nameEl.textContent = label || 'New server';
  if (hostEl) hostEl.textContent = url ? url.replace(/^https?:\/\//, '') : 'not configured';
  if (!url || !apiKey || !userId) return;
  // library stats (reuses existing endpoint)
  try {
    const r = await fetch('/api/library-stats', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId }) });
    const badge = block.querySelector('[data-bind=badge]');
    if (r.ok) {
      const s = await r.json();
      block.querySelector('[data-bind=movies]').textContent   = (s.movies||0).toLocaleString();
      block.querySelector('[data-bind=shows]').textContent    = (s.shows||0).toLocaleString();
      block.querySelector('[data-bind=episodes]').textContent = (s.episodes||0).toLocaleString();
      if (badge) { badge.textContent = '● Connected'; badge.className = 'sc-badge up'; }
    } else if (badge) { badge.textContent = '● Auth failed'; badge.className = 'sc-badge down'; }
  } catch { const b = block.querySelector('[data-bind=badge]'); if (b){ b.textContent='● Unreachable'; b.className='sc-badge down'; } }
}

function renderServersPage() {
  document.querySelectorAll('#servers-container .server-card').forEach(refreshServerCard);
}
```

- [ ] **Step 3: Call `renderServersPage` when the page is shown**

In `configure.js`, define the global hook the router calls:

```js
window.onPageShow = function(name) {
  if (name === 'servers') renderServersPage();
};
```

- [ ] **Step 4: Add server-card CSS**

Append to `public/css/configure.css`:

```css
.page-title { font-size: 1.45rem; font-weight: 800; margin: 0 0 4px; }
.page-sub { color: var(--text-mute); font-size: .85rem; margin: 0 0 20px; }
.server-card {
  position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-lg); padding: 0 16px 16px; margin-bottom: 14px; z-index: 0;
  transition: transform .25s; overflow: hidden;
}
.server-card::before {
  content: ''; position: absolute; inset: 0; border-radius: var(--r-lg); padding: 1.5px;
  background: conic-gradient(from 0deg, #fb923c, #f472b6, #818cf8, #34d399, #fb923c);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0;
  transition: opacity .3s; animation: spin 5s linear infinite;
}
.server-card:hover { transform: translateY(-3px); }
.server-card:hover::before { opacity: 1; }
.sc-top { height: 4px; margin: 0 -16px 14px; background: var(--grad-accent); }
.sc-head { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
.sc-ico { width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; }
.sc-name { font-weight: 800; font-size: 1rem; }
.sc-host { font-size: .7rem; color: var(--text-mute); }
.sc-badge { margin-left: auto; font-size: .62rem; font-weight: 800; padding: 5px 11px; border-radius: 999px; }
.sc-badge.up { background: rgba(52,211,153,.16); color: #6ee7b7; }
.sc-badge.down { background: rgba(224,85,85,.16); color: #fca5a5; }
.sc-badge.unknown { background: rgba(255,255,255,.06); color: var(--text-mute); }
.sc-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: .84rem; border-top: 1px solid var(--border); }
.sc-row span:last-child { font-weight: 700; }
.sc-manage { width: 100%; margin-top: 12px; padding: 10px; border: 1px solid rgba(251,146,60,.3); border-radius: var(--r-sm); background: rgba(251,146,60,.1); color: #fdba74; font-weight: 700; font-size: .84rem; cursor: pointer; }
.sc-edit { margin-top: 12px; }
.btn-add { padding: 11px 16px; border: 1px dashed var(--border); border-radius: var(--r-md); background: transparent; color: var(--text-dim); cursor: pointer; font-size: .9rem; }
.profile-block { margin-top: 26px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); }
.block-title { font-size: .95rem; font-weight: 700; margin: 0 0 12px; }
.profile-row { display: flex; gap: 10px; margin-bottom: 10px; }
.profile-row input { flex: 1; }
.profile-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-soft { padding: 8px 14px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text); cursor: pointer; font-size: .8rem; }
```

- [ ] **Step 5: Verify**

Run `npm start`, open `/configure#/servers`. Expect: one server card with the accent top bar, icon, header, stat rows (—), and a "Manage Server" button that toggles the credential form. Fill in a real Emby URL/API key/User ID, switch away and back to Servers → the card header updates and (with valid creds) shows movie/show/episode counts and a Connected badge. Hover lifts the card with a rainbow border. Console zero errors. `npm test` still green.

- [ ] **Step 6: Commit**

```bash
git add public/configure.html public/js/configure.js public/css/configure.css
git commit -m "Build Servers page with OMEGA-style cards, manage-in-place, live stats"
```

---

## Task 6: Dashboard page — stat tiles + live server cards + greeting

**Files:**
- Modify: `public/configure.html` (fill `#page-dashboard`)
- Modify: `public/js/shell.js` (Dashboard render)
- Modify: `public/css/configure.css` (tiles + dashboard mini-cards)

- [ ] **Step 1: Fill the Dashboard section**

```html
<section class="page" id="page-dashboard">
  <h2 class="page-title">Hey there 🍿</h2>
  <p class="page-sub" id="dash-status">Loading your setup…</p>
  <div class="tiles">
    <div class="tile t1"><div class="n" id="tile-servers">0</div><div class="l">Servers up</div></div>
    <div class="tile t2"><div class="n" id="tile-catalogs">0</div><div class="l">Catalog rows</div></div>
    <div class="tile t3"><div class="n" id="tile-movies">0</div><div class="l">Movies</div></div>
    <div class="tile t4"><div class="n" id="tile-ping">—</div><div class="l">Fastest ping</div></div>
  </div>
  <h3 class="block-title">Your servers</h3>
  <div class="dash-cards" id="dash-cards"></div>
</section>
```

- [ ] **Step 2: Render the Dashboard in `shell.js`**

Extend the `onPageShow` hook. Since `configure.js` already defines `window.onPageShow`, add the dashboard branch there instead (single source). In `configure.js` update the hook:

```js
window.onPageShow = function(name) {
  if (name === 'servers') renderServersPage();
  if (name === 'dashboard') renderDashboard();
};

async function renderDashboard() {
  const cfg = collectConfig(true) || { servers: [] };
  const servers = cfg.servers || [];
  const catCount = (JSON.parse(localStorage.getItem('externalCatalogs') || '[]')).length;
  document.getElementById('tile-catalogs').textContent = catCount;
  const wrap = document.getElementById('dash-cards');
  wrap.innerHTML = '';
  let upCount = 0, movieTotal = 0, fastest = null;
  await Promise.all(servers.map(async s => {
    const card = document.createElement('div');
    card.className = 'dash-card';
    card.innerHTML = `<div class="dc-head"><div class="sc-ico">${s.emoji || '🎬'}</div>
      <div><div class="sc-name">${escHtml(s.label)}</div>
      <div class="sc-host">${escHtml((s.url||'').replace(/^https?:\/\//,''))}</div></div>
      <span class="sc-badge unknown">● …</span></div>
      <div class="dc-mini"><div class="mc"><div class="n">—</div><div class="l">Movies</div></div>
      <div class="mc"><div class="n">—</div><div class="l">Shows</div></div>
      <div class="mc"><div class="n">—</div><div class="l">Eps</div></div></div>`;
    wrap.appendChild(card);
    const t0 = performance.now();
    try {
      const r = await fetch('/api/library-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId }) });
      const ms = Math.round(performance.now() - t0);
      const badge = card.querySelector('.sc-badge');
      if (r.ok) {
        const st = await r.json();
        const mc = card.querySelectorAll('.mc .n');
        mc[0].textContent = (st.movies||0).toLocaleString();
        mc[1].textContent = (st.shows||0).toLocaleString();
        mc[2].textContent = (st.episodes||0).toLocaleString();
        upCount++; movieTotal += (st.movies||0);
        if (fastest === null || ms < fastest) fastest = ms;
        badge.textContent = ms < 400 ? '● UP ' + ms + 'ms' : '● SLOW ' + ms + 'ms';
        badge.className = 'sc-badge ' + (ms < 400 ? 'up' : 'unknown');
      } else { badge.textContent = '● Auth failed'; badge.className = 'sc-badge down'; }
    } catch { const b = card.querySelector('.sc-badge'); b.textContent='● Down'; b.className='sc-badge down'; }
  }));
  document.getElementById('tile-servers').textContent = upCount;
  document.getElementById('tile-movies').textContent = movieTotal.toLocaleString();
  document.getElementById('tile-ping').textContent = fastest != null ? fastest + 'ms' : '—';
  document.getElementById('dash-status').textContent = servers.length
    ? `Everything's loaded. ${upCount}/${servers.length} servers reachable.`
    : 'No servers yet — add one on the Servers page.';
}
```

(Note: `externalCatalogs` localStorage key — confirm the actual key `configure.js` uses for saved catalogs by searching `localStorage.setItem` in `configure.js`; use that exact key here.)

- [ ] **Step 3: Add tile + dashboard-card CSS**

```css
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 13px; margin-bottom: 22px; }
.tile { position: relative; border-radius: var(--r-lg); padding: 15px 16px; color: #1a0f14; overflow: hidden; }
.tile .n { font-size: 1.7rem; font-weight: 900; line-height: 1; position: relative; z-index: 1; }
.tile .l { font-size: .7rem; font-weight: 700; margin-top: 6px; opacity: .85; position: relative; z-index: 1; text-transform: uppercase; }
.tile::after { content: ''; position: absolute; top: 0; left: 0; width: 40%; height: 100%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent); transform: translateX(-120%); animation: sheen 4.5s ease-in-out infinite; }
.tile.t2::after { animation-delay: 1.1s; } .tile.t3::after { animation-delay: 2.2s; } .tile.t4::after { animation-delay: 3.3s; }
.t1 { background: linear-gradient(150deg, #fdba74, #fb923c); }
.t2 { background: linear-gradient(150deg, #f9a8d4, #f472b6); }
.t3 { background: linear-gradient(150deg, #a5b4fc, #818cf8); }
.t4 { background: linear-gradient(150deg, #6ee7b7, #34d399); }
.dash-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
.dash-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 15px; }
.dc-head { display: flex; align-items: center; gap: 11px; margin-bottom: 11px; }
.dc-mini { display: flex; gap: 8px; }
.dc-mini .mc { flex: 1; background: var(--surface-2); border-radius: var(--r-sm); padding: 8px; text-align: center; }
.dc-mini .mc .n { font-weight: 800; font-size: .9rem; }
.dc-mini .mc .l { font-size: .56rem; color: var(--text-mute); text-transform: uppercase; }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2,1fr); } .dash-cards { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Verify**

Run `npm start`, open `/configure` (defaults to Dashboard). With a server configured, expect: four gradient tiles with the drifting sheen, a greeting + status line, and live server mini-cards populating movie/show/episode counts and an UP/SLOW badge. Tile values update (servers up, movies, fastest ping). Console zero errors.

- [ ] **Step 5: Commit**

```bash
git add public/configure.html public/js/configure.js public/css/configure.css
git commit -m "Build Dashboard with gradient stat tiles and live server cards"
```

---

## Task 7: Migrate Streaming settings page

Move the existing Streaming tab markup into `#page-streaming`. The controls already wire to `configure.js` via their `id`s and `onchange="autoSave()"`/named handlers — moving the DOM keeps them working.

**Files:**
- Modify: `public/configure.html` (fill `#page-streaming` from old `#tab-streaming`)
- Modify: `public/css/configure.css` (port the option-item / sort-row styles, restyled to tokens)

- [ ] **Step 1: Move the markup**

Copy the entire inner markup of the old `#tab-streaming` block (the perf-mode radios, timeout row, sort-order, exclude-resolutions, audio-lang, codec, max-bitrate, and the recommended/ping/auto-select/ping-detail option-items — original `configure.html` lines 85-226) into `#page-streaming`, prefixed with:

```html
<h2 class="page-title">Streaming</h2>
<p class="page-sub">How streams are filtered, sorted, and labelled per result.</p>
```

Keep every `id` and inline handler identical (`onModeChange()`, `onShowPingChange()`, `id="sort-order"`, etc.).

- [ ] **Step 2: Add restyled control CSS**

Append token-based versions of the control classes used by that markup (`.option-item`, `.option-title`, `.option-desc`, `.sort-row`, `.sort-row-label`, `.options-divider`, `.res-checkboxes`, `.res-check`, `select`, `input[type=text]`):

```css
.option-item { display: flex; gap: 11px; align-items: flex-start; padding: 11px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); margin-bottom: 8px; cursor: pointer; }
.option-title { font-weight: 600; font-size: .9rem; }
.option-desc { font-size: .75rem; color: var(--text-mute); margin-top: 2px; }
.sort-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; }
.sort-row-label { font-size: .85rem; color: var(--text-dim); }
.sort-row-dual { display: flex; gap: 8px; }
.options-divider { height: 1px; background: var(--border); margin: 10px 0; }
.res-checkboxes { display: flex; gap: 12px; }
.res-check { font-size: .8rem; color: var(--text-dim); display: flex; gap: 5px; align-items: center; }
select, input[type=text], input[type=password], input[type=number] {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm);
  color: var(--text); font-size: .82rem; padding: .4rem .6rem;
}
```

- [ ] **Step 3: Verify**

Run `npm start`, open `/configure#/streaming`. Expect every Streaming control to appear styled. Change a control (e.g. Sort by) → the "Settings saved" indicator flashes (autosave still wired). Reload → value persists. Console zero errors.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/css/configure.css
git commit -m "Migrate Streaming settings into shell page"
```

---

## Task 8: Migrate Appearance page (with Labels folded in)

**Files:**
- Modify: `public/configure.html` (fill `#page-appearance` from old `#tab-labels` + `#tab-appearance`)
- Modify: `public/css/configure.css` (port appearance-row / custom-fields styles)

- [ ] **Step 1: Move markup, Labels first then Appearance**

Into `#page-appearance` put:

```html
<h2 class="page-title">Appearance</h2>
<p class="page-sub">Stream label format and how details are displayed.</p>
<h3 class="block-title">Label format</h3>
<!-- paste old #tab-labels inner markup here (label-preset, label-preview, custom-preset-panel) -->
<div class="options-divider"></div>
<h3 class="block-title">Display</h3>
<!-- paste old #tab-appearance inner markup here (summary card, quality-badge, flag-emoji, bitrate-bar, subs-style) -->
```

Preserve all ids and handlers (`updateLabelPreview()`, `toggleSummaryStyle()`, `autoSave()`, etc.).

- [ ] **Step 2: Add appearance CSS**

```css
.appearance-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 4px; }
.appearance-label { font-weight: 600; font-size: .85rem; }
.appearance-hint { font-size: .72rem; color: var(--text-mute); }
.custom-fields-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.custom-field-check { font-size: .78rem; color: var(--text-dim); display: flex; gap: 6px; align-items: center; }
.toggle-label { font-size: .8rem; color: var(--text-dim); display: flex; gap: 6px; align-items: center; }
```

- [ ] **Step 3: Verify**

Run `npm start`, open `/configure#/appearance`. Expect Label format controls + live preview, then Display controls. Change the label preset → preview updates. Toggle summary card → options reveal. Console zero errors; reload persists values.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/css/configure.css
git commit -m "Migrate Labels+Appearance into a single Appearance page"
```

---

## Task 9: Migrate Catalogs page

The Catalogs tab is the largest block. Move it wholesale; all handlers (`onCatalogProviderChange`, `applyPreset`, `browseMdblistUser`, `browseTraktUser`, `addExternalCatalog`, `setTmdbMode`, etc.) live in `configure.js` and key off ids.

**Files:**
- Modify: `public/configure.html` (fill `#page-catalogs` from old `#tab-catalogs`)
- Modify: `public/css/configure.css` (port catalog/preset/browse styles)

- [ ] **Step 1: Move the entire `#tab-catalogs` inner markup**

Copy original `configure.html` lines 343-561 (My Library, API Keys, Catalog Filters, Streaming Presets, MDbList browser, Trakt browser, catalog list, add form incl. TMDB fields) into `#page-catalogs`, prefixed with:

```html
<h2 class="page-title">Catalogs</h2>
<p class="page-sub">Add external rows to your Stremio home screen.</p>
```

Keep every id and handler. Replace inline `style="…var(--bg-input)…"` references with the token equivalents if `--bg-input` is no longer defined — add an alias in `:root` to avoid touching dozens of inline styles:

```css
:root { --bg-input: var(--surface-2); --bg-base: var(--bg-grad-b); --text-primary: var(--text); --text-muted: var(--text-mute); --radius-sm: var(--r-sm); }
```

- [ ] **Step 2: Add catalog-section CSS**

```css
.catalog-section-title, .preset-header strong, .browse-header strong { font-weight: 700; font-size: .9rem; }
.catalog-section { margin-bottom: 8px; }
.preset-section, .browse-section { margin: 14px 0; padding: 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); }
.preset-hint { font-size: .72rem; color: var(--text-mute); display: block; margin-top: 2px; }
.preset-services { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
.btn-all-networks, .btn-add-catalog, .btn-apply-preset, .btn-clear-all { padding: 8px 14px; border: 1px solid rgba(251,146,60,.3); border-radius: var(--r-sm); background: rgba(251,146,60,.1); color: #fdba74; font-weight: 700; font-size: .8rem; cursor: pointer; }
.browse-input-row, .catalog-add-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.catalog-list { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.tmdb-mode-btn { padding: 5px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text-dim); cursor: pointer; font-size: .76rem; }
.tmdb-mode-btn.active { background: var(--grad-accent); color: #1a0f14; border: none; }
```

- [ ] **Step 3: Verify**

Run `npm start`, open `/configure#/catalogs`. Expect all sections render. Enter an MDbList username → Browse returns results (needs network). Add a catalog via the add form → it appears in the catalog list and persists on reload. Switch TMDB mode Charts/Discover → fields swap. Console zero errors.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/css/configure.css
git commit -m "Migrate Catalogs into shell page"
```

---

## Task 10: Health page (merge servers.html)

Fold the standalone health dashboard into `#page-health` and redirect `/servers`.

**Files:**
- Modify: `public/configure.html` (fill `#page-health`)
- Create: `public/js/health.js` (the servers.html script, namespaced)
- Modify: `public/configure.html` (load `health.js`)
- Modify: `server.js:146` (`/servers` → redirect)
- Modify: `public/css/configure.css` (port health styles from servers.html `<style>`)

- [ ] **Step 1: Move servers.html body + script**

Put the servers.html body markup (the `#main-content`, `#refresh-bar`, range tabs, `#range-info`) inside `#page-health` with a title. Copy the entire `<script>` from `public/servers.html` (lines 108-onward: `rangeMs`, `setRange`, `loadHistory`, `pingNow`, `browserPing`, `renderPage`, `buildCard`, `buildSpark`, `startCountdown`, `loadServerInfo`, etc.) into a new `public/js/health.js`. Wrap its auto-start so it only runs when the Health page is active:

```js
// at bottom of health.js
let healthStarted = false;
function startHealth() { if (healthStarted) return; healthStarted = true; loadHistory(); loadServerInfo(); startCountdown(); }
window.addEventListener('hashchange', () => { if (location.hash === '#/health') startHealth(); });
```

And in `configure.js`'s `onPageShow`, add: `if (name === 'health' && window.startHealth) window.startHealth();`. Expose `startHealth` on `window`.

- [ ] **Step 2: Load health.js + add styles**

Add `<script src="/js/health.js"></script>` after `shell.js` in `configure.html`. Port the `.server-grid`, `.seg`, `.rt-graph-wrap`, `.range-tab`, `.dot`, `.status-bar`, `.loc-ms` rules from servers.html's `<style>` into `configure.css`, recoloring to the warm tokens (status greens/ambers/reds may stay as-is).

- [ ] **Step 3: Redirect `/servers` in server.js**

Change `server.js:146` from:

```js
app.get('/servers', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'servers.html')); });
```
to:
```js
app.get('/servers', (req, res) => res.redirect('/configure#/health'));
```

Delete `public/servers.html`.

- [ ] **Step 4: Verify**

Run `npm start`, open `/configure#/health`. Expect the health dashboard (status bar, range tabs, server cards with sparkline + segments, history toggles, auto-refresh countdown). Visiting `/servers` redirects to `/configure#/health`. Console zero errors. `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add public/configure.html public/js/health.js public/css/configure.css server.js
git rm public/servers.html
git commit -m "Merge server health dashboard into Health page; redirect /servers"
```

---

## Task 11: Install page + Quick Install modal, Ping Test, Request Log

Wire the remaining footer destinations.

**Files:**
- Modify: `public/configure.html` (`#page-install`, `#page-ping`, `#page-log`)
- Modify: `public/js/configure.js` (Quick Install modal; reuse `generateLinks`)
- Modify: `public/css/configure.css` (install/modal/ping/log styles)

- [ ] **Step 1: Install page + modal markup**

```html
<section class="page" id="page-install">
  <h2 class="page-title">Install to Stremio</h2>
  <p class="page-sub">Generate your install link and open it in Stremio.</p>
  <button class="btn-generate" onclick="generateLinks()">Generate Install Link</button>
  <div id="install-result"></div>
</section>
```

Point existing `generateLinks()` output (currently `#result-section`) at `#install-result`, or keep `#result-section` inside this page. The pinned `#quick-install` button (already in the sidebar) should call `generateLinks()` then navigate to `#/install`:

```js
document.getElementById('quick-install')?.addEventListener('click', () => {
  location.hash = '#/install';
  generateLinks();
});
```

- [ ] **Step 2: Ping Test + Request Log markup**

Move the old `#panel-ping` body into `#page-ping` and the old `#panel-log` body into `#page-log` (the `ping-origin` select, `runPingTest()`, `#ping-results`; and the log actions, `refreshLog()`, `clearLog()`, `#log-table-wrap`). Add `onPageShow` branches: `if (name==='log') refreshLog();`.

- [ ] **Step 3: Styles**

```css
.btn-generate { width: 100%; padding: 14px; border: none; border-radius: var(--r-md); background: var(--grad-accent); color: #1a0f14; font-weight: 800; font-size: 1rem; cursor: pointer; }
.btn-log, .btn-ping-test { padding: 8px 14px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface-2); color: var(--text); cursor: pointer; font-size: .8rem; }
.btn-log.danger { color: #fca5a5; border-color: rgba(224,85,85,.3); }
```

- [ ] **Step 4: Verify**

Run `npm start`. `/configure#/install` → Generate produces the install link/QR. The sidebar Quick Install button (from any page) navigates to Install and generates. `/configure#/ping` runs a ping test. `/configure#/log` shows request history with Refresh/Clear. Console zero errors.

- [ ] **Step 5: Commit**

```bash
git add public/configure.html public/js/configure.js public/css/configure.css
git commit -m "Wire Install page + Quick Install button, Ping Test, Request Log"
```

---

## Task 12: Cleanup, polish, and full-flow verification

**Files:**
- Modify: `public/css/configure.css` (remove dead old rules)
- Modify: `public/js/configure.js` (remove dead `switchTab`/`togglePanel`/`collapseAll`/`expandAll` if unused)

- [ ] **Step 1: Remove superseded code**

Delete the now-unused old CSS rules below the new system (anything referencing `.site-header`, `.steps`, `.panel`, `.tab-bar`, `.tab-pane`, `.servers-toolbar`, `.generate-area`, `.site-footer` that no longer has matching markup). In `configure.js`, remove `switchTab`, `togglePanel`, `collapseAll`, `expandAll` only if grep shows no remaining references in `configure.html`.

Run to confirm none are still referenced:

```bash
grep -n "switchTab\|togglePanel\|collapseAll\|expandAll\|class=\"tab-" public/configure.html
```
Expected: no output.

- [ ] **Step 2: Reduced-motion check**

In DevTools, enable "Emulate prefers-reduced-motion: reduce" and reload. Expect all animations (brand flow, install border, card hover spin, tile sheen, pulse) to be frozen/static.

- [ ] **Step 3: Full smoke flow**

Run `npm start` and walk every page in order: Dashboard → Servers (add a server, Manage, see stats) → Catalogs (add a row) → Streaming (change + autosave) → Appearance (label preview) → Health (sparklines) → Install (generate) → Ping → Log. Confirm zero console errors on each and that an end-to-end generated install link still loads in Stremio (or validate the manifest URL returns JSON: `curl http://localhost:7000/<config>/manifest.json`).

- [ ] **Step 4: Backend tests**

Run: `npm test`
Expected: both `utils.test.js` and `streams.test.js` pass, exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove superseded UI code; verify reduced-motion and full flow"
```

---

## Self-review notes

- **Spec coverage:** sidebar shell (T2-4), warm+RGB visual language (T1,3,5,6), Dashboard (T6), Servers cards + manage + stats (T5), Health merge + /servers redirect (T10), Catalogs/Streaming/Appearance-with-Labels (T7-9), Install + Quick Install + Ping + Log (T11), reduced-motion (T1 token + T12 check), responsive (T3,6). All spec sections map to a task.
- **Reused, not rebuilt:** `collectConfig`, `addServer`, `buildServerBlock` fields, `generateLinks`, `/api/library-stats`, health script, autosave — all preserved.
- **Confirm-before-use flags:** exact localStorage key for saved catalogs (Task 6 Step 2) and the listen `PORT` (verification convention) must be read from the code during execution, not assumed.
```
