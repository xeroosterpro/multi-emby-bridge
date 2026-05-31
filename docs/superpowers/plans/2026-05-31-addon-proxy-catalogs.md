# Addon-Proxy Catalogs + Library Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `addon` catalog provider that re-serves another Stremio addon's catalog endpoint (so TOP Streaming's and Streaming Catalogs' exact rows appear in this addon), an importer + presets to add them, and multi-select "My Library" rows including a new Emby/Jellyfin **Next Up** row.

**Architecture:** New `addon` branch in `fetchExternalCatalog` (lib/catalogs.js) fetches `‹sourceUrl›/catalog/‹type›/‹id›.json` and maps its `metas` through a pure `mapAddonMetas` helper. A `POST /api/addon-catalogs` endpoint lists a source addon's catalogs for the importer UI. The single `myemby` catalog becomes per-row `myemby-<key>` catalogs driven by `cfg.libraryRows`; `getRecentlyAdded` gains a `nextup` branch. The saved-config schema only gains fields; existing installs stay valid.

**Tech Stack:** Node + Express, vanilla JS frontend, `node:test`-style assertions in `test/*.test.js`. Network-dependent paths are verified live against the real addon endpoints (they are public and online).

---

## Verification convention

- Backend pure helpers get real unit tests in `test/` (run with `npm test`; baseline is **46 pass / 2 fail** pre-existing — new tests add to the pass count).
- Network/route behavior is verified live: `npm start` (port 7000), then `curl` against the running server and against the real source addons:
  - Streaming Catalogs base: `https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club`
  - TOP Streaming base: `https://top-streaming.stream/471c23c0-6756-471c-a7eb-f41927b5c214`
- Frontend verified in browser at `http://localhost:7000/configure?v=N#/catalogs` (cache-bust with `?v=N`), zero console errors except a `favicon.ico` 404.
- Next Up against a real Emby cannot be tested here (no live Emby); verify its URL construction and the pure series-imdb mapping via unit test, and confirm the manifest/route wiring. Note this explicitly in the task report.

Commit only after the task's checks pass. Do not push (the controller pushes at the end).

---

## Task 1: Addon provider in lib/catalogs.js

**Files:**
- Modify: `lib/catalogs.js` (add `mapAddonMetas` + `fetchAddonCatalog` + `addon` branch in `fetchExternalCatalog`; export `mapAddonMetas`)
- Test: `test/catalogs.test.js` (new)

- [ ] **Step 1: Write a failing test for `mapAddonMetas`**

Create `test/catalogs.test.js`:
```js
const assert = require('assert');
const { mapAddonMetas } = require('../lib/catalogs');

// maps Stremio metas to {id,type,name,poster}, filters non-tt ids, dedupes, applies RPDB when key present
const input = [
  { id: 'tt001', type: 'movie', name: 'A', poster: 'http://src/a.jpg', description: 'd', releaseInfo: '2020' },
  { id: 'tt001', type: 'movie', name: 'A dup', poster: 'http://src/a2.jpg' },
  { id: 'kitsu:5', type: 'movie', name: 'NoTt' },
];
const out = mapAddonMetas(input, 'movie', null);
assert.strictEqual(out.length, 1, 'dedupes by id and drops non-tt');
assert.strictEqual(out[0].id, 'tt001');
assert.strictEqual(out[0].type, 'movie');
assert.strictEqual(out[0].name, 'A');
assert.strictEqual(out[0].poster, 'http://src/a.jpg', 'keeps source poster when no rpdb key');
assert.strictEqual(out[0].description, 'd');
assert.strictEqual(out[0].releaseInfo, '2020');

const outR = mapAddonMetas(input, 'movie', 'RPDBKEY');
assert.ok(outR[0].poster.includes('ratingposterdb.com/RPDBKEY/imdb/poster-default/tt001'), 'rpdb override');

console.log('mapAddonMetas tests passed');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node test/catalogs.test.js`
Expected: throws `TypeError: mapAddonMetas is not a function` (not yet exported).

- [ ] **Step 3: Implement `mapAddonMetas` + `fetchAddonCatalog` + the dispatch branch**

