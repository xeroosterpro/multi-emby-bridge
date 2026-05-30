# Compact UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stacked dropdown/checkbox "log box" rows on the Streaming, Catalogs, and Appearance tabs with a shared toolkit of compact visual controls (segmented pills, toggle chips, switch tiles, slider, icon tiles, status pills), and fix three issues (Manage-button click, square server cards, Dashboard stats caching) — all without changing the saved-config schema or install-link format.

**Architecture:** A new `public/js/controls.js` provides declarative bind helpers that sync visual controls to **hidden canonical inputs** (the existing `<select>`/`<input>`/`<checkbox>` elements, kept but `display:none`). `collectConfig`, `generateLinks`, autosave, and restore continue to read those hidden inputs unchanged — the toolkit is purely a new presentation surface. Tabs are rewritten one at a time.

**Tech Stack:** Vanilla JS/CSS, Express static serving, no build step. Browser-based verification + a config-parity check (the JSON config produced for a given set of choices must be identical before and after each tab rewrite).

---

## Verification convention

No frontend test harness (visual reskin). The server runs on `http://localhost:7000` (`npm start`; restart it after server.js changes — there are none in this plan). The browser caches aggressively — append a `?v=N` query to bust cache. For every task:

1. Load the relevant page(s); confirm rendering and **zero console errors** (a `favicon.ico` 404 is the only allowed noise).
2. **Config-parity check** (tabs only): in the console, set some choices via the new controls, then run `JSON.stringify(collectConfig(true))` (or `collectExternalCatalogs()` for catalogs) and confirm the output keys/values match what the old controls produced for the same choices. The hidden inputs are the source of truth — confirm each visual control updates its hidden input.
3. `npm test` → baseline **46 pass / 2 fail** (pre-existing, unrelated) — confirm unchanged.

A task passes when 1–3 hold; commit only then. Do not push (the controller pushes at the end).

---

## File structure

- **Create** `public/js/controls.js` — declarative bind helpers (`Controls.bindAll`, `Controls.syncAll`, segment/chips/switch/slider/tiles). The reusable core. Loaded after `configure.js`, before `shell.js` is fine; it exposes `window.Controls`.
- **Modify** `public/configure.html` — rewrite the Streaming/Catalogs/Appearance section markup to visual controls, each keeping a hidden canonical input; add `<script src="/js/controls.js">`.
- **Modify** `public/css/configure.css` — toolkit classes; square `.server-card`; `.server-card::before { pointer-events:none }`.
- **Modify** `public/js/configure.js` — call `Controls.bindAll()`/`syncAll()` at init and in `onPageShow`; Dashboard stats cache + refresh + re-entry guard. No schema change.

---

## Task 1: Fix Manage button + square server cards

Smallest, highest-value fix. The animated rainbow border (`.server-card::before`, `position:absolute; inset:0`) overlays the card and eats clicks, so Manage/Test/Remove buttons never receive them. Also switch the card corners from rounded to square.

**Files:**
- Modify: `public/css/configure.css` (the `.server-card`, `.server-card::before`, `.sc-top` rules)

- [ ] **Step 1: Add pointer-events:none to the overlay and square the corners**

Find the `.server-card` block (the OMEGA card, the rule with `border-radius: var(--r-lg)` and a `::before` using `conic-gradient`). Apply these exact edits:

- In `.server-card { ... }` change `border-radius: var(--r-lg);` → `border-radius: 4px;`
- In `.server-card::before { ... }` change `border-radius: var(--r-lg);` → `border-radius: 4px;` and ADD `pointer-events: none;` to that rule.
- In `.sc-top { ... }` (the accent bar) leave as-is (it's a top strip; square corners are inherited by the card's `overflow:hidden`).

Resulting rules (illustrative):
```css
.server-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; padding: 0 16px 16px; margin-bottom: 14px; z-index: 0; transition: transform .25s; overflow: hidden; }
.server-card::before { content: ''; position: absolute; inset: 0; border-radius: 4px; padding: 1.5px; background: conic-gradient(from 0deg, #fb923c, #f472b6, #818cf8, #34d399, #fb923c); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: 0; transition: opacity .3s; animation: spin 5s linear infinite; pointer-events: none; }
```

- [ ] **Step 2: Verify the Manage button works and corners are square**

