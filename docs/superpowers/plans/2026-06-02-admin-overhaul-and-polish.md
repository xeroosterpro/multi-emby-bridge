# Advanced Admin Console + Watching Activity + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Admin → Users into a data-rich console (overview stats, sortable/filterable user table, per-user detail with watching/servers/billing), add per-user watching activity (recent + live), a Health "Top server of the day" banner, and center narrow pages.

**Architecture:** Pure helpers in `lib/adminStats.js` (request-log summaries) and `lib/sessions.js` (live now-playing) are TDD-unit-tested. `routes/admin.js` gains `/overview`, `/users/:id/activity`, and an enriched `/users`, fed the in-memory request log via a `getRequestLog` accessor passed from `server.js`. The stream handler tags request-log entries with `userId` (threaded through `/u/:token`). Frontend rebuilds `#page-users` (`admin.js` + HTML + CSS). Two small CSS/JS polish items (centering, top-server) are bundled.

**Tech Stack:** Node/Express, `pg`, vanilla JS frontend. Tests: `node test/*.test.js` with a SQL-matching fake DB (see `test/billing.test.js`).

**Spec:** `docs/superpowers/specs/2026-06-02-admin-overhaul-and-polish-design.md`

**Conventions:** `makeX(db)`-style factories; all DB via `db.query`; after each task run `npm test` + commit; deploy = `git push origin main` (only after a group is verified). All user-controlled strings HTML-escaped in the frontend.

---

## File Structure

- Create: `lib/adminStats.js` — pure: `summarizeRequestLog(log,opts)`, `userActivity(log,userId,opts)`.
- Create: `lib/sessions.js` — `makeLiveSessions(fetchImpl?)` → `forUser(servers)`.
- Create: `test/adminStats.test.js`, `test/sessions.test.js`.
- Modify: `server.js` — tag request log with `userId`; pass `getRequestLog` to admin router.
- Modify: `routes/admin.js` — accept `{ getRequestLog }`; add `/overview`, `/users/:id/activity`; enrich `/users`.
- Modify: `public/configure.html` — rebuild `#page-users` markup.
- Modify: `public/js/admin.js` — overview + table (sort/filter) + detail tabs.
- Modify: `public/js/health.js` — top-server banner.
- Modify: `public/css/configure.css` — admin console styles, top-server banner, page centering.
- Modify: `package.json` — register the 2 new tests.

---

## Task 1: Center narrow single-column pages (CSS)

**Files:** Modify `public/css/configure.css`

- [ ] **Step 1: Add centering rule**

Append to `public/css/configure.css`:

```css
/* Center narrow single-column page content so it isn't pinned to the left.
   Grid pages (dashboard tiles, dash-cards, server-grid, ak-grid) are unaffected
   because they already fill the page width. */
#page-appearance, #page-settings, #page-streaming, #page-catalogs { max-width: 860px; margin-inline: auto; }
```

- [ ] **Step 2: Verify syntax**

Run: `node -e "const c=require('fs').readFileSync('public/css/configure.css','utf8'); if(!c.includes('margin-inline: auto')) process.exit(1); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add public/css/configure.css
git commit -m "style(ui): center narrow single-column page content"
```

---

## Task 2: Top server of the day (Health page)

**Files:** Modify `public/js/health.js`, `public/css/configure.css`

- [ ] **Step 1: Add the compute + render helper in health.js**

In `public/js/health.js`, add this function near the top (after `rangeMs`):

```js
// Best server over the last 24h: rank by uptime% desc, then avg response ms asc.
function renderTopServer(data){
  const main=document.getElementById('main-content'); if(!main||!Array.isArray(data)) return;
  const cutoff=Date.now()-86400000;
  const ranked=data.map(s=>{
    const h=(s.history||[]).filter(e=>e.ts>=cutoff);
    const total=h.length, up=h.filter(e=>e.up).length;
    const ups=h.filter(e=>e.up&&e.ms!=null);
    const avg=ups.length?Math.round(ups.reduce((a,e)=>a+e.ms,0)/ups.length):null;
    const label=(s.history&&s.history[0]&&s.history[0].label)||(s.url||'').replace(/^https?:\/\//,'');
    return {label, total, pct: total?Math.round(up/total*1000)/10:null, avg};
  }).filter(s=>s.total>0);
  if(!ranked.length){ const ex=document.getElementById('top-server'); if(ex) ex.remove(); return; }
  ranked.sort((a,b)=> (b.pct-a.pct) || ((a.avg??1e9)-(b.avg??1e9)));
  const t=ranked[0];
  const html=`<div id="top-server" class="top-server"><span class="ts-trophy">\u{1F3C6}</span>
    <span class="ts-text"><strong>Top server (24h)</strong> — <span class="ts-name">${esc(t.label)}</span>
    <span class="ts-stat">${t.pct!=null?t.pct+'% uptime':''}${t.avg!=null?' · '+t.avg+'ms avg':''}</span></span></div>`;
  const ex=document.getElementById('top-server'); if(ex) ex.remove();
  main.insertAdjacentHTML('afterbegin', html);
}
```