In `lib/catalogs.js`, add these functions (place near the other fetchers, before `module.exports`):
```js
function mapAddonMetas(metas, type, rpdbKey) {
  const seen = new Set();
  const out = [];
  for (const m of (Array.isArray(metas) ? metas : [])) {
    const id = m && m.id;
    if (!id || !String(id).startsWith('tt') || seen.has(id)) continue;
    seen.add(id);
    const poster = rpdbKey
      ? 'https://api.ratingposterdb.com/' + rpdbKey + '/imdb/poster-default/' + id + '.jpg'
      : (m.poster || 'https://images.metahub.space/poster/medium/' + id + '/img');
    const meta = { id, type, name: m.name || id, poster };
    if (m.description) meta.description = m.description;
    if (m.releaseInfo) meta.releaseInfo = m.releaseInfo;
    out.push(meta);
  }
  return out;
}

async function fetchAddonCatalog(entry, rpdbKey) {
  const base = String(entry.sourceUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('addon catalog: missing sourceUrl');
  const url = base + '/catalog/' + entry.catalogType + '/' + encodeURIComponent(entry.catalogId) + '.json';
  const cacheKey = 'addon:' + base + ':' + entry.catalogType + ':' + entry.catalogId;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const resp = await timedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' } }, 8000);
  if (!resp.ok) throw new Error('addon catalog HTTP ' + resp.status);
  const data = await resp.json();
  const mapped = mapAddonMetas(data && data.metas, entry.catalogType, rpdbKey);
  cacheSet(cacheKey, mapped);
  return mapped;
}
```

In `fetchExternalCatalog`, add the branch (before the final `else { throw … Unknown provider }`):
```js
} else if (entry.provider === 'addon') {
  return await fetchAddonCatalog(entry, rpdbKey);
}
```

Update the exports line to include `mapAddonMetas`:
```js
module.exports = { fetchExternalCatalog, mapAddonMetas, TMDB_MOVIE_GENRES, TMDB_TV_GENRES };
```

- [ ] **Step 4: Run the test — passes**

Run: `node test/catalogs.test.js`
Expected: prints `mapAddonMetas tests passed`, exit 0.

- [ ] **Step 5: Live-verify the real fetch**

Run `npm start`, then in another shell:
```bash
node -e "const {fetchExternalCatalog}=require('./lib/catalogs'); fetchExternalCatalog({provider:'addon',sourceUrl:'https://top-streaming.stream/471c23c0-6756-471c-a7eb-f41927b5c214',catalogType:'movie',catalogId:'netflix-movies-united-states'},null).then(m=>console.log('items',m.length,m[0])).catch(e=>console.log('ERR',e.message))"
```
Expected: `items 12 { id: 'tt…', type: 'movie', name: …, poster: … }` (a real Top-10 list).

- [ ] **Step 6: Commit**

```bash
git add lib/catalogs.js test/catalogs.test.js
git commit -m "Add addon-proxy catalog provider (fetchAddonCatalog + mapAddonMetas)"
```

---

## Task 2: `/api/addon-catalogs` importer endpoint

**Files:**
- Modify: `server.js` (add the route near the other `/api/*` routes, e.g. after `/api/library-stats`)

- [ ] **Step 1: Add the endpoint**

```js
app.post('/api/addon-catalogs', apiLimiter, express.json(), async (req, res) => {
  let manifestUrl = (req.body && req.body.manifestUrl || '').trim();
  if (!manifestUrl) return res.status(400).json({ error: 'manifestUrl required' });
  if (!/^https?:\/\//i.test(manifestUrl)) manifestUrl = 'https://' + manifestUrl;
  if (!/\/manifest\.json($|\?)/i.test(manifestUrl)) {
    manifestUrl = manifestUrl.replace(/\/+$/, '') + '/manifest.json';
  }
  const baseUrl = manifestUrl.replace(/\/manifest\.json.*$/i, '');
  try {
    const r = await fetchWithTimeout(manifestUrl, 8000, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stremio-Addon/1.0)' } });
    if (!r.ok) return res.status(502).json({ error: 'Manifest HTTP ' + r.status });
    const mf = await r.json();
    const catalogs = (Array.isArray(mf.catalogs) ? mf.catalogs : [])
      .map(c => ({ type: c.type, id: c.id, name: c.name || c.id }))
      .filter(c => (c.type === 'movie' || c.type === 'series') && c.id);
    res.json({ name: mf.name || 'Addon', version: mf.version || '', baseUrl, catalogs });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Timed out fetching manifest' });
    res.status(502).json({ error: err.message });
  }
});
```

(Use the existing `fetchWithTimeout` helper already used by `/api/library-stats`; confirm its name by reading `server.js` — it is referenced at the library-stats route.)