Run `npm start`, open `/configure?v=1#/servers`. In the console:
```js
const btn = document.querySelector('.sc-manage');
const r = btn.getBoundingClientRect();
document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === btn  // must be true now
```
Expected: `true` (the button receives the click). Then actually click "Manage Server" → the credential edit form expands. Click it again → collapses. Open the edit form and confirm the Test/Remove/Fetch buttons inside are also clickable. Card corners visibly square. Zero console errors.

- [ ] **Step 3: Commit**

```bash
git add public/css/configure.css
git commit -m "Fix Manage button click (overlay pointer-events) and square server cards"
```

---

## Task 2: Dashboard library-stats caching

Stop re-POSTing `/api/library-stats` for every server on every Dashboard visit. Cache by server identity, render cached instantly, add a Refresh button, and guard re-entry.

**Files:**
- Modify: `public/js/configure.js` (the `renderDashboard` function)
- Modify: `public/configure.html` (`#page-dashboard` — add a Refresh button)

- [ ] **Step 1: Add a Refresh control to the dashboard header**

In `#page-dashboard`, change the status line area to include a refresh button. Replace the `<p class="page-sub" id="dash-status">…</p>` line by adding a button right after it:
```html
<p class="page-sub" id="dash-status">Loading your setup…</p>
<button class="btn-soft" id="dash-refresh" onclick="renderDashboard(true)" style="margin:-8px 0 16px">↻ Refresh stats</button>
```

- [ ] **Step 2: Add an in-memory + localStorage cache and re-entry guard to renderDashboard**

At module scope in `configure.js` (near the top, after `let nextId = 0;`), add:
```js
// Library-stats cache: key = url|apiKey|userId, value = {movies,shows,episodes,ms,ts}
let _libStatsCache = {};
let _dashboardInFlight = false;
try { _libStatsCache = JSON.parse(localStorage.getItem('meb-libstats-cache') || '{}'); } catch { _libStatsCache = {}; }
function _libKey(s){ return [s.url, s.apiKey, s.userId].join('|'); }
function _saveLibCache(){ try { localStorage.setItem('meb-libstats-cache', JSON.stringify(_libStatsCache)); } catch {} }
const LIB_TTL_MS = 60 * 60 * 1000; // 1 hour
```

Change the `renderDashboard` signature to `async function renderDashboard(force = false)` and, inside the per-server loop, fetch only when there is no fresh cache entry. Replace the per-server body so it:
1. Computes `const k = _libKey(s); const cached = _libStatsCache[k];`
2. If `!force && cached && (now - cached.ts < LIB_TTL_MS)`, render from `cached` WITHOUT fetching (use cached.movies/shows/episodes/ms, set the UP/SLOW badge from `cached.ms`).
3. Else fetch as today, and on success store `_libStatsCache[k] = {movies,shows,episodes,ms,ts: now}` then `_saveLibCache()`.

Because `Date.now()` is available in the browser (this is app code, not a workflow script), use `const now = Date.now();` at the top of `renderDashboard`.

Wrap the whole body in the re-entry guard:
```js
async function renderDashboard(force = false) {
  if (_dashboardInFlight) return;
  _dashboardInFlight = true;
  try {
    const now = Date.now();
    // ... existing setup (cfg, servers, catCount, wrap.innerHTML='') ...
    // ... per-server loop using cache as described ...
    // ... tile/status updates ...
  } finally { _dashboardInFlight = false; }
}
```

Keep all existing escaping (`escHtml`) and the tile/status update logic. Invalidation is automatic: a changed server URL/key/userId produces a new `_libKey`, so its stats are re-fetched; stale keys simply linger harmlessly in the cache.

- [ ] **Step 3: Verify caching**