- [ ] **Step 2: Call it from renderPage**

In `public/js/health.js`, inside `renderPage(data)`, immediately after the line that sets `main.innerHTML = sb + '<div class="server-grid">'+...+'</div>';`, add:

```js
  renderTopServer(data);
```

(It prepends the banner above the status bar each render; the function removes any prior `#top-server` first to avoid duplicates.)

- [ ] **Step 3: Add CSS**

Append to `public/css/configure.css`:

```css
.top-server{ display:flex; align-items:center; gap:12px; margin:0 0 16px; padding:13px 18px; border-radius:var(--r-lg);
  background:linear-gradient(120deg, color-mix(in srgb,var(--accent) 16%,var(--bg-surface)), var(--bg-surface));
  border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); box-shadow:0 0 22px var(--glow); }
.top-server .ts-trophy{ font-size:1.4rem; }
.top-server .ts-name{ color:var(--accent); font-weight:800; }
.top-server .ts-stat{ color:var(--text-dim); margin-left:8px; font-size:.85rem; }
```

- [ ] **Step 4: Verify syntax**

Run: `node --check public/js/health.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add public/js/health.js public/css/configure.css
git commit -m "feat(health): top server of the day banner (24h, uptime then speed)"
```

---

## Task 3: Tag request-log entries with userId

**Files:** Modify `server.js`

- [ ] **Step 1: Set the user id on the request in the /u/:token middleware**

In `server.js`, in the `app.use('/u/:token', ...)` handler, immediately BEFORE the line `const rest = req.url === '/' ? '/manifest.json' : req.url;`, add:

```js
    req._mebUserId = rec.user_id;
```

- [ ] **Step 2: Include userId in the stream-handler log entry**

In `server.js`, in the `addLogEntry({ ... })` call inside the stream handler (the object with `ts, type, imdbId, ...`), add a `userId` field as the first property:

```js
    addLogEntry({
      userId:       req._mebUserId || null,
      ts:           new Date().toISOString(),
      type,
      imdbId,
```

(Leave the remaining fields — `season, episode, contentName, bestServer, serverStatus, found, ms` — unchanged.)

- [ ] **Step 3: Verify the server loads**

Run: `node -e "require('./server.js'); setTimeout(()=>{console.log('ok');process.exit(0)},300)"`
Expected: prints `ok` (plus the normal boot logs).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(log): tag request-log entries with userId via the /u/:token path"
```

---

## Task 4: `lib/adminStats.js` — request-log summaries (TDD)

**Files:** Create `lib/adminStats.js`, `test/adminStats.test.js`; Modify `package.json`

- [ ] **Step 1: Write the failing test**

Create `test/adminStats.test.js`:

```js
// Run with: node test/adminStats.test.js
const { summarizeRequestLog, userActivity } = require('../lib/adminStats');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const NOW = 1_000_000_000_000;
const ago = ms => new Date(NOW - ms).toISOString();
const log = [
  { userId: 'u1', ts: ago(1000),       contentName: 'Dune',   bestServer: 'ARCTV',  type: 'movie', ms: 300, found: true },
  { userId: 'u1', ts: ago(2*86400000), contentName: 'Dune',   bestServer: 'ARCTV',  type: 'movie', ms: 320, found: true },
  { userId: 'u2', ts: ago(5000),       contentName: 'Heat',   bestServer: 'EAGLE',  type: 'movie', ms: 500, found: true },
  { userId: null, ts: ago(8*86400000), contentName: 'Old',    bestServer: 'BK',     type: 'movie', ms: 100, found: false },
];

