# Phase 2 — Postgres + Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a Postgres data layer and real user accounts (register / login / sessions), with a server-backed login screen, seeded admin, and session middleware — without breaking the existing addon when no database is configured.

**Architecture:** A lazy `lib/db.js` pool (from `DATABASE_URL`, SSL for Railway) that no-ops when unset, so local/test runs work DB-free. SQL migrations applied on boot. `lib/users.js` + `lib/sessions.js` take an **injectable query function** so they're unit-tested with a fake DB (suite stays green without Postgres). Auth via httpOnly/Secure/SameSite session cookies. Builds on the already-tested `lib/accounts.js` (scrypt + tokens).

**Tech stack:** Node + Express, `pg` (new dep), vanilla JS frontend. Tests: `node test/*.test.js`.

**Prerequisites (user-provided, Railway dashboard):**
- `DATABASE_URL` — auto-set by adding the Railway Postgres plugin.
- `CONFIG_ENC_KEY`, `SESSION_SECRET` — service variables (already generated).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — optional seed admin (defaults: `Eli` / a value the user sets; if `ADMIN_PASSWORD` unset, no admin is seeded and a warning is logged).

**Out of scope:** encrypted API-key storage + per-user manifest tokens (Phase 3), admin panel UI (Phase 4), billing (Phase 5). This plan only establishes accounts/auth.

---

## Pre-flight

- [ ] **Step 0a: Branch + green baseline**

Run: `git checkout -b phase2/accounts-db && npm test 2>&1 | tail -2`
Expected: branch created; `111 tests` (or current count) all passing.

- [ ] **Step 0b: Add the pg dependency**

Run: `npm install pg`
Expected: `pg` added to `dependencies` in `package.json`; `package-lock.json` updated.

---

## Task 1: Lazy DB pool (`lib/db.js`)

**Files:** Create `lib/db.js`; Test `test/db.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/db.test.js — run: node test/db.test.js
const { isConfigured } = require('../lib/db');
let passed = 0, failed = 0;
function assert(c, m){ if(c){console.log(`  ✓ ${m}`);passed++;} else {console.error(`  ✗ ${m}`);failed++;} }
const saved = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
assert(isConfigured() === false, 'isConfigured false when DATABASE_URL unset');
process.env.DATABASE_URL = 'postgres://x';
delete require.cache[require.resolve('../lib/db')];
assert(require('../lib/db').isConfigured() === true, 'isConfigured true when DATABASE_URL set');
if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
console.log(`\n${passed+failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../lib/db'`)

Run: `node test/db.test.js`

- [ ] **Step 3: Implement `lib/db.js`**

```javascript
// ─── Postgres pool (lazy; no-ops without DATABASE_URL) ──────────────────────
let Pool;
try { ({ Pool } = require('pg')); } catch { Pool = null; }

let _pool = null;
function isConfigured() { return !!process.env.DATABASE_URL; }

function getPool() {
  if (!isConfigured()) throw new Error('DATABASE_URL not set');
  if (!Pool) throw new Error('pg not installed');
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Railway managed PG
      max: 5,
    });
  }
  return _pool;
}

async function query(text, params) {
  const res = await getPool().query(text, params);
  return res;
}

module.exports = { isConfigured, getPool, query };
```

- [ ] **Step 4: Run test — expect PASS.** `node test/db.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/db.js test/db.test.js package.json package-lock.json
git commit -m "feat(db): lazy Postgres pool that no-ops without DATABASE_URL"
```

---

## Task 2: Schema migration + runner

**Files:** Create `migrations/001_init.sql`, `lib/migrate.js`

- [ ] **Step 1: Write `migrations/001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  last_ip      TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

(`gen_random_uuid()` is built in on PG 13+; Railway PG includes it.)

- [ ] **Step 2: Implement `lib/migrate.js`**

```javascript
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  if (!db.isConfigured()) { console.warn('[migrate] DATABASE_URL not set — skipping'); return; }
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [f]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
    console.log(`[migrate] applied ${f}`);
  }
}
module.exports = { runMigrations };
```

- [ ] **Step 3: Wire into server boot** — in `server.js`, near the `app.listen` call:

```javascript
const { runMigrations } = require('./lib/migrate');
runMigrations().catch(e => console.error('[migrate] failed:', e.message));
```

- [ ] **Step 4: Verify boot is safe without DB.** Run: `node -e "require('./lib/migrate').runMigrations().then(()=>console.log('ok'))"`
Expected: prints `[migrate] DATABASE_URL not set — skipping` then `ok` (no crash).

- [ ] **Step 5: Commit**

```bash
git add migrations/001_init.sql lib/migrate.js server.js
git commit -m "feat(db): schema migration (users, sessions) + boot-time runner"
```

---

## Task 3: User repository (`lib/users.js`) — injectable query, fake-DB tests

**Files:** Create `lib/users.js`, `test/users.test.js`

- [ ] **Step 1: Write the failing test (fake db)**

```javascript
// test/users.test.js — run: node test/users.test.js
const { makeUsers } = require('../lib/users');
let passed=0,failed=0; const A=(c,m)=>{c?(console.log(`  ✓ ${m}`),passed++):(console.error(`  ✗ ${m}`),failed++);};