- [ ] **Step 2: Live-verify against both addons**

Run `npm start`, then:
```bash
curl -s -XPOST localhost:7000/api/addon-catalogs -H 'Content-Type: application/json' -d '{"manifestUrl":"https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json"}'
curl -s -XPOST localhost:7000/api/addon-catalogs -H 'Content-Type: application/json' -d '{"manifestUrl":"https://top-streaming.stream/471c23c0-6756-471c-a7eb-f41927b5c214/manifest.json"}'
```
Expected: JSON with `baseUrl` and a `catalogs` array — 10 entries for Streaming Catalogs (nfx/hbm/dnp/amp/atp × movie+series), ~23 for TOP Streaming. Also test passing a base URL without `/manifest.json` (should still work).

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "Add /api/addon-catalogs importer endpoint"
```

---

## Task 3: Library rows — manifest `myemby-<key>` + libraryRows + route parsing

**Files:**
- Modify: `server.js` (manifest catalog build; both catalog route handlers)
- Test: `test/library-rows.test.js` (new) for the pure `deriveLibraryRows` helper

- [ ] **Step 1: Write a failing test for `deriveLibraryRows`**

Create `test/library-rows.test.js`:
```js
const assert = require('assert');
const { deriveLibraryRows } = require('../server-helpers');

assert.deepStrictEqual(deriveLibraryRows({ libraryRows: ['recent','nextup'] }), ['recent','nextup']);
assert.deepStrictEqual(deriveLibraryRows({ catalogContent: 'resume' }), ['resume'], 'legacy single content');
assert.deepStrictEqual(deriveLibraryRows({ showCatalog: false }), [], 'catalog disabled → none');
assert.deepStrictEqual(deriveLibraryRows({}), ['recent'], 'default');
assert.deepStrictEqual(deriveLibraryRows({ libraryRows: ['bogus','resume'] }), ['resume'], 'drops unknown keys');
console.log('deriveLibraryRows tests passed');
```

- [ ] **Step 2: Run it — fails**

Run: `node test/library-rows.test.js`
Expected: `Cannot find module '../server-helpers'`.

- [ ] **Step 3: Create `server-helpers.js` with `deriveLibraryRows` and `ROW_NAMES`**

Create `server-helpers.js` at the repo root:
```js
const ROW_NAMES = { recent: 'Recently Added', resume: 'Continue Watching', nextup: 'Next Up', favorites: 'Favorites' };
const VALID = Object.keys(ROW_NAMES);

function deriveLibraryRows(cfg) {
  cfg = cfg || {};
  if (cfg.showCatalog === false) return [];
  if (Array.isArray(cfg.libraryRows)) {
    const rows = cfg.libraryRows.filter(k => VALID.includes(k));
    return rows.length ? rows : ['recent'];
  }
  if (cfg.catalogContent && VALID.includes(cfg.catalogContent)) return [cfg.catalogContent];
  return ['recent'];
}

module.exports = { ROW_NAMES, VALID, deriveLibraryRows };
```

- [ ] **Step 4: Run the test — passes**

Run: `node test/library-rows.test.js` → `deriveLibraryRows tests passed`.

- [ ] **Step 5: Use it in the manifest build (server.js ~461-471)**

At the top of `server.js`, add: `const { ROW_NAMES, deriveLibraryRows } = require('./server-helpers');`

Replace the two hardcoded `myemby` catalog entries in the manifest `catalogs` array with generated per-row entries. Replace:
```js
    catalogs: [
      { type: 'movie',  id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: cfg.showCatalog === false }] },
      { type: 'series', id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: cfg.showCatalog === false }] },
      ...extCats,
    ],
```
with:
```js
    catalogs: [
      ...buildLibraryCatalogs(cfg),
      ...extCats,
    ],
```
and add this helper just above `res.json({`:
```js
    const buildLibraryCatalogs = (cfg) => {
      const rows = deriveLibraryRows(cfg);
      const out = [];
      // Always expose a searchable My Media entry so search works even with no rows enabled.
      out.push({ type: 'movie',  id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: true }] });
      out.push({ type: 'series', id: 'myemby', name: 'My Media', extra: [{ name: 'search', isRequired: true }] });
      rows.forEach(key => {
        const types = key === 'nextup' ? ['series'] : ['movie', 'series'];
        types.forEach(type => out.push({ type, id: 'myemby-' + key, name: ROW_NAMES[key], extra: [] }));
      });
      return out;
    };