(async () => {
  const s = summarizeRequestLog(log, { now: NOW });
  A(s.requests24h === 2, '24h count excludes the 2-day and 8-day old entries');
  A(s.requests7d === 3, '7d count includes the 2-day old, excludes the 8-day old');
  A(s.topTitles[0].title === 'Dune' && s.topTitles[0].count === 1, 'top title (24h) is Dune x1');
  A(s.busiestServer && s.busiestServer.server === 'ARCTV', 'busiest server (24h) is ARCTV');

  const a = userActivity(log, 'u1', { now: NOW });
  A(a.recent.length === 2, 'userActivity returns only u1 entries');
  A(a.recent[0].title === 'Dune' && a.recent[0].server === 'ARCTV', 'recent maps title+server');
  A(a.totals.requests24h === 1 && a.totals.requests7d === 2, 'per-user 24h/7d totals correct');
  A(a.totals.lastActive === log[0].ts, 'lastActive is the newest u1 entry ts');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Run it, confirm FAIL** — `node test/adminStats.test.js` → `Cannot find module '../lib/adminStats'`.

- [ ] **Step 3: Implement**

Create `lib/adminStats.js`:

```js
// ─── Pure summaries over the in-memory request log ─────────────────────────
const DAY = 86400000, WEEK = 7 * DAY;
const within = (ts, ms, now) => (now - new Date(ts).getTime()) <= ms;

function summarizeRequestLog(log, opts = {}) {
  const now = opts.now || Date.now();
  const arr = Array.isArray(log) ? log : [];
  const last24 = arr.filter(e => within(e.ts, DAY, now));
  const titleCounts = {}, serverCounts = {};
  for (const e of last24) {
    if (e.contentName) titleCounts[e.contentName] = (titleCounts[e.contentName] || 0) + 1;
    if (e.bestServer) serverCounts[e.bestServer] = (serverCounts[e.bestServer] || 0) + 1;
  }
  const topTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([title, count]) => ({ title, count }));
  const busiest = Object.entries(serverCounts).sort((a, b) => b[1] - a[1])[0];
  return {
    requests24h: last24.length,
    requests7d: arr.filter(e => within(e.ts, WEEK, now)).length,
    topTitles,
    busiestServer: busiest ? { server: busiest[0], count: busiest[1] } : null,
  };
}

function userActivity(log, userId, opts = {}) {
  const now = opts.now || Date.now();
  const mine = (Array.isArray(log) ? log : []).filter(e => e.userId === userId);
  return {
    recent: mine.slice(0, 50).map(e => ({
      ts: e.ts, title: e.contentName || null, type: e.type || null,
      season: e.season || null, episode: e.episode || null,
      server: e.bestServer || null, ms: e.ms ?? null, found: !!e.found,
    })),
    totals: {
      requests24h: mine.filter(e => within(e.ts, DAY, now)).length,
      requests7d: mine.filter(e => within(e.ts, WEEK, now)).length,
      lastActive: mine[0] ? mine[0].ts : null,
    },
  };
}

module.exports = { summarizeRequestLog, userActivity };
```

- [ ] **Step 4: Run it, confirm PASS** — `node test/adminStats.test.js` → `8 tests: 8 passed, 0 failed`.

- [ ] **Step 5: Register test** — in `package.json` `scripts.test`, append ` && node test/adminStats.test.js`.

- [ ] **Step 6: Commit**

```bash
git add lib/adminStats.js test/adminStats.test.js package.json
git commit -m "feat(admin): request-log summaries (lib/adminStats.js)"
```

---

## Task 5: `lib/sessions.js` — live now-playing (TDD)

**Files:** Create `lib/sessions.js`, `test/sessions.test.js`; Modify `package.json`

- [ ] **Step 1: Write the failing test**

Create `test/sessions.test.js`:

```js
// Run with: node test/sessions.test.js
const { makeLiveSessions } = require('../lib/sessions');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

// fake fetch: server A returns one playing + one idle session; server B throws; server C returns non-ok
function fakeFetch(url) {
  if (url.includes('//a')) return Promise.resolve({ ok: true, json: async () => ([
    { NowPlayingItem: { Name: 'Dune', Type: 'Movie' }, UserName: 'alice', Client: 'Stremio' },
    { UserName: 'bob' }, // idle, no NowPlayingItem
  ]) });
  if (url.includes('//b')) return Promise.reject(new Error('unreachable'));
  return Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
}

(async () => {
  const ls = makeLiveSessions(fakeFetch);
  const out = await ls.forUser([
    { url: 'http://a', apiKey: 'k', label: 'ARCTV', type: 'emby' },
    { url: 'http://b', apiKey: 'k', label: 'EAGLE', type: 'emby' },
    { url: 'http://c', apiKey: 'k', label: 'BK',    type: 'jellyfin' },
    { url: '',         apiKey: 'k', label: 'NoURL' }, // skipped
  ]);
  A(out.length === 1, 'only the one actively-playing session is returned');
  A(out[0].title === 'Dune' && out[0].server === 'ARCTV', 'maps title + server label');
  A(out[0].user === 'alice' && out[0].client === 'Stremio', 'maps user + client');
  A((await ls.forUser([])).length === 0, 'empty server list → no sessions');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Run it, confirm FAIL** — `node test/sessions.test.js` → module not found.

- [ ] **Step 3: Implement**

Create `lib/sessions.js`:

```js
// ─── Live now-playing across a user's servers (best-effort) ─────────────────
// makeLiveSessions(fetchImpl?) → forUser(servers): queries each server's
// /Sessions API (Emby/Jellyfin compatible). Any server that errors, times out,
// or denies access simply contributes nothing. Never throws.
const _fetch = require('node-fetch');

function makeLiveSessions(fetchImpl) {
  const fetch = fetchImpl || _fetch;
  return {
    async forUser(servers) {
      const out = [];
      await Promise.all((servers || []).map(async (s) => {
        if (!s || !s.url || !s.apiKey) return;
        const base = s.url.replace(/\/+$/, '');
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4000);
          let r;
          try {
            r = await fetch(`${base}/Sessions?api_key=${encodeURIComponent(s.apiKey)}`, { signal: ctrl.signal });
          } finally { clearTimeout(timer); }
          if (!r || !r.ok) return;
          const sessions = await r.json();
          for (const sess of (Array.isArray(sessions) ? sessions : [])) {
            const np = sess && sess.NowPlayingItem;
            if (!np) continue;
            out.push({
              server: s.label || s.url,
              serverType: s.type || 'emby',
              title: np.Name || 'Unknown',
              itemType: np.Type || null,
              user: sess.UserName || null,
              client: sess.Client || null,
            });
          }
        } catch { /* unreachable / no permission / timeout — skip */ }
      }));
      return out;
    },
  };
}