// fake db: a tiny in-memory table honoring the SQL shapes users.js uses
function fakeDb(){ const rows=[]; return { async query(text, params){
  if(/INSERT INTO users/i.test(text)){ const [u,h,r]=params; if(rows.find(x=>x.username===u)){const e=new Error('dup');e.code='23505';throw e;} const row={id:'id'+(rows.length+1),username:u,password_hash:h,role:r,created_at:new Date()}; rows.push(row); return {rows:[row],rowCount:1}; }
  if(/SELECT .* FROM users WHERE username/i.test(text)){ const r=rows.find(x=>x.username===params[0]); return {rows:r?[r]:[],rowCount:r?1:0}; }
  if(/UPDATE users SET last_seen/i.test(text)){ return {rows:[],rowCount:1}; }
  return {rows:[],rowCount:0};
} }; }

(async()=>{
  const users=makeUsers(fakeDb());
  const u=await users.create('alice','scrypt$hash','user');
  A(u.username==='alice','create returns user');
  const found=await users.findByUsername('alice');
  A(found && found.id===u.id,'findByUsername resolves');
  A(await users.findByUsername('nobody')===null,'unknown user → null');
  let dup=false; try{ await users.create('alice','h','user'); }catch{ dup=true; } A(dup,'duplicate username rejected');
  console.log(`\n${passed+failed} tests: ${passed} passed, ${failed} failed`); if(failed)process.exit(1);
})();
```

- [ ] **Step 2: Run — expect FAIL.** `node test/users.test.js`

- [ ] **Step 3: Implement `lib/users.js`**

```javascript
const accounts = require('./accounts');

// makeUsers(db) — db is any object with async query(text, params). Injectable for tests.
function makeUsers(db) {
  return {
    async create(username, passwordHashOrPlain, role = 'user') {
      // accept a pre-hashed value (tests) or hash a plaintext password
      const hash = passwordHashOrPlain.startsWith('scrypt$') ? passwordHashOrPlain : accounts.hashPassword(passwordHashOrPlain);
      const r = await db.query(
        'INSERT INTO users(username, password_hash, role) VALUES($1,$2,$3) RETURNING *',
        [username, hash, role]
      );
      return r.rows[0];
    },
    async findByUsername(username) {
      const r = await db.query('SELECT * FROM users WHERE username=$1', [username]);
      return r.rowCount ? r.rows[0] : null;
    },
    async touchLastSeen(id, ip) {
      await db.query('UPDATE users SET last_seen_at=now(), last_ip=$2 WHERE id=$1', [id, ip || null]);
    },
  };
}
module.exports = { makeUsers };
```

- [ ] **Step 4: Run — expect PASS.** `node test/users.test.js`

- [ ] **Step 5: Add to npm test + commit**

Modify `package.json` test script to append ` && node test/db.test.js && node test/users.test.js`.
```bash
git add lib/users.js test/users.test.js package.json
git commit -m "feat(accounts): user repository with injectable query + fake-db tests"
```

---

## Task 4: Session repository (`lib/sessions.js`)

**Files:** Create `lib/sessions.js`, `test/sessions.test.js`

- [ ] **Step 1: Write failing test (fake db)** — mirrors Task 3's fake-db pattern:

```javascript
// test/sessions.test.js — run: node test/sessions.test.js
const { makeSessions } = require('../lib/sessions');
let passed=0,failed=0; const A=(c,m)=>{c?(console.log(`  ✓ ${m}`),passed++):(console.error(`  ✗ ${m}`),failed++);};
function fakeDb(){ const rows=[]; return { async query(text,params){
  if(/INSERT INTO sessions/i.test(text)){ const [uid,th,exp]=params; const row={id:'s'+(rows.length+1),user_id:uid,token_hash:th,expires_at:exp}; rows.push(row); return {rows:[row],rowCount:1}; }
  if(/SELECT .* FROM sessions .* JOIN users|SELECT .* FROM sessions WHERE token_hash/i.test(text)){ const r=rows.find(x=>x.token_hash===params[0]); return {rows:r?[{...r,username:'alice',role:'user'}]:[],rowCount:r?1:0}; }
  if(/DELETE FROM sessions/i.test(text)){ const i=rows.findIndex(x=>x.token_hash===params[0]); if(i>=0)rows.splice(i,1); return {rowCount:1}; }
  return {rows:[],rowCount:0};
} }; }
(async()=>{
  const sessions=makeSessions(fakeDb());
  const { token } = await sessions.create('user-1');
  A(typeof token==='string' && token.length>20,'create returns raw token');
  const s=await sessions.lookup(token);
  A(s && s.user_id==='user-1','lookup resolves by raw token');
  A(await sessions.lookup('bogus')===null,'unknown token → null');
  await sessions.destroy(token);
  A(await sessions.lookup(token)===null,'destroyed token no longer resolves');
  console.log(`\n${passed+failed} tests: ${passed} passed, ${failed} failed`); if(failed)process.exit(1);
})();
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `lib/sessions.js`**