```
(Define `buildLibraryCatalogs` as a `const` before the `res.json` call, or as a function above the route. It references `cfg` from the route scope — pass it explicitly as shown.)

Rationale: the bare `myemby` id stays (search keeps working and old installs keep a row when `isRequired:true` hides it from home but allows search); the visible home rows are the `myemby-<key>` catalogs.

- [ ] **Step 6: Parse `myemby-<key>` in both catalog routes**

In BOTH route handlers (`/:config/catalog/:type/:id/:extra.json` and `/:config/catalog/:type/:id.json`), the browse branch currently calls `getRecentlyAdded(..., cfg.catalogContent || 'recent', ...)`. Before that branch, add handling for the per-row ids. Replace the browse call so the content key is derived from the id:
```js
      const libKey = (req.params.id && req.params.id.indexOf('myemby-') === 0)
        ? req.params.id.slice('myemby-'.length)
        : (cfg.catalogContent || 'recent');
      const metas = await getRecentlyAdded(servers, type, 8000, cfg.rpdbKey || null, libKey, cfg.catalogLang || null);
```
Apply this in BOTH handlers (the `:extra.json` one inside its `else`/browse branch, and the `:id.json` one). Leave the `extcat-` and search branches unchanged.

- [ ] **Step 7: Live-verify the manifest**

Run `npm start`. Build a config token with `libraryRows` (use the configure page, or hand-encode). Simplest: open `/configure`, add a server, in console run:
```js
// enable recent+resume+nextup then read manifest
```
Or curl the manifest for a known-good encoded config and confirm it lists `myemby-recent`, `myemby-resume`, `myemby-nextup` (series only), and that `myemby-favorites` appears only if enabled. Also confirm a legacy config with `catalogContent:'resume'` and no `libraryRows` still produces a `myemby-resume` row (back-compat). Confirm `node test/library-rows.test.js` passes and `npm test` baseline unchanged.

- [ ] **Step 8: Commit**

```bash
git add server.js server-helpers.js test/library-rows.test.js
git commit -m "Generate per-row My Library catalogs (libraryRows) with back-compat"
```

---

## Task 4: Next Up fetch in getRecentlyAdded

**Files:**
- Modify: `lib/search.js` (`getRecentlyAdded` — add `nextup` branch + series-imdb resolution)

- [ ] **Step 1: Add the `nextup` branch**

In `getRecentlyAdded` (lib/search.js ~468), `nextup` needs a different shape (episodes → series), so handle it BEFORE the existing `Promise.allSettled` block. At the start of the function, after computing `itemType`, add:
```js
  if (catalogContent === 'nextup') {
    if (type !== 'series') return [];   // Next Up is series-only
    return await getNextUp(servers, timeoutMs, rpdbKey);
  }
```
Then add the `getNextUp` function (in the same file, above `getRecentlyAdded` or below it; it uses the same `apiFetch` helper already imported/used in this file):
```js
async function getNextUp(servers, timeoutMs, rpdbKey) {
  const posterKey = rpdbKey || 't2-3b15b466-4b6f-42bd-a2eb-adf50aba65b2';
  const seen = new Map();
  await Promise.allSettled(servers.map(async (server) => {
    // 1) next-up episodes (have SeriesId + SeriesName)
    const epResp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Shows/NextUp`);
      url.searchParams.set('UserId', server.userId);
      url.searchParams.set('Limit', '24');
      url.searchParams.set('Fields', 'SeriesId');
      return url;
    }, timeoutMs);
    if (!epResp.ok) return;
    const epData = await epResp.json();
    const eps = Array.isArray(epData) ? epData : (epData?.Items || []);
    const order = [];
    const seriesIds = [];
    for (const ep of eps) {
      const sid = ep.SeriesId;
      const sname = ep.SeriesName;
      if (!sid || seen.has('pending:' + sid)) continue;
      order.push({ sid, sname });
      seriesIds.push(sid);
    }
    if (!seriesIds.length) return;
    // 2) resolve those series → ProviderIds (imdb)
    const seResp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      url.searchParams.set('Ids', seriesIds.join(','));
      url.searchParams.set('IncludeItemTypes', 'Series');
      url.searchParams.set('Fields', 'ProviderIds');
      return url;
    }, timeoutMs);
    if (!seResp.ok) return;
    const seData = await seResp.json();
    const seItems = Array.isArray(seData) ? seData : (seData?.Items || []);
    const imdbBySid = new Map();
    for (const s of seItems) {
      const imdb = s.ProviderIds?.Imdb || s.ProviderIds?.imdb;
      if (imdb && imdb.startsWith('tt')) imdbBySid.set(s.Id, { imdb, name: s.Name });
    }
    for (const { sid, sname } of order) {
      const hit = imdbBySid.get(sid);
      if (!hit || seen.has(hit.imdb)) continue;
      seen.set(hit.imdb, {
        id: hit.imdb, type: 'series', name: hit.name || sname || hit.imdb,
        poster: `https://api.ratingposterdb.com/${posterKey}/imdb/poster-default/${hit.imdb}.jpg`,
      });
    }
  }));
  return [...seen.values()].slice(0, 20);
}
```
(Remove the unused `pending:` guard if it complicates — its only purpose is avoiding duplicate series within one server's list; the final `seen.has(hit.imdb)` dedupe already covers cross-server duplicates. Keep the code simple: drop the `seen.has('pending:'...)` check and just collect unique `sid`s per server via a local `Set`.)

Simplify the episode loop to:
```js
    const localSids = new Set();
    const order = [];
    for (const ep of eps) {
      if (!ep.SeriesId || localSids.has(ep.SeriesId)) continue;
      localSids.add(ep.SeriesId);
      order.push({ sid: ep.SeriesId, sname: ep.SeriesName });
    }
    const seriesIds = [...localSids];