module.exports = { makeLiveSessions };
```

- [ ] **Step 4: Run it, confirm PASS** — `node test/sessions.test.js` → `4 tests: 4 passed, 0 failed`.

- [ ] **Step 5: Register test** — in `package.json` `scripts.test`, append ` && node test/sessions.test.js`.

- [ ] **Step 6: Commit**

```bash
git add lib/sessions.js test/sessions.test.js package.json
git commit -m "feat(admin): live now-playing across a user's servers (lib/sessions.js)"
```

---

## Task 6: Admin endpoints — overview, activity, enriched users

**Files:** Modify `routes/admin.js`, `server.js`

- [ ] **Step 1: Wire new deps + accept getRequestLog (routes/admin.js)**

At the top of `routes/admin.js` (with the other requires) add:

```js
const { makeUserConfig } = require('../lib/userConfig');
const { makeLiveSessions } = require('../lib/sessions');
const { summarizeRequestLog, userActivity } = require('../lib/adminStats');
```

Change the factory signature `function makeAdminRouter() {` to:

```js
function makeAdminRouter(opts = {}) {
  const getRequestLog = typeof opts.getRequestLog === 'function' ? opts.getRequestLog : () => [];
  const userConfig = makeUserConfig(db);
  const liveSessions = makeLiveSessions();
```

(Keep the existing `const users`, `const payments`, etc. below it.)

- [ ] **Step 2: Enrich GET /users (routes/admin.js)**

Replace the existing `r.get('/users', ...)` handler's SQL + response with:

```js
  r.get('/users', requireAdmin, async (req, res) => {
    try {
      const q = await db.query(
        `SELECT u.id, u.username, u.role, u.created_at, u.last_seen_at,
                COALESCE(s.status,'none') AS sub_status, s.current_period_end AS period_end,
                COALESCE(jsonb_array_length(uc.config_json->'servers'),0) AS server_count
           FROM users u
           LEFT JOIN subscriptions s ON s.user_id = u.id
           LEFT JOIN user_config uc ON uc.user_id = u.id
          ORDER BY u.created_at ASC`);
      res.json({ users: q.rows });
    } catch (e) { console.error('[admin/users:get]', e.message); res.status(500).json({ error: 'load failed' }); }
  });
```

- [ ] **Step 3: Add GET /overview (routes/admin.js)**

Add inside the factory (before `return r;`):

```js
  r.get('/overview', requireAdmin, async (req, res) => {
    try {
      const u = await db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.role='admin')::int AS admins,
                COUNT(*) FILTER (WHERE s.status IN ('active','comped'))::int AS active,
                COUNT(*) FILTER (WHERE s.status='comped')::int AS comped,
                COUNT(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS new_this_week
           FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id`);
      const rev = await db.query(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE paid_at > now() - interval '30 days'),0) AS monthly,
                COALESCE(SUM(amount),0) AS lifetime FROM payments`);
      const pays = await db.query(
        `SELECT p.amount, p.currency, p.status, p.paid_at, us.username
           FROM payments p LEFT JOIN users us ON us.id=p.user_id
          ORDER BY p.paid_at DESC LIMIT 10`);
      const activity = summarizeRequestLog(getRequestLog());
      res.json({
        users: u.rows[0],
        revenue: { monthly: Number(rev.rows[0].monthly), lifetime: Number(rev.rows[0].lifetime), currency: 'USD' },
        recentPayments: pays.rows,
        activity,
      });
    } catch (e) { console.error('[admin/overview]', e.message); res.status(500).json({ error: 'overview failed' }); }
  });
```

- [ ] **Step 4: Add GET /users/:id/activity (routes/admin.js)**

Add inside the factory (before `return r;`):

```js
  r.get('/users/:id/activity', requireAdmin, async (req, res) => {
    try {
      const act = userActivity(getRequestLog(), req.params.id);
      let live = [];
      try {
        const cfg = await userConfig.getForServe(req.params.id);
        if (cfg && Array.isArray(cfg.servers)) live = await liveSessions.forUser(cfg.servers);
      } catch (e) { console.error('[admin/activity:live]', e.message); }
      res.json({ recent: act.recent, totals: act.totals, live });
    } catch (e) { console.error('[admin/activity]', e.message); res.status(500).json({ error: 'activity failed' }); }
  });
```

- [ ] **Step 5: Pass the request log accessor at mount (server.js)**

In `server.js`, find `app.use('/api/admin', makeAdminRouter());` and replace with:

```js
app.use('/api/admin', makeAdminRouter({ getRequestLog: () => REQUEST_LOG }));
```

- [ ] **Step 6: Verify load + suite**

Run: `node -e "require('./routes/admin.js'); require('./lib/sessions.js'); require('./lib/adminStats.js'); console.log('loads ok')"` → `loads ok`.
Run: `npm test` → all green (incl. adminStats + sessions).

- [ ] **Step 7: Commit**

```bash
git add routes/admin.js server.js
git commit -m "feat(admin): /overview, /users/:id/activity, enriched /users"
```

---

## Task 7: Admin page markup rebuild (HTML)

**Files:** Modify `public/configure.html`

- [ ] **Step 1: Replace the #page-users body**

In `public/configure.html`, replace the entire contents of `<section class="page" id="page-users"> ... </section>` with:

```html
      <section class="page" id="page-users">
        <h2 class="page-title">Admin · Console</h2>
        <p class="page-sub">Users, activity, servers &amp; billing.</p>

        <div class="adm-overview" id="adm-overview"></div>

        <div class="adm-bar">
          <input class="input adm-search" id="adm-search" placeholder="Search users…" autocomplete="off" />
          <select class="input adm-filter" id="adm-filter">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="comped">Comped</option>
            <option value="none">No subscription</option>
            <option value="cancelled">Cancelled</option>
            <option value="past_due">Past due</option>
          </select>
          <select class="input adm-sort" id="adm-sort">
            <option value="activity">Sort: recent activity</option>
            <option value="name">Sort: name</option>
            <option value="status">Sort: status</option>
            <option value="newest">Sort: newest</option>
          </select>
        </div>

        <div class="adm-table-wrap"><table class="adm-table">
          <thead><tr><th>User</th><th>Status</th><th>Last active</th><th>Servers</th><th></th></tr></thead>
          <tbody id="adm-users-rows"></tbody>
        </table></div>

        <details class="adm-section"><summary>Add user</summary>
          <div class="adm-section-body" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div style="flex:1;min-width:140px"><div class="field-label">Username</div><input class="input" id="nu-name" placeholder="username" autocomplete="off"/></div>
            <div style="flex:1;min-width:140px"><div class="field-label">Password</div><input class="input" id="nu-pass" type="password" placeholder="temp password" autocomplete="new-password"/></div>
            <div><div class="field-label">Role</div><select class="input" id="nu-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
            <button class="btn-soft" id="nu-create" type="button">Add</button>
            <div class="auth-err" id="nu-msg"></div>
          </div>
        </details>

        <details class="adm-section"><summary>Discount codes</summary>
          <div class="adm-section-body">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
              <div style="flex:1;min-width:160px"><div class="field-label">Code</div><input class="input" id="dc-code" placeholder="e.g. FAMILY100" autocomplete="off"/></div>
              <div><div class="field-label">Type</div>
                <select class="input" id="dc-type"><option value="comp_100">100% off (comp)</option><option value="percent_50">50% off</option><option value="first_month_free">First month free</option></select></div>
              <button class="btn-soft" id="dc-create" type="button">Create</button>
            </div>
            <div id="admin-codes-list"></div>
          </div>
        </details>
      </section>
```

(Note: this keeps the existing element IDs `nu-name/nu-pass/nu-role/nu-create/nu-msg`, `dc-code/dc-type/dc-create`, `admin-codes-list` that `admin.js` already wires. The old `#admin-users-list` is replaced by the table body `#adm-users-rows` — Task 8 updates `admin.js` to render into it.)

- [ ] **Step 2: Verify the IDs the existing JS needs still exist**

Run: `grep -c "nu-create\|dc-create\|admin-codes-list" public/configure.html`
Expected: `>= 3`.

- [ ] **Step 3: Commit**

```bash
git add public/configure.html
git commit -m "feat(admin): rebuild #page-users markup (overview, table, sections)"
```

---

## Task 8: Admin frontend logic (admin.js)

**Files:** Modify `public/js/admin.js`, `public/css/configure.css`

- [ ] **Step 1: Replace loadUsers with overview + table render**

In `public/js/admin.js`, replace the existing `async function loadUsers() { ... }` with:

```js
  let _adminUsers = [];
  const escU = x => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtDate = x => x ? new Date(x).toLocaleDateString() : '—';
  const fmtAgo = x => { if(!x) return 'never'; const d=Date.now()-new Date(x).getTime(); const h=Math.floor(d/3600000); if(h<1) return 'just now'; if(h<24) return h+'h ago'; return Math.floor(h/24)+'d ago'; };
  const statusPill = s => `<span class="pay-status ${s==='active'||s==='comped'?'completed':(s==='past_due'?'refunded':'failed')}">${escU(s)}</span>`;

  async function loadOverview() {
    const wrap = $('#adm-overview'); if (!wrap) return;
    const r = await api('/api/admin/overview');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = ''; return; }
    const o = r.body, money = n => '$' + Number(n||0).toFixed(0);
    wrap.innerHTML = `
      <div class="adm-card"><div class="adm-card-n">${o.users.total}</div><div class="adm-card-l">Users · ${o.users.active} active · ${o.users.comped} comped</div></div>
      <div class="adm-card"><div class="adm-card-n">${money(o.revenue.monthly)}</div><div class="adm-card-l">Revenue (30d) · ${money(o.revenue.lifetime)} lifetime</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.activity.requests24h}</div><div class="adm-card-l">Stream requests (24h)</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.activity.busiestServer?escU(o.activity.busiestServer.server):'—'}</div><div class="adm-card-l">Busiest server (24h)</div></div>`;
  }

  function renderUsersTable() {
    const tbody = $('#adm-users-rows'); if (!tbody) return;
    const term = ($('#adm-search')?.value || '').toLowerCase();
    const filter = $('#adm-filter')?.value || 'all';
    const sort = $('#adm-sort')?.value || 'activity';
    let rows = _adminUsers.filter(u => (!term || u.username.toLowerCase().includes(term)) && (filter === 'all' || u.sub_status === filter));
    const ts = x => x ? new Date(x).getTime() : 0;
    rows.sort((a,b) =>
      sort === 'name' ? a.username.localeCompare(b.username) :
      sort === 'status' ? String(a.sub_status).localeCompare(String(b.sub_status)) :
      sort === 'newest' ? ts(b.created_at) - ts(a.created_at) :
      ts(b.last_seen_at) - ts(a.last_seen_at));
    tbody.innerHTML = rows.map(u => `<tr data-uid="${u.id}">
      <td><div class="adm-user"><span class="adm-avatar">${escU((u.username||'?')[0].toUpperCase())}</span><span><strong>${escU(u.username)}</strong><span class="adm-role">${escU(u.role)}</span></span></div></td>
      <td>${statusPill(u.sub_status)}</td>
      <td class="adm-dim">${fmtAgo(u.last_seen_at)}</td>
      <td class="adm-dim">${u.server_count||0}</td>
      <td><button class="btn-soft acct-manage" data-uid="${u.id}">Manage</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="log-empty">No users match.</td></tr>';
  }

  async function loadUsers() {
    loadOverview();
    const r = await api('/api/admin/users');
    if (r.status !== 200 || !r.body) { const t=$('#adm-users-rows'); if(t) t.innerHTML='<tr><td colspan="5">Unable to load users.</td></tr>'; return; }
    _adminUsers = r.body.users || [];
    renderUsersTable();
    ['adm-search','adm-filter','adm-sort'].forEach(id => { const el=document.getElementById(id); if(el&&!el._w){ el._w=1; el.addEventListener('input', renderUsersTable); el.addEventListener('change', renderUsersTable); } });
  }