Run `npm start`, open `/configure?v=2`. Configure a reachable server (or any server) on the Servers page. Open the Network panel, visit Dashboard → note `/api/library-stats` calls. Navigate away and back to Dashboard → expect **zero** new `/api/library-stats` calls (served from cache); tiles still populate. Click "↻ Refresh stats" → calls fire again. Change a server's URL on Servers, return to Dashboard → only that server re-fetches. Zero console errors. `npm test` unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/js/configure.js public/configure.html
git commit -m "Cache Dashboard library stats with refresh button and re-entry guard"
```

---

## Task 3: Shared compact-control toolkit (controls.js + CSS)

The reusable core. Declarative: markup carries `data-*` attributes pointing at hidden canonical inputs; `controls.js` wires two-way sync. Built and unit-checked here before any tab uses it.

**Files:**
- Create: `public/js/controls.js`
- Modify: `public/configure.html` (add the script tag)
- Modify: `public/css/configure.css` (toolkit classes)

- [ ] **Step 1: Write `public/js/controls.js`**

```js
// Compact-control toolkit. Visual controls sync to hidden canonical inputs
// (the existing <select>/<input>/<checkbox> elements), which remain the source
// of truth for collectConfig/generateLinks/autosave/restore.
(function () {
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }

  // Segment / tiles: pick-one. container[data-target="#id"], children [data-val]
  function bindSegment(container) {
    const target = document.querySelector(container.getAttribute('data-target'));
    if (!target) return;
    container.querySelectorAll('[data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        target.value = btn.getAttribute('data-val');
        fire(target, 'change');
        syncSegment(container);
      });
    });
    syncSegment(container);
  }
  function syncSegment(container) {
    const target = document.querySelector(container.getAttribute('data-target'));
    if (!target) return;
    container.querySelectorAll('[data-val]').forEach(btn =>
      btn.classList.toggle('on', btn.getAttribute('data-val') === target.value));
  }

  // Switch tile: boolean. el[data-target="#id"] -> a checkbox input
  function bindSwitch(el) {
    const target = document.querySelector(el.getAttribute('data-target'));
    if (!target) return;
    el.addEventListener('click', () => {
      target.checked = !target.checked;
      fire(target, 'change');
      syncSwitch(el);
    });
    syncSwitch(el);
  }
  function syncSwitch(el) {
    const target = document.querySelector(el.getAttribute('data-target'));
    if (!target) return;
    el.classList.toggle('on', !!target.checked);
  }

  // Chips multi: container[data-targets] where each chip[data-target="#id"] is a checkbox
  function bindChips(container) {
    container.querySelectorAll('[data-target]').forEach(chip => {
      const target = document.querySelector(chip.getAttribute('data-target'));
      if (!target) return;
      chip.addEventListener('click', () => {
        target.checked = !target.checked;
        fire(target, 'change');
        chip.classList.toggle('on', target.checked);
      });
      chip.classList.toggle('on', !!target.checked);
    });
  }

  // Slider: input[type=range] is the canonical element itself; we just restyle.
  // (No bind needed — native range stays the source of truth. Helper updates a label.)
  function bindSlider(range) {
    const labelSel = range.getAttribute('data-label');
    const label = labelSel ? document.querySelector(labelSel) : null;
    const fmtName = range.getAttribute('data-format');
    const fmt = (fmtName && Controls.formats[fmtName]) || (v => v);
    const update = () => { if (label) label.textContent = fmt(range.value); };
    range.addEventListener('input', update);
    update();
  }

  const Controls = {
    formats: {},  // register value formatters by name
    bindAll(root) {
      root = root || document;
      root.querySelectorAll('.seg[data-target], .tilegroup[data-target]').forEach(bindSegment);
      root.querySelectorAll('.sw[data-target]').forEach(bindSwitch);
      root.querySelectorAll('.chips[data-targets]').forEach(bindChips);
      root.querySelectorAll('input[type=range][data-slider]').forEach(bindSlider);
    },
    syncAll(root) {
      root = root || document;
      root.querySelectorAll('.seg[data-target], .tilegroup[data-target]').forEach(syncSegment);
      root.querySelectorAll('.sw[data-target]').forEach(syncSwitch);
      root.querySelectorAll('.chips[data-targets] [data-target]').forEach(chip => {
        const t = document.querySelector(chip.getAttribute('data-target'));
        if (t) chip.classList.toggle('on', !!t.checked);
      });
      root.querySelectorAll('input[type=range][data-slider]').forEach(r => fire(r, 'input'));
    },
  };
  window.Controls = Controls;
})();
```

- [ ] **Step 2: Add toolkit CSS (append to configure.css)**

```css
/* ===== compact control toolkit ===== */
.field { margin-bottom: 18px; }
.field > .field-label { font-size: .76rem; color: var(--text-dim); font-weight: 700; margin: 0 0 9px; display: flex; align-items: center; gap: 7px; }
.seg { display: flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 11px; padding: 3px; gap: 3px; }
.seg [data-val] { flex: 1; border: none; background: transparent; color: var(--text-dim); font-size: .8rem; font-weight: 600; padding: 9px 8px; border-radius: 8px; cursor: pointer; }
.seg [data-val].on { background: linear-gradient(135deg, var(--accent-a), var(--accent-b)); color: #1a0f14; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chips .chip { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-dim); font-size: .8rem; font-weight: 600; cursor: pointer; user-select: none; }
.chips .chip.on { background: rgba(251,146,60,.18); border-color: var(--accent-a); color: #fdba74; }
.chips.exclude .chip.on { background: rgba(224,85,85,.18); border-color: #e05555; color: #fca5a5; }
.switches { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sw { display: flex; align-items: center; gap: 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 11px 13px; cursor: pointer; user-select: none; }
.sw .knob { width: 38px; height: 22px; border-radius: 999px; background: #3a3142; position: relative; flex-shrink: 0; transition: .2s; }
.sw .knob::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: .2s; }
.sw.on .knob { background: linear-gradient(90deg, var(--accent-a), var(--accent-b)); }
.sw.on .knob::after { left: 18px; }
.sw .sw-lbl { font-size: .82rem; font-weight: 600; }
.sw .sw-sub { font-size: .68rem; color: var(--text-mute); }
.tilegroup { display: grid; gap: 8px; }
.tilegroup .tile { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 11px 8px; text-align: center; cursor: pointer; font-size: .74rem; font-weight: 600; color: var(--text-dim); }
.tilegroup .tile .tic { font-size: 1.25rem; display: block; margin-bottom: 4px; }
.tilegroup .tile.on { border-color: var(--accent-a); background: rgba(251,146,60,.14); color: #fdba74; }
.sliderrow { display: flex; gap: 12px; align-items: center; }
input[type=range][data-slider] { flex: 1; accent-color: var(--accent-a); }
.sliderval { font-size: .78rem; color: #fdba74; font-weight: 700; min-width: 72px; text-align: right; }
.statusgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.keytile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; cursor: pointer; }
.keytile-head { display: flex; align-items: center; gap: 8px; }
.keytile-head .kn { font-size: .76rem; font-weight: 600; flex: 1; }
.keytile .st { font-size: .58rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; }
.st.set { background: rgba(52,211,153,.16); color: #6ee7b7; }
.st.unset { background: #3a3142; color: #9a8f98; }
.hidden-canonical { display: none !important; }
```

- [ ] **Step 3: Load controls.js**

In `public/configure.html`, add after the `configure.js` script tag (before or after shell.js both fine):
```html
<script src="/js/controls.js"></script>
```

- [ ] **Step 4: Smoke-test the toolkit in isolation**

Run `npm start`, open `/configure?v=3`. In console: `typeof window.Controls.bindAll === 'function' && typeof window.Controls.syncAll === 'function'` → expect `true`. No console errors. `npm test` unchanged. (No visible change yet — tabs adopt it next.)

- [ ] **Step 5: Commit**

```bash
git add public/js/controls.js public/configure.html public/css/configure.css
git commit -m "Add shared compact-control toolkit (controls.js + CSS)"
```

---

## Task 4: Streaming tab → compact controls

Rewrite `#page-streaming` to visual controls while KEEPING every original input as a hidden canonical element. The originals (`#sort-order`, `#max-bitrate`, `.res-cb`, `#show-recommend`, etc.) stay in the DOM, hidden, so `collectConfig`/restore are untouched.

**Files:**
- Modify: `public/configure.html` (`#page-streaming`)
- Modify: `public/js/configure.js` (call `Controls.bindAll`/`syncAll` for this page)

- [ ] **Step 1: Restructure the Streaming markup**

Replace the inner content of `#page-streaming` (keep the `<h2 class="page-title">`/`<p class="page-sub">`). For each setting: render a visual control bound to a hidden canonical input. Pattern for a select-backed segment:

```html
<div class="field">
  <div class="field-label">📊 Sort streams by</div>
  <div class="seg" data-target="#sort-order">
    <button data-val="size">💾 File size</button>
    <button data-val="audio">🔊 Audio</button>
    <button data-val="bitrate">📶 Bitrate</button>
  </div>
  <select id="sort-order" class="hidden-canonical">
    <option value="size">File size (largest first)</option>
    <option value="audio">Audio quality (best first)</option>
    <option value="bitrate">Bitrate (highest first)</option>
  </select>
</div>
```

Apply the same pattern to ALL Streaming settings, moving each ORIGINAL element (from the current markup) into the `hidden-canonical` slot and adding a visual control bound by `data-target`:

- **Delivery mode** — radios `name="perf-mode"` (values normal/split/timeout). Since these are radios, keep the three radios hidden and use a segment whose buttons set the matching radio. For radio groups, add a tiny inline init (Step 2) OR convert: simplest is to keep a hidden `<select id="perf-mode-sel">` is NOT how configure.js reads it. configure.js reads `document.querySelector('input[name=perf-mode]:checked')` in `onModeChange`/collect. So for mode, bind a segment to set the radios: give the segment `data-radio="perf-mode"` and handle it in Step 2 with a small dedicated binder (radios need `.checked`, not `.value`). Keep the timeout `<select id="timeout-value">` visible only when timeout active (preserve existing `#timeout-row` show/hide via `onModeChange`).
- **Sort** — `#sort-order` segment (shown above).
- **Exclude resolutions** — `.res-cb` checkboxes (4K/1080p/720p/SD) → `<div class="chips exclude">` with a `.chip[data-target="#res-4k"]` per checkbox. Give each existing `.res-cb` a unique id (`res-4k`,`res-1080p`,`res-720p`,`res-sd`) and keep them hidden; chips toggle them.
- **Prefer codec** — `#pref-codec` segment/chips (Any/H.264/HEVC/AV1/VP9) + `#codec-mode` 2-segment (prefer/only). Both backed by hidden selects.
- **Audio language** — keep `#audio-lang` `<select>` VISIBLE but restyle with `.pick` (13 options — no pills). Not hidden.
- **Max bitrate** — replace `#max-bitrate` select with a native `<input type="range" data-slider data-label="#maxbr-val" data-format="bitrate">` PLUS keep `#max-bitrate` hidden; bind the range to write `#max-bitrate.value` on input. Simpler: keep `#max-bitrate` as the canonical select but drive it from the slider via a small adapter (Step 2). Register a `bitrate` formatter.
- **Extras** — `#show-recommend`,`#show-ping`,`#auto-select`,`#ping-detail` checkboxes → `.switches` grid of `.sw[data-target="#show-recommend"]` tiles with `.sw-lbl`/`.sw-sub`. Keep checkboxes hidden. Preserve `onShowPingChange`/`onModeChange` behavior (the switch click fires `change` on the hidden checkbox, which still triggers those handlers if they're wired as listeners; if they're inline `onchange`, the dispatched event will invoke them).

- [ ] **Step 2: Add the radio-segment, slider-adapter, and bitrate format helpers + page init**

In `controls.js`, extend with a radio binder and register the bitrate formatter (add inside the IIFE before `window.Controls =`):
```js
function bindRadioSeg(container) {
  const name = container.getAttribute('data-radio');
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  const sync = () => container.querySelectorAll('[data-val]').forEach(b => {
    const r = [...radios].find(x => x.value === b.getAttribute('data-val'));
    b.classList.toggle('on', !!(r && r.checked));
  });
  container.querySelectorAll('[data-val]').forEach(btn => btn.addEventListener('click', () => {
    const r = [...radios].find(x => x.value === btn.getAttribute('data-val'));
    if (r) { r.checked = true; fire(r, 'change'); } sync();
  }));
  sync();
}
function bindSliderToSelect(range) {
  // range.value is an index into a select given by data-select; sets select.value + fires change
  const sel = document.querySelector(range.getAttribute('data-select'));
  if (!sel) return;
  const opts = [...sel.options].map(o => o.value);
  const label = document.querySelector(range.getAttribute('data-label'));
  range.min = 0; range.max = opts.length - 1; range.step = 1;
  const idxOf = v => Math.max(0, opts.indexOf(v));
  range.value = idxOf(sel.value);
  const update = () => {
    sel.value = opts[range.value]; fire(sel, 'change');
    if (label) label.textContent = sel.options[range.value].textContent;
  };
  range.addEventListener('input', update); update();
}
```
Wire them into `Controls.bindAll`:
```js
root.querySelectorAll('.seg[data-radio]').forEach(bindRadioSeg);
root.querySelectorAll('input[type=range][data-select]').forEach(bindSliderToSelect);
```
And into `syncAll` (re-sync radio segments):
```js
root.querySelectorAll('.seg[data-radio]').forEach(c => { /* re-run sync */ bindRadioSegSync(c); });
```
To support that, refactor `bindRadioSeg`'s `sync` into a module function `bindRadioSegSync(container)` and call it from both. (Keep it simple: define `function bindRadioSegSync(container){...the sync body...}` and call it in bindRadioSeg.)

For Max bitrate use the `bindSliderToSelect` approach (range with `data-select="#max-bitrate" data-label="#maxbr-val"`), so the existing `#max-bitrate` select stays canonical.

In `configure.js`, ensure controls initialize on load and when the Streaming page shows. In the guarded init `DOMContentLoaded` block add at the end: `if (window.Controls) Controls.bindAll();`. In `window.onPageShow`, add: `if (window.Controls) Controls.syncAll();` (so restored values reflect after navigation). Also call `Controls.syncAll()` at the end of `restoreFromLocalStorage` (just before `return true`) so restored config updates the visual controls.

- [ ] **Step 3: Verify Streaming parity**

Run `npm start`, open `/configure?v=4#/streaming`. Confirm: segments for mode/sort/codec, red chips for exclude-resolutions, slider for max bitrate (label updates as you drag), switches for the four extras, audio-language dropdown present. Interact with each and run the **config-parity check**:
```js
// pick: split mode, sort=bitrate, exclude 1080p, codec=hevc only, max 20Mbps, recommended off
// then:
JSON.stringify(collectConfig(true))
```
Confirm the produced object has the expected `sortOrder`, `excludeRes`, codec, `maxBitrate`, and the boolean flags — i.e. the hidden inputs were updated by the visual controls. Reload (cache-bust) → the visual controls reflect the restored values (syncAll ran). Toggling a switch flips the matching hidden checkbox (`document.getElementById('show-recommend').checked`). Zero console errors; `npm test` unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/js/configure.js public/js/controls.js
git commit -m "Redesign Streaming tab with compact visual controls (hidden canonical inputs)"
```

---

## Task 5: Catalogs tab → compact controls

Apply the toolkit to `#page-catalogs`, keeping every existing control as hidden canonical where replaced, and preserving all handlers (`applyAllNetworks`, `onCatalogProviderChange`, `setTmdbMode`, `browseMdblistUser`, `browseTraktUser`, `addExternalCatalog`, `clearAllCatalogs`, drag-reorder).

**Files:**
- Modify: `public/configure.html` (`#page-catalogs`)
- Modify: `public/js/configure.js` (minor: ensure `Controls.bindAll`/`syncAll` cover this page; the existing handlers are reused)

- [ ] **Step 1: Restructure Catalogs into the approved blocks**

Rebuild `#page-catalogs` inner content (keep title/sub) as these blocks, reusing existing element ids/handlers:

1. **Quick add — streaming services**: a `.tilegroup` (6 cols on desktop) of service tiles. Each tile `onclick` calls the SAME preset logic the old service buttons used. The old `#preset-services` was populated by `initPresets()`. Keep `#preset-services` but restyle its generated buttons as `.tile` (adjust `initPresets` only if it sets classes — prefer adding CSS so existing markup looks like tiles; if `initPresets` builds plain buttons, add a CSS rule `#preset-services button { ...tile styles... }` instead of changing JS). Keep the `+ All major networks` button (`applyAllNetworks`). Keep `#preset-preview`/`#btn-apply-preset` working.
2. **Connections** (API keys): a `.statusgrid` of `.keytile`s for Trakt/MDbList/TMDB/RPDB. Each keytile shows a `.st` pill (`set`/`unset`) and, when clicked, reveals its existing key `<input>` (`#trakt-client-id`,`#mdblist-api-key`,`#tmdb-api-key`,`#rpdb-key`) inline. Keep those inputs in the DOM (inside the collapsible area of each tile). Add a tiny `toggleKeyTile(id)` helper in configure.js that shows/hides the input wrapper and, on input, flips the pill to `set` when non-empty. Wire each input's `oninput` (it already calls `autoSave()`) to also update its pill — do this generically in a new `refreshKeyPills()` called on catalogs `onPageShow`.
3. **Add a custom row**: provider `.tilegroup` (Trakt/MDbList/IMDb/Letterboxd/TMDB) bound to `#cat-provider` — since `#cat-provider` is a `<select>` whose `onchange="onCatalogProviderChange()"` reveals provider fields, render the tiles as a `.tilegroup[data-target="#cat-provider"]` (uses the existing segment binder: clicking a tile sets `#cat-provider.value` and fires change → `onCatalogProviderChange` runs). Keep `#cat-provider` hidden-canonical. Keep the provider-specific fields (`#cat-trakt-list`, `#cat-list-url`, `#cat-tmdb-fields` with its mode buttons, `#cat-media-type`, `#cat-name`) — restyle media-type as a `.seg[data-target="#cat-media-type"]`, keep the rest. Keep `addExternalCatalog()` Add button.
4. **Browse a user's lists**: keep `#mdblist-browse-user`/`#trakt-browse-user` inputs + their Browse buttons + results divs, but place them so they reveal under the MDbList/Trakt provider tiles (simplest acceptable: keep them as a compact "Import lists" sub-block shown only when provider is mdblist/trakt — reuse `onCatalogProviderChange` to toggle a wrapper's visibility; if that's complex, keeping them in a single compact "Import from a user" block is acceptable — do NOT drop them).
5. **Filters**: `#catalog-lang` → language chips OR compact `.pick` (8 options — a compact dropdown is fine; if using chips, only show a few common ones + keep the select hidden-canonical). `#no-dupes` checkbox → a `.sw[data-target="#no-dupes"]` switch. The **My Library** home-catalog toggle (`#show-catalog`) + `#catalog-content` + `#rpdb-key` (RPDB lives in Connections now) → render the home-catalog toggle as a `.sw`, `#catalog-content` as a `.seg` (Recent/Resume/Favorites). Keep all hidden-canonical.
6. **Your rows**: keep `#catalog-list` and its JS-built rows + `#catalog-count` + `clearAllCatalogs` (`#btn-clear-all`); restyle the generated rows via CSS to the pill look (add CSS for `.catalog-list > *`); do not change the row-building JS unless needed for the ✕/drag handles (they already exist).

Keep EVERY id and handler. Where a control is replaced by a visual one, the original becomes `class="hidden-canonical"` (add the class; keep the id and options).

- [ ] **Step 2: Add the small helpers + init**

In `configure.js` add:
```js
function toggleKeyTile(id) {
  const w = document.getElementById('keywrap-' + id);
  if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none';
}
function refreshKeyPills() {
  [['trakt-client-id','pill-trakt'],['mdblist-api-key','pill-mdblist'],['tmdb-api-key','pill-tmdb'],['rpdb-key','pill-rpdb']]
    .forEach(([inp, pill]) => {
      const i = document.getElementById(inp), p = document.getElementById(pill);
      if (i && p) { const set = !!i.value.trim(); p.textContent = set ? 'SET' : 'ADD KEY'; p.className = 'st ' + (set ? 'set' : 'unset'); }
    });
}
```
The key inputs already call `autoSave()` on input; add `;refreshKeyPills()` to their `oninput` in the markup, or attach a listener. Extend `onPageShow` catalogs branch (there is none yet — add it): `if (name === 'catalogs' && window.Controls) { Controls.syncAll(); refreshKeyPills(); }`. Ensure `Controls.bindAll()` (added in Task 4 init) covers the new catalog controls (it scans the whole document, so it does).

- [ ] **Step 3: Verify Catalogs parity**

Run `npm start`, open `/configure?v=5#/catalogs`. Confirm all blocks render: service tiles, Connections status grid (pills reflect whether keys are set; clicking a tile reveals its input; typing a key flips the pill to SET), provider tiles (clicking TMDB reveals TMDB fields; Charts/Discover mode buttons still work), media-type segment, filter chips/switches, your-rows list. Functionally: enter an MDbList username under the MDbList provider and Browse returns results; add a catalog row via the form → it appears in `#catalog-list`, `#catalog-count` updates, persists on reload; `applyAllNetworks` adds rows; `clearAllCatalogs` clears. **Parity:** `JSON.stringify(collectExternalCatalogs())` matches expectations for added rows; key inputs still flow into the generated config (`collectConfig(true)` includes `traktClientId`/`mdblistApiKey`/`tmdbApiKey` when set). Zero console errors; `npm test` unchanged.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/js/configure.js
git commit -m "Redesign Catalogs tab with compact visual controls"
```

---

## Task 6: Appearance tab → compact controls

Apply the toolkit to `#page-appearance` (the Labels + Display sections). Keep the label-format preset dropdown (6 options) and its live preview; convert toggles to switches and short option-lists to segments/chips.

**Files:**
- Modify: `public/configure.html` (`#page-appearance`)

- [ ] **Step 1: Convert Appearance controls**

In `#page-appearance`, keeping all ids/handlers and the live preview:
- `#label-preset` (6 options) → keep as a styled `.pick` dropdown (too many for pills); preview stays. The custom-format checkboxes (`.cn-field`,`.cd-field`) → render as `.chips` (each chip `data-target` to its hidden checkbox). Keep checkboxes hidden-canonical with their ids.
- `#show-summary` → `.sw[data-target="#show-summary"]`; keep `#summary-options` reveal (its `onchange="toggleSummaryStyle()"` still fires via the dispatched change). `#summary-style` (4 options) → `.seg[data-target="#summary-style"]`.
- `#quality-badge` (Off/Emoji/Tags) → `.seg`. `#flag-emoji` (4 options) → `.seg`. `#bitrate-bar` (4 options) → `.seg`. `#subs-style` (4 options) → `.seg`. Each backed by its hidden `<select>` (add `class="hidden-canonical"`, keep id + options + `onchange="autoSave()"`).

For each replaced `<select>`, the `.seg`'s `data-target` points at it; the segment binder sets `.value` + fires `change`, so the existing `onchange` (e.g. `autoSave`, `toggleSummaryStyle`, `updateSummaryPreview`) still runs.

- [ ] **Step 2: Verify Appearance**

Run `npm start`, open `/configure?v=6#/appearance`. Confirm: label-format dropdown + live preview work; custom-format chips toggle (when preset = Custom); summary switch reveals options; quality/language/bitrate/subtitle as segments. Changing any updates autosave (indicator flashes) and persists on reload (segments reflect restored values via `syncAll`). Zero console errors; `npm test` unchanged.

- [ ] **Step 3: Commit**

```bash
git add public/configure.html
git commit -m "Redesign Appearance tab with compact visual controls"
```

---

## Task 7: Full-flow verification

**Files:** none (verification + any small fixes uncovered)

- [ ] **Step 1: Cross-page smoke + parity**

Run `npm start`. Walk every page (`#/dashboard`,`#/servers`,`#/catalogs`,`#/streaming`,`#/appearance`,`#/health`,`#/install`,`#/ping`,`#/log`) with cache-bust; confirm each renders with zero console errors (favicon OK). Specifically:
- Servers: Manage button works, corners square, per-server buttons clickable.
- Dashboard: stats served from cache on revisit (no repeat `/api/library-stats`); Refresh re-fetches.
- Streaming/Catalogs/Appearance: visual controls reflect saved state after reload.
- **End-to-end parity:** configure a server + a couple of settings + a catalog row, generate an install link on the Install page, and decode the base64 config — confirm it contains the expected servers/settings/catalogs (proves the hidden-canonical wiring feeds `generateLinks` correctly).

- [ ] **Step 2: Reduced-motion**

In DevTools enable "Emulate prefers-reduced-motion: reduce" → confirm animations freeze (the toolkit uses transitions; the existing reduced-motion block disables them).

- [ ] **Step 3: Backend tests**

Run `npm test` → 46 pass / 2 fail (baseline), unchanged.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "Verify compact redesign across all pages"
```

---

## Self-review notes

- **Spec coverage:** toolkit (T3), Streaming (T4), Catalogs (T5), Appearance (T6), Manage-fix + square (T1), Dashboard cache (T2), parity/verify (T7). All spec sections mapped.
- **Schema safety:** every replaced control keeps its original element as `hidden-canonical` (same id/options); `collectConfig`/`generateLinks`/restore read those unchanged. The parity checks in T4–T7 guard this.
- **Handler preservation:** segment/switch/chip binders dispatch native `change` on the canonical element, so existing inline `onchange` handlers (`autoSave`, `onModeChange`, `onShowPingChange`, `toggleSummaryStyle`, `onCatalogProviderChange`, etc.) keep firing.
- **Naming consistency:** `Controls.bindAll`/`Controls.syncAll`/`bindSegment`/`bindSwitch`/`bindChips`/`bindSlider`/`bindRadioSeg`/`bindSliderToSelect`/`toggleKeyTile`/`refreshKeyPills`/`renderDashboard(force)`/`_libStatsCache` used consistently across tasks.