```

- [ ] **Step 2: Syntax check + a structural unit test**

Run: `node --check lib/search.js` → passes.

Add to `test/library-rows.test.js` (or a new `test/nextup.test.js`) a check that `getRecentlyAdded` returns `[]` for `nextup` + `movie` without hitting the network:
```js
const { getRecentlyAdded } = require('../lib/search');
getRecentlyAdded([], 'movie', 1000, null, 'nextup', null).then(r => {
  assert.deepStrictEqual(r, [], 'nextup movie returns empty');
  console.log('nextup movie-empty test passed');
});
```
Run it: `node test/nextup.test.js` → passes (empty servers list, movie type → `[]`, no network).

- [ ] **Step 3: Note the live-Emby limitation**

Document in the task report: full Next Up behavior (episode→series→imdb) can't be exercised without a live Emby/Jellyfin; URL construction + the movie-empty path are verified. The user will test against their real server post-deploy.

- [ ] **Step 4: Commit**

```bash
git add lib/search.js test/nextup.test.js
git commit -m "Add Next Up library row (Emby /Shows/NextUp → series imdb)"
```

---

## Task 5: Frontend — addon provider plumbing, importer UI, presets

**Files:**
- Modify: `public/configure.html` (importer block in `#page-catalogs`)
- Modify: `public/js/configure.js` (`browseAddonCatalogs`, addon dataset in `renderCatalogRow` + `collectExternalCatalogs`, presets)
- Modify: `public/css/configure.css` (minor importer results styling — reuse toolkit classes)

- [ ] **Step 1: Persist addon fields through the catalog row**

`collectExternalCatalogs()` reads from `row.dataset.*`. Extend it to carry addon fields. After the `tmdb` block, add:
```js
    if (catEntry.provider === 'addon') {
      catEntry.sourceUrl   = row.dataset.sourceUrl   || '';
      catEntry.catalogId   = row.dataset.catalogId   || '';
      catEntry.catalogType = row.dataset.catalogType || catEntry.mediaType;
    }
```
And in `renderCatalogRow(cat, id)` (read the function; it sets `row.dataset.*` from `cat`), add assignments so addon fields round-trip. Find where it sets `row.dataset.provider = cat.provider` etc. and add:
```js
  if (cat.provider === 'addon') {
    row.dataset.sourceUrl   = cat.sourceUrl   || '';
    row.dataset.catalogId   = cat.catalogId   || '';
    row.dataset.catalogType = cat.catalogType || cat.mediaType || 'movie';
  }
```
(If `renderCatalogRow` builds dataset generically, ensure these three keys are included.)

- [ ] **Step 2: Add the importer UI block to `#page-catalogs`**