```javascript
const accounts = require('./accounts');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function makeSessions(db) {
  return {
    async create(userId) {
      const token = accounts.generateSessionToken();
      const tokenHash = accounts.hashToken(token);
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      await db.query('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES($1,$2,$3) RETURNING *', [userId, tokenHash, expires]);
      return { token, expiresAt: expires };
    },
    async lookup(token) {
      if (!token) return null;
      const r = await db.query(
        `SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash=$1 AND s.expires_at > now()`, [accounts.hashToken(token)]);
      return r.rowCount ? r.rows[0] : null;
    },
    async destroy(token) {
      if (!token) return;
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [accounts.hashToken(token)]);
    },
  };
}
module.exports = { makeSessions, SESSION_TTL_MS };
```

(The fake-db test's lookup regex tolerates the JOIN; with a real DB the JOIN returns username/role.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Add to npm test + commit**

```bash
git add lib/sessions.js test/sessions.test.js package.json
git commit -m "feat(accounts): session repository (hashed tokens, 30d TTL) + tests"
```

---

## Task 5: Auth API + middleware + admin seed

**Files:** Create `routes/auth.js`; Modify `server.js`

- [ ] **Step 1: Implement `routes/auth.js`**

```javascript
const express = require('express');
const db = require('../lib/db');
const { makeUsers } = require('../lib/users');
const { makeSessions } = require('../lib/sessions');

const COOKIE = 'meb_session';
function cookieOpts() {
  return { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'lax', path: '/', maxAge: 30*24*60*60*1000 };
}
function parseCookies(req) {
  const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i>0) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim()); }); return out;
}

function makeAuthRouter() {
  const users = makeUsers(db);
  const sessions = makeSessions(db);
  const r = express.Router();
  r.use(express.json());

  r.post('/register', async (req, res) => {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const user = await users.create(username, password, 'user');
      const { token } = await sessions.create(user.id);
      res.cookie(COOKIE, token, cookieOpts());
      res.json({ username: user.username, role: user.role });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'username taken' });
      res.status(500).json({ error: 'registration failed' });
    }
  });

  r.post('/login', async (req, res) => {
    if (!db.isConfigured()) return res.status(503).json({ error: 'accounts unavailable' });
    const { username, password } = req.body || {};
    const user = await users.findByUsername(username || '');
    const { verifyPassword } = require('../lib/accounts');
    if (!user || !verifyPassword(password || '', user.password_hash)) return res.status(401).json({ error: 'invalid credentials' });
    const { token } = await sessions.create(user.id);
    await users.touchLastSeen(user.id, req.ip);
    res.cookie(COOKIE, token, cookieOpts());
    res.json({ username: user.username, role: user.role });
  });

  r.post('/logout', async (req, res) => {
    const token = parseCookies(req)[COOKIE];
    try { await sessions.destroy(token); } catch {}
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', async (req, res) => {
    if (!db.isConfigured()) return res.json({ user: null });
    const token = parseCookies(req)[COOKIE];
    const s = await sessions.lookup(token);
    res.json({ user: s ? { username: s.username, role: s.role } : null });
  });

  return r;
}

// Express middleware to attach req.user (or null)
function attachUser() {
  const sessions = makeSessions(db);
  return async (req, _res, next) => {
    if (!db.isConfigured()) { req.user = null; return next(); }
    try { const s = await sessions.lookup(parseCookies(req)[COOKIE]); req.user = s ? { id: s.user_id, username: s.username, role: s.role } : null; }
    catch { req.user = null; }
    next();
  };
}

module.exports = { makeAuthRouter, attachUser, COOKIE };
```

- [ ] **Step 2: Wire into `server.js`** (after `app` + static, before catch-alls):

```javascript
const { makeAuthRouter, attachUser } = require('./routes/auth');
app.use(attachUser());
app.use('/api/auth', makeAuthRouter());
```

- [ ] **Step 3: Seed admin on boot** — add a `lib/seed.js`:

```javascript
const db = require('./db');
const { makeUsers } = require('./users');
async function seedAdmin() {
  if (!db.isConfigured()) return;
  const username = process.env.ADMIN_USERNAME || 'Eli';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) { console.warn('[seed] ADMIN_PASSWORD not set — no admin seeded'); return; }
  const users = makeUsers(db);
  if (await users.findByUsername(username)) return;
  await users.create(username, password, 'admin');
  console.log(`[seed] created admin '${username}'`);
}
module.exports = { seedAdmin };
```
Call it after migrations in `server.js`:
```javascript
const { seedAdmin } = require('./lib/seed');
runMigrations().then(() => seedAdmin()).catch(e => console.error('[boot] db init failed:', e.message));
```

- [ ] **Step 4: Verify boot safe without DB.** Run: `node -c server.js && echo "syntax ok"` then start with no `DATABASE_URL` and confirm `/api/auth/me` returns `{"user":null}` and existing routes work.

Run: `PORT=7060 node server.js` (background), then `curl -s localhost:7060/api/auth/me`
Expected: `{"user":null}`; `/configure` and `/health` still 200.

- [ ] **Step 5: Commit**

```bash
git add routes/auth.js lib/seed.js server.js
git commit -m "feat(auth): register/login/logout/me API, session cookies, attachUser middleware, admin seed"
```

---

## Task 6: Login / Register screen (server-backed)

**Files:** Create `public/js/auth-ui.js`, `public/css/_auth.css` (append to configure.css); Modify `public/configure.html`

- [ ] **Step 1: Add the auth overlay markup** to `configure.html` (right after `<body>`'s `.bg` div), hidden by default; shown by JS when `db` is configured and no user:

```html
<div class="auth-overlay" id="auth-overlay" style="display:none">
  <div class="auth-card">
    <div class="auth-logo">◢</div>
    <div class="auth-head"><h1 id="auth-title">Welcome back</h1><p class="auth-sub" id="auth-sub">Sign in to manage your bridge</p></div>
    <div class="auth-tabs" id="auth-tabs"><div class="pill-slide"></div><button class="on" data-auth="login">Log in</button><button data-auth="register">Register</button></div>
    <form id="auth-form" autocomplete="on">
      <label class="field-label" for="au-user">Username</label>
      <input class="input" id="au-user" name="username" autocomplete="username" />
      <label class="field-label" for="au-pass">Password</label>
      <input class="input" id="au-pass" name="password" type="password" autocomplete="current-password" />
      <div class="auth-err" id="au-err"></div>
      <button class="btn-generate" id="au-submit" type="submit">Log in</button>
    </form>
  </div>
</div>
```

- [ ] **Step 2: Implement `public/js/auth-ui.js`** — checks `/api/auth/me`; if `user===null` AND accounts are enabled, show overlay; handle submit → `/api/auth/login|register`; on success hide overlay + set a logout control. (Full code: tab crossfade reused from prototype; fetch with `credentials:'same-origin'`; on 503 "accounts unavailable" hide overlay so the addon still works pre-DB.)

```javascript
(function(){
  const $=s=>document.querySelector(s);
  let mode='login';
  async function me(){ try{ const r=await fetch('/api/auth/me',{credentials:'same-origin'}); return (await r.json()).user; }catch{ return undefined; } }
  function show(){ $('#auth-overlay').style.display='grid'; }
  function hide(){ $('#auth-overlay').style.display='none'; }
  async function submit(e){ e.preventDefault();
    const username=$('#au-user').value.trim(), password=$('#au-pass').value;
    const r=await fetch('/api/auth/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username,password})});
    if(r.status===503){ hide(); return; }              // accounts not enabled yet
    const data=await r.json();
    if(!r.ok){ $('#au-err').textContent=data.error||'failed'; return; }
    hide(); if(window.toast) window.toast('Signed in as '+data.username);
  }
  document.addEventListener('DOMContentLoaded', async ()=>{
    $('#auth-form')?.addEventListener('submit', submit);
    document.querySelectorAll('#auth-tabs button').forEach(b=>b.addEventListener('click',()=>{ mode=b.dataset.auth; document.querySelectorAll('#auth-tabs button').forEach(x=>x.classList.toggle('on',x===b)); $('#auth-tabs').classList.toggle('reg',mode==='register'); $('#auth-title').textContent=mode==='register'?'Create account':'Welcome back'; $('#au-submit').textContent=mode==='register'?'Register':'Log in'; $('#au-err').textContent=''; }));
    const u=await me();
    if(u===null) show();        // accounts enabled, not logged in
    // u===undefined (error) or a user object → leave app visible
  });
})();
```

- [ ] **Step 3: Append `_auth.css`** (overlay + card styling reusing theme vars; same look as prototype auth screen) and add `<script src="/js/auth-ui.js"></script>` before `</body>`.

- [ ] **Step 4: Verify pre-DB behavior** — with no `DATABASE_URL`, `/api/auth/me` returns `{user:null}`... NOTE: that would show the overlay even without a DB. To avoid locking out the addon before accounts exist, change `/me` to return `{ user: null, enabled: false }` when `!db.isConfigured()`, and in `auth-ui.js` only `show()` when `enabled !== false`. Adjust both. Re-verify: no DB → overlay hidden, app usable.

- [ ] **Step 5: Commit**

```bash
git add public/configure.html public/js/auth-ui.js public/css/configure.css
git commit -m "feat(auth): server-backed login/register screen (hidden until accounts enabled)"
```

---

## Task 7: Full verification + deploy

- [ ] **Step 1: Full suite green.** Run: `npm test` → all tests pass (utils/streams/crypto/manifest/accounts/metrics/db/users/sessions).
- [ ] **Step 2: DB-less smoke test.** Start with no `DATABASE_URL`; confirm `/configure` loads with NO auth overlay, install-link generation still works, `/api/auth/me` → `{user:null,enabled:false}`.
- [ ] **Step 3: With-DB smoke test (local or Railway).** Set `DATABASE_URL` (+ `CONFIG_ENC_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD`); boot → migrations apply, admin seeded. Register a user → cookie set → reload shows app (no overlay). Logout → overlay returns. Login as admin → `role:admin`.
- [ ] **Step 4: Merge + deploy.** `git checkout main && git merge --no-ff phase2/accounts-db && git push origin main`. Railway runs migrations on boot (needs Postgres + vars set first).
- [ ] **Step 5: Verify production** `/api/auth/me`, register/login round-trip on the live site.

---

## Self-Review (coverage)
- Spec §2.1 DB (Railway PG, users/sessions tables) → Tasks 1, 2.
- Spec §2.2 auth (hashing via accounts.js, session cookies, middleware, admin seed) → Tasks 3, 4, 5.
- Login/Register screen → Task 6.
- DB-less safety (addon keeps working before Postgres) → lazy db.js (T1), `/me enabled:false` (T6 S4), 503 guards (T5).
- Test strategy: injectable query + fake DB keeps suite green without Postgres (T3, T4).
- Deploy → Task 7.

**Deferred to later phases:** encrypted API-key storage + per-user manifest tokens (Phase 3), admin panel UI (Phase 4), PayPal billing (Phase 5). CSRF: SameSite=lax cookies mitigate cross-site POSTs for now; a CSRF token can be added in a later hardening pass.