```

(`$`, `api`, and the `.acct-manage` delegated click handler already exist in `admin.js` and are reused. The discount-codes wiring `loadCodes`/`wireCodeCreate`/`wireAddUser` is unchanged and still targets the same IDs.)

- [ ] **Step 2: Expand the manage modal with Activity + Account tabs**

In `public/js/admin.js`, in `openUserManageModal(id, d)`, after the line that builds `servers` (the `const servers = ...` for the Servers tab), add an Activity fetch + tab. Replace the `window.openModal(` call's tab bar and body to include Activity and Account tabs. Specifically, change the `.modal-tabs` line to:

```js
      <div class="modal-tabs"><button class="on" data-mt="act">Activity</button><button data-mt="srv">Servers</button><button data-mt="sub">Subscription</button><button data-mt="pay">Payments</button><button data-mt="acct">Account</button></div>
```

and change the `.modal-body` to start with an Activity tab and end with an Account tab:

```js
      <div class="modal-body">
        <div class="mtab on" id="mt-act"><div class="field-hint">Loading activity…</div></div>
        <div class="mtab" id="mt-srv">${servers}</div>
        <div class="mtab" id="mt-sub">
          <div class="field"><div class="field-label">Status</div>
            <select class="input" id="adm-status"><option>none</option><option>active</option><option>cancelled</option><option>past_due</option><option>comped</option></select></div>
          <div class="field"><div class="field-label">Access until (period end)</div><input class="input" id="adm-period" type="datetime-local" /></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-generate" id="adm-save" style="flex:1">Save override</button>
            <button class="btn-soft" id="adm-resync">Re-sync from PayPal</button></div>
          <div class="auth-err" id="adm-msg"></div>
        </div>
        <div class="mtab" id="mt-pay">${pays}</div>
        <div class="mtab" id="mt-acct">
          <div class="mrow">Username<span class="mtag">${esc(d.username || (d.subscription && d.subscription.username) || '—')}</span></div>
          <h3 class="block-title" style="margin-top:14px">Reset password</h3>
          <div style="display:flex;gap:8px"><input class="input" id="adm-pass" type="text" placeholder="new password (min 6)"/><button class="btn-soft" id="adm-pass-btn">Set</button></div>
        </div>
      </div>`);
```

(Keep the existing `esc`, `money`, `date`, `pays`, `evs`, `servers` consts and the existing `adm-save`/`adm-resync`/`adm-pass-btn` wiring below `window.openModal(...)` exactly as they are.)

- [ ] **Step 3: Fetch + render activity into the Activity tab**

In `public/js/admin.js`, at the END of `openUserManageModal(id, d)` (after the existing button wiring), add:

```js
    (async () => {
      const r = await api('/api/admin/users/' + id + '/activity');
      const el = document.getElementById('mt-act'); if (!el) return;
      if (r.status !== 200 || !r.body) { el.innerHTML = '<div class="field-hint">Activity unavailable.</div>'; return; }
      const a = r.body, esc2 = esc;
      const live = (a.live || []).map(s => `<div class="mrow"><span>▶ ${esc2(s.title)} <span class="adm-dim">on ${esc2(s.server)}</span></span><span class="mtag">${esc2(s.user||'')}</span></div>`).join('');
      const recent = (a.recent || []).map(e => `<div class="mrow"><span>${esc2(e.title||'—')}${e.season?` S${e.season}E${e.episode||''}`:''} <span class="adm-dim">· ${esc2(e.server||'—')}</span></span><span class="mtag">${date(e.ts)}</span></div>`).join('') || '<div class="field-hint">No recent activity.</div>';
      el.innerHTML = `<div class="mrow">Totals<span class="mtag">${a.totals.requests24h} (24h) · ${a.totals.requests7d} (7d)</span></div>
        ${live ? `<h3 class="block-title" style="margin-top:12px;color:var(--accent)">● Now playing</h3>${live}` : ''}
        <h3 class="block-title" style="margin-top:12px">Recent watches</h3>${recent}`;
    })();
```

- [ ] **Step 4: Add CSS for the console**

Append to `public/css/configure.css`:

```css
.adm-overview{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:13px; margin-bottom:18px; }
.adm-card{ background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--r-lg); padding:16px 18px; }
.adm-card-n{ font-size:1.4rem; font-weight:800; background:linear-gradient(135deg,var(--accent),var(--accent-2)); -webkit-background-clip:text; background-clip:text; color:transparent; }
.adm-card-l{ font-size:.66rem; color:var(--text-dim); text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }
.adm-bar{ display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
.adm-bar .adm-search{ flex:1; min-width:180px; }
.adm-bar .adm-filter, .adm-bar .adm-sort{ width:auto; min-width:150px; }
.adm-table-wrap{ background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--r-lg); overflow:hidden; }
.adm-table{ width:100%; border-collapse:collapse; font-size:.84rem; }
.adm-table th{ text-align:left; padding:11px 14px; font-size:.64rem; text-transform:uppercase; letter-spacing:.06em; color:var(--text-mute); border-bottom:1px solid var(--border); }
.adm-table td{ padding:11px 14px; border-bottom:1px solid var(--border); }
.adm-table tr:last-child td{ border-bottom:0; }
.adm-table tbody tr{ transition:background .15s var(--ease); }
.adm-table tbody tr:hover{ background:var(--bg-hover); }
.adm-user{ display:flex; align-items:center; gap:10px; }
.adm-avatar{ width:30px; height:30px; border-radius:50%; flex:none; display:grid; place-items:center; font-weight:800; font-size:.8rem; color:#0a0a12; background:linear-gradient(135deg,var(--accent),var(--accent-2)); }
.adm-role{ display:block; font-size:.66rem; color:var(--text-mute); text-transform:uppercase; letter-spacing:.04em; }
.adm-dim{ color:var(--text-dim); }
.adm-section{ margin-top:16px; background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--r-lg); padding:4px 16px; }
.adm-section summary{ cursor:pointer; padding:12px 0; font-weight:700; font-size:.85rem; }
.adm-section-body{ padding:0 0 14px; }
```

- [ ] **Step 5: Verify syntax + suite**

Run: `node --check public/js/admin.js` → no output.
Run: `npm test` → all green.

- [ ] **Step 6: Commit**

```bash
git add public/js/admin.js public/css/configure.css
git commit -m "feat(admin): console UI — overview, sortable/filterable table, activity tab"
```

---

## Task 9: Full verification + deploy

- [ ] **Step 1: Run the suite** — `npm test` → all files pass (incl. adminStats, sessions).

- [ ] **Step 2: Deploy** — `git push origin main`; wait for Railway, confirm no boot errors.

- [ ] **Step 3: Live smoke (as admin Eli)**
- Sidebar pin no longer overlaps "Emby Bridge"; inputs are dark with hover/focus glow.
- Appearance page content is centered.
- Health page shows a "🏆 Top server (24h)" banner.
- Admin → Console: overview cards populated; user table renders; search/filter/sort work; Manage opens the modal; Activity tab shows totals + recent (live shows when a server reports a session, else "No recent activity"); Subscription override/resync, Payments, and password reset work.

- [ ] **Step 4: Commit any fixes + push**

```bash
git add -A && git commit -m "chore: admin console verification fixes" && git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** centering (T1) ✓; top server of day (T2) ✓; request-log user tagging (T3) ✓; request-log summaries (T4) ✓; live sessions (T5) ✓; /overview + /users/:id/activity + enriched /users (T6) ✓; admin markup (T7) ✓; admin console UI incl. Activity/Servers/Subscription/Payments/Account tabs + sort/filter/search + overview cards (T8) ✓; graceful degradation + escaping (T5,T6,T8) ✓; requireAdmin on new routes (T6) ✓.
- **Type consistency:** `summarizeRequestLog`/`userActivity` shapes used identically in adminStats test, /overview, /activity, and admin.js render. `makeLiveSessions().forUser(servers)` returns `{server,title,user,client,...}` consumed in the Activity tab. `getRequestLog` accessor name matches between server.js mount and routes/admin.js. Enriched `/users` fields (`sub_status,last_seen_at,created_at,server_count,period_end`) match `renderUsersTable`/`loadUsers`.
- **Assumptions to verify during execution:** exact location of the `addLogEntry({...})` object and the `/u/:token` `const rest =` line (Task 3); the existing `openUserManageModal` const names (`esc`,`money`,`date`,`pays`,`evs`,`servers`) and that `d.username` may be undefined (Account tab falls back to '—'); the `app.use('/api/admin', makeAdminRouter())` mount line (Task 6 Step 5).