Add this block (place it near the existing MDbList/Trakt browse blocks):
```html
<div class="browse-section">
  <div class="browse-header"><strong>📥 Import from a Stremio addon</strong>
    <span class="preset-hint">Paste an addon's manifest URL to add its catalogs (e.g. TOP Streaming)</span></div>
  <div class="browse-input-row">
    <input type="text" id="addon-import-url" placeholder="https://…/manifest.json" style="flex:1;padding:0.35rem 0.6rem;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);font-size:0.8rem" />
    <button class="btn-add-catalog" onclick="browseAddonCatalogs()">Browse</button>
  </div>
  <div id="addon-import-results"></div>
</div>
```

- [ ] **Step 3: Implement `browseAddonCatalogs()` in configure.js**

```js
async function browseAddonCatalogs() {
  const url = (document.getElementById('addon-import-url').value || '').trim();
  const box = document.getElementById('addon-import-results');
  if (!url) { box.innerHTML = '<div class="profile-status error">Paste a manifest URL first.</div>'; return; }
  box.innerHTML = '<div class="profile-status info">Loading…</div>';
  try {
    const r = await fetch('/api/addon-catalogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: url }) });
    const data = await r.json();
    if (!r.ok || data.error) { box.innerHTML = '<div class="profile-status error">' + escHtml(data.error || 'Failed') + '</div>'; return; }
    window._addonImport = { baseUrl: data.baseUrl, catalogs: data.catalogs };
    let html = '<div class="profile-status info">' + escHtml(data.name) + ' ' + escHtml(data.version) + ' — ' + data.catalogs.length + ' catalogs</div>';
    html += '<label style="display:block;margin:6px 0;font-size:.78rem"><input type="checkbox" id="addon-sel-all" onchange="document.querySelectorAll(&quot;.addon-imp-cb&quot;).forEach(c=>c.checked=this.checked)"> Select all</label>';
    data.catalogs.forEach((c, i) => {
      html += '<label class="preset-preview-item"><input type="checkbox" class="addon-imp-cb" data-idx="' + i + '" checked> '
            + escHtml(c.name) + ' <span class="cat-provider-badge">' + (c.type === 'series' ? 'Shows' : 'Movies') + '</span></label>';
    });
    html += '<button class="btn-add-catalog" style="margin-top:8px" onclick="addImportedAddonCatalogs()">+ Add selected</button>';
    box.innerHTML = html;
  } catch (e) { box.innerHTML = '<div class="profile-status error">' + escHtml(e.message) + '</div>'; }
}

function addImportedAddonCatalogs() {
  const imp = window._addonImport; if (!imp) return;
  let added = 0;
  document.querySelectorAll('.addon-imp-cb:checked').forEach(cb => {
    const c = imp.catalogs[Number(cb.dataset.idx)];
    if (!c) return;
    addExternalCatalog({ provider: 'addon', sourceUrl: imp.baseUrl, catalogId: c.id, catalogType: c.type, mediaType: c.type, name: c.name });
    added++;
  });
  const box = document.getElementById('addon-import-results');
  if (box) box.innerHTML = '<div class="profile-status success">Added ' + added + ' catalog row(s).</div>';
}
```

- [ ] **Step 4: Make `addExternalCatalog` accept addon preset/import objects**

`addExternalCatalog(cat)` already takes a `cat` object directly (used by presets). Confirm that when called with an `addon` cat object it passes it straight to `renderCatalogRow` (the `if (!cat) {…}` block only runs when no object is given). It does. No change needed beyond Step 1's dataset round-trip — but verify `testCatalog(id)` (auto-test on add) tolerates an `addon` row. Read `testCatalog`; if it only handles known providers, add an `addon` case to its provider switch that calls the live catalog (or simply skips testing for addon by `if (cat.provider==='addon') { /* mark ok */ }`). Minimal: in `addExternalCatalog`, guard the auto-test: change `if (!cat.count && cat.enabled !== false) testCatalog(id);` to also skip when `cat.provider==='addon'` is not supported by testCatalog — i.e. only call testCatalog for addon if testCatalog has an addon branch. Implement an `addon` branch in `testCatalog` that POSTs nothing and instead does a quick `fetch('/api/addon-catalogs',…)`? No — testCatalog tests row content. Simpler: give `addon` rows a neutral "added" state and skip auto-test: wrap as `if (!cat.count && cat.enabled !== false && cat.provider !== 'addon') testCatalog(id);`.

- [ ] **Step 5: Add the presets**

In `STREAMING_PRESETS` (configure.js ~31), add two entries. Streaming Catalogs (baked):
```js
  streamingcatalogs: { label: "Streaming Catalogs", color: "#111", letter: "S", catalogs: [
    { name: "Netflix",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "nfx", catalogType: "movie",  mediaType: "movie"  },
    { name: "Netflix",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "nfx", catalogType: "series", mediaType: "series" },
    { name: "HBO Max",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "hbm", catalogType: "movie",  mediaType: "movie"  },
    { name: "HBO Max",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "hbm", catalogType: "series", mediaType: "series" },
    { name: "Disney+",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "dnp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Disney+",       provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "dnp", catalogType: "series", mediaType: "series" },
    { name: "Prime Video",   provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "amp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Prime Video",   provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "amp", catalogType: "series", mediaType: "series" },
    { name: "Apple TV+",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "atp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Apple TV+",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "atp", catalogType: "series", mediaType: "series" },
  ] },
```
TOP Streaming (routes to importer — no baked catalogs, per-user URL). Add a preset with an empty `catalogs: []` and an `importHint: true` flag, and special-case it in the preset click handler `selectPreset(key)` (read it; near line 214): if `key === 'topstreaming'`, instead of showing the preview, focus `#addon-import-url`, set its placeholder to "Paste YOUR TOP Streaming manifest URL", scroll it into view, and return. Add:
```js
  topstreaming: { label: "TOP Streaming", color: "#c0392b", letter: "T", importHint: true, catalogs: [] },
```
In `selectPreset`, at the top: `if (STREAMING_PRESETS[key] && STREAMING_PRESETS[key].importHint) { const el=document.getElementById('addon-import-url'); if(el){ el.focus(); el.scrollIntoView({behavior:'smooth',block:'center'});} return; }`

`applyPreset` builds rows from the selected preset's checked catalogs via `addExternalCatalog(cat)`; the addon cat objects carry `sourceUrl/catalogId/catalogType`, which Step 1 persists. Confirm `initPresets`/preview rendering handles an `addon` provider badge (the preview uses `cat.provider` for a badge class — an unknown class is harmless).

- [ ] **Step 6: Verify in browser**

Run `npm start`, open `/configure?v=5#/catalogs`.
- Click the **Streaming Catalogs** preset → preview shows 10 rows → Apply → 10 addon rows land in the list; reload → they persist; `collectExternalCatalogs()` entries have `provider:'addon'` with `sourceUrl/catalogId/catalogType`.
- In the **Import from a Stremio addon** block, paste the TOP Streaming manifest URL → Browse → ~23 catalogs listed with checkboxes → "Add selected" → rows added & persist.
- Click the **TOP Streaming** preset button → focus jumps to the import URL field.
- Zero console errors. `npm test` baseline unchanged.

- [ ] **Step 7: Commit**

```bash
git add public/configure.html public/js/configure.js public/css/configure.css
git commit -m "Add addon-catalog importer UI, presets, and row persistence"
```

---

## Task 6: Frontend — My Library multi-row control

**Files:**
- Modify: `public/configure.html` (My Library block in `#page-catalogs`)
- Modify: `public/js/configure.js` (collect `libraryRows`; restore; keep back-compat)

- [ ] **Step 1: Replace the single content control with multi-row switches**

In the My Library block, the current control is a `.seg`/select bound to `#catalog-content`. Replace it with four switch tiles (toolkit `.sw`) backed by hidden checkboxes — `#libchk-recent`, `#libchk-resume`, `#libchk-nextup`, `#libchk-favorites`:
```html
<div class="field"><div class="field-label">Home rows</div>
  <div class="switches">
    <div class="sw" data-target="#libchk-recent"><div class="knob"></div><div><div class="sw-lbl">🆕 Recently Added</div></div></div>
    <div class="sw" data-target="#libchk-resume"><div class="knob"></div><div><div class="sw-lbl">▶️ Continue Watching</div></div></div>
    <div class="sw" data-target="#libchk-nextup"><div class="knob"></div><div><div class="sw-lbl">⏭️ Next Up</div></div></div>
    <div class="sw" data-target="#libchk-favorites"><div class="knob"></div><div><div class="sw-lbl">⭐ Favorites</div></div></div>
  </div>
  <div class="hidden-canonical">
    <input type="checkbox" id="libchk-recent" checked onchange="autoSave()" />
    <input type="checkbox" id="libchk-resume" onchange="autoSave()" />
    <input type="checkbox" id="libchk-nextup" onchange="autoSave()" />
    <input type="checkbox" id="libchk-favorites" onchange="autoSave()" />
  </div>
</div>
```
Keep the existing `#catalog-content` element present but hidden (so any other code referencing it doesn't break); it is no longer the source of truth.

- [ ] **Step 2: Collect `libraryRows` and restore it**

In the config-collection function (where `showCatalog`, `catalogContent`, etc. are gathered — search for `catalogContent` in `configure.js`), build `libraryRows` from the checkboxes and include it. Add:
```js
  const libraryRows = ['recent','resume','nextup','favorites'].filter(k => {
    const el = document.getElementById('libchk-' + k); return el && el.checked;
  });
```
and set `config.libraryRows = libraryRows;` (alongside the existing catalog fields). You may keep writing `catalogContent` = `libraryRows[0] || 'recent'` for backward viewing, but `libraryRows` is authoritative.

In the restore path (where saved config repopulates the form — search where `catalogContent` is read to set the control), set the checkboxes from saved `libraryRows` (falling back to `[catalogContent]` then `['recent']`):
```js
  const savedRows = Array.isArray(state.libraryRows) ? state.libraryRows
                   : (state.catalogContent ? [state.catalogContent] : ['recent']);
  ['recent','resume','nextup','favorites'].forEach(k => {
    const el = document.getElementById('libchk-' + k); if (el) el.checked = savedRows.includes(k);
  });
  if (window.Controls) Controls.syncAll();
```

- [ ] **Step 3: Verify**

Run `npm start`, open `/configure?v=6#/catalogs`. Toggle the four Home-rows switches. `collectConfig(true)` (or the relevant collector) includes `libraryRows` reflecting the toggles. Generate an install link, decode the config, confirm `libraryRows` is present; fetch that config's `/manifest.json` and confirm it lists `myemby-recent`/`myemby-resume`/`myemby-nextup`(series only)/`myemby-favorites` matching the toggles. Reload → switches reflect saved state. Zero console errors; `npm test` baseline.

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/js/configure.js
git commit -m "Add multi-row My Library control (libraryRows incl. Next Up)"
```

---

## Task 7: End-to-end verification

**Files:** none (verification)

- [ ] **Step 1: Full backend tests**

Run `npm test` and `node test/catalogs.test.js && node test/library-rows.test.js && node test/nextup.test.js`. Expected: all new tests pass; baseline 46/2 unchanged.

- [ ] **Step 2: Live addon-proxy end-to-end**

Run `npm start`. Via the configure page: add a server, apply the Streaming Catalogs preset, generate an install link. Take the encoded config and curl a proxied catalog row, e.g.:
```bash
curl -s "http://localhost:7000/<config>/catalog/movie/extcat-0.json" | head -c 400
```
Expected: real metas with `tt…` ids and posters (the live Streaming Catalogs Netflix list). Repeat for an imported TOP Streaming row.

- [ ] **Step 3: Manifest + library rows**

Curl the install config's `/manifest.json`; confirm it contains the enabled `myemby-<key>` rows plus one `extcat-N` per added addon catalog, and the addon rows' names/types are correct.

- [ ] **Step 4: Browser smoke**

Walk `#/catalogs` (importer + presets + library switches), `#/dashboard`, `#/servers`, `#/streaming`, `#/appearance` — zero console errors (favicon OK).

- [ ] **Step 5: Commit (if fixes were needed)**

```bash
git add -A
git commit -m "Verify addon-proxy catalogs and library rows end-to-end"
```

---

## Self-review notes

- **Spec coverage:** addon provider + mapAddonMetas (T1), importer endpoint (T2), manifest myemby-<key> + libraryRows + back-compat + route parsing (T3), Next Up fetch (T4), importer UI + presets + row persistence (T5), library multi-row UI + collect/restore (T6), e2e (T7). All spec sections mapped.
- **Schema safety:** only additive config fields (`libraryRows`, addon entry fields); legacy `catalogContent`/`myemby` preserved. Existing providers untouched.
- **Naming consistency:** `mapAddonMetas`, `fetchAddonCatalog`, `deriveLibraryRows`, `ROW_NAMES`, `buildLibraryCatalogs`, `getNextUp`, `browseAddonCatalogs`, `addImportedAddonCatalogs`, `libraryRows`, `myemby-<key>`, `libchk-<key>` used consistently across tasks.
- **Live-testability:** addon proxy + importer verified against the real public endpoints; Next Up's Emby path is the only part not exercisable here (noted in T4) — user tests post-deploy.
```
