# Billing History Portal + Per-User Server Uptime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist billing payments + a billing audit trail and per-user server uptime history to Postgres, expose them in a user portal (Billing + Health pages) and an admin user-detail view with full subscription control.

**Architecture:** Additive migration `005_history.sql` adds `payments`, `billing_events`, `server_health_log`, `server_uptime_daily`. Two new focused lib modules (`lib/payments.js`, `lib/serverHistory.js`) own DB reads/writes. The PayPal webhook records payments; `lib/billing.js` emits audit events; the health pinger writes per-user checks + daily rollups. New user + admin routes surface the data; the frontend rebuilds the Billing page and extends Health + Admin.

**Tech Stack:** Node.js, Express, `pg` (Postgres), vanilla JS frontend. Tests are plain `node test/*.test.js` scripts with a SQL-matching fake DB (see `test/billing.test.js`).

**Spec:** `docs/superpowers/specs/2026-06-01-billing-history-and-server-uptime-design.md`

**Conventions:**
- Every lib module is `makeX(db)` returning an object of async methods; all DB access via `db.query(text, params)`.
- All new tables `ON DELETE CASCADE` from `users`.
- After each task: run `npm test` (full suite) and commit.
- Deploy is `git push origin main` (Railway auto-deploys). Do NOT push until a task group is verified.

---

## File Structure

- Create: `migrations/005_history.sql` — the four new tables.
- Create: `lib/payments.js` — `makePayments(db)`: `record`, `listForUser`, `addEvent`, `listEvents`.
- Create: `lib/serverHistory.js` — `makeServerHistory(db)`: `logCheck`, `listForUser`, `prune`.
- Create: `test/payments.test.js`, `test/serverHistory.test.js`.
- Modify: `lib/billing.js` — accept optional event sink; emit `billing_events` on status changes.
- Modify: `routes/billing.js` — record payments in webhook/activate; add `GET /history`.
- Modify: `routes/user.js` — add `GET /server-history`.
- Modify: `routes/admin.js` — user detail + override + resync + password endpoints; comp/uncomp emit events.
- Modify: `lib/health.js` — after each ping cycle, write per-user log + rollup; schedule prune.
- Modify: `lib/paypal.js` — no change (reuse `getSubscription`).
- Modify: `public/configure.html`, `public/js/billing-ui.js`, `public/js/health.js`, `public/js/admin.js`, `public/css/configure.css` — portal + history + admin UI.
- Modify: `package.json` — register the two new test files.

---

## Task 1: Migration — new history tables

**Files:**
- Create: `migrations/005_history.sql`
- Modify: none

- [ ] **Step 1: Write the migration file**

Create `migrations/005_history.sql`:

```sql
-- Going-forward payment records, billing audit trail, and per-user server uptime.

CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paypal_sale_id  TEXT UNIQUE,
  amount          NUMERIC(10,2),
  currency        TEXT DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'completed',
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS server_health_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_url   TEXT NOT NULL,
  label        TEXT,
  up           BOOLEAN NOT NULL,
  response_ms  INTEGER,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shl_user_time ON server_health_log(user_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS server_uptime_daily (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_url  TEXT NOT NULL,
  label       TEXT,
  day         DATE NOT NULL,
  checks      INTEGER NOT NULL DEFAULT 0,
  up_checks   INTEGER NOT NULL DEFAULT 0,
  avg_ms      INTEGER,
  PRIMARY KEY (user_id, server_url, day)
);
```

- [ ] **Step 2: Verify the migration runner picks it up**

Run: `grep -n "migrations" lib/migrate.js`
Expected: confirms it reads all `migrations/*.sql` in sorted order (no per-file registration needed). If it uses an explicit list, add `005_history.sql` to it.

- [ ] **Step 3: Commit**

```bash
git add migrations/005_history.sql
git commit -m "feat(db): migration 005 — payments, billing_events, server uptime tables"
```

---

## Task 2: `lib/payments.js` — payment + event persistence

**Files:**
- Create: `lib/payments.js`
- Test: `test/payments.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `test/payments.test.js`:

```js
// Run with: node test/payments.test.js
const { makePayments } = require('../lib/payments');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const payments = []; const events = [];
  return {
    async query(text, params) {
      if (/INSERT INTO payments/i.test(text)) {
        const saleId = params[1];
        if (saleId && payments.some(p => p.paypal_sale_id === saleId)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
        payments.push({ user_id: params[0], paypal_sale_id: saleId, amount: params[2], currency: params[3], status: params[4], paid_at: params[5] || new Date().toISOString() });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT .* FROM payments WHERE user_id/i.test(text)) {
        return { rows: payments.filter(p => p.user_id === params[0]), rowCount: payments.length };
      }
      if (/INSERT INTO billing_events/i.test(text)) {
        events.push({ user_id: params[0], type: params[1], detail: params[2], actor_id: params[3] });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT .* FROM billing_events WHERE user_id/i.test(text)) {
        return { rows: events.filter(e => e.user_id === params[0]), rowCount: events.length };
      }
      return { rows: [], rowCount: 0 };
    },
    _payments: payments, _events: events,
  };
}

(async () => {
  const db = fakeDb();
  const p = makePayments(db);

  await p.record({ userId: 'u1', paypalSaleId: 'S1', amount: 4, currency: 'USD' });
  A(db._payments.length === 1, 'record inserts a payment');
  await p.record({ userId: 'u1', paypalSaleId: 'S1', amount: 4 }); // duplicate sale id
  A(db._payments.length === 1, 'duplicate paypal_sale_id is ignored (idempotent)');

  const list = await p.listForUser('u1');
  A(list.length === 1, 'listForUser returns the user payments');

  await p.addEvent({ userId: 'u1', type: 'activated', detail: { sub: 'I-1' } });
  await p.addEvent({ userId: 'u1', type: 'admin_override', actorId: 'admin1', detail: { status: 'active' } });
  A(db._events.length === 2, 'addEvent appends billing_events');
  A(db._events[1].actor_id === 'admin1', 'admin event records actor_id');

  const events = await p.listEvents('u1');
  A(events.length === 2, 'listEvents returns the user events');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/payments.test.js`
Expected: FAIL — `Cannot find module '../lib/payments'`

- [ ] **Step 3: Write the implementation**

Create `lib/payments.js`:

```js
// ─── Payments + billing audit trail persistence ────────────────────────────
// makePayments(db): record going-forward payments (idempotent on paypal_sale_id)
// and append/read billing_events. All methods no-op-safe under a fake DB in tests.
function makePayments(db) {
  return {
    async record({ userId, paypalSaleId = null, amount = null, currency = 'USD', status = 'completed', paidAt = null }) {
      await db.query(
        `INSERT INTO payments(user_id, paypal_sale_id, amount, currency, status, paid_at)
         VALUES($1,$2,$3,$4,$5,COALESCE($6, now()))
         ON CONFLICT (paypal_sale_id) DO NOTHING`,
        [userId, paypalSaleId, amount, currency, status, paidAt]
      );
    },
    async listForUser(userId) {
      const r = await db.query(
        `SELECT id, amount, currency, status, paid_at FROM payments WHERE user_id=$1 ORDER BY paid_at DESC`,
        [userId]
      );
      return r.rows;
    },
    async addEvent({ userId, type, detail = {}, actorId = null }) {
      await db.query(
        `INSERT INTO billing_events(user_id, type, detail, actor_id) VALUES($1,$2,$3,$4)`,
        [userId, type, JSON.stringify(detail), actorId]
      );
    },
    async listEvents(userId) {
      const r = await db.query(
        `SELECT id, type, detail, actor_id, created_at FROM billing_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
        [userId]
      );
      return r.rows;
    },
  };
}

module.exports = { makePayments };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/payments.test.js`
Expected: PASS — `6 tests: 6 passed, 0 failed`

- [ ] **Step 5: Register the test in package.json**

In `package.json` `scripts.test`, append ` && node test/payments.test.js` to the end of the chain.

- [ ] **Step 6: Commit**

```bash
git add lib/payments.js test/payments.test.js package.json
git commit -m "feat(billing): payments + billing_events persistence (lib/payments.js)"
```

---

## Task 3: `lib/serverHistory.js` — per-user uptime persistence

**Files:**
- Create: `lib/serverHistory.js`
- Test: `test/serverHistory.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `test/serverHistory.test.js`:

```js
// Run with: node test/serverHistory.test.js
const { makeServerHistory } = require('../lib/serverHistory');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const log = []; const daily = new Map(); // key user|url|day
  return {
    async query(text, params) {
      if (/INSERT INTO server_health_log/i.test(text)) {
        log.push({ user_id: params[0], server_url: params[1], label: params[2], up: params[3], response_ms: params[4] });
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT INTO server_uptime_daily/i.test(text)) {
        // params: user, url, label, day, up(1/0), ms
        const key = `${params[0]}|${params[1]}|${params[3]}`;
        const up = params[4] ? 1 : 0; const ms = params[5];
        const cur = daily.get(key) || { user_id: params[0], server_url: params[1], label: params[2], day: params[3], checks: 0, up_checks: 0, avg_ms: 0 };
        const newChecks = cur.checks + 1;
        cur.avg_ms = ms == null ? cur.avg_ms : Math.round((cur.avg_ms * cur.checks + ms) / newChecks);
        cur.checks = newChecks; cur.up_checks += up;
        daily.set(key, cur);
        return { rowCount: 1, rows: [] };
      }
      if (/DELETE FROM server_health_log/i.test(text)) { return { rowCount: 0, rows: [] }; }
      if (/SELECT .* FROM server_uptime_daily WHERE user_id/i.test(text)) {
        return { rows: [...daily.values()].filter(d => d.user_id === params[0]), rowCount: daily.size };
      }
      if (/SELECT .* FROM server_health_log WHERE user_id/i.test(text)) {
        return { rows: log.filter(l => l.user_id === params[0]), rowCount: log.length };
      }
      return { rows: [], rowCount: 0 };
    },
    _log: log, _daily: daily,
  };
}

(async () => {
  const db = fakeDb();
  const sh = makeServerHistory(db);

  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: true, responseMs: 100, day: '2026-06-01' });
  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: false, responseMs: null, day: '2026-06-01' });
  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: true, responseMs: 200, day: '2026-06-01' });

  A(db._log.length === 3, 'logCheck writes a raw row each call');
  const d = [...db._daily.values()][0];
  A(d.checks === 3 && d.up_checks === 2, 'daily rollup counts checks and up_checks');
  A(d.avg_ms === 150, 'daily rollup averages response_ms over non-null checks');

  const out = await sh.listForUser('u1');
  A(Array.isArray(out.servers) && out.servers[0].url === 'http://a', 'listForUser groups by server');
  A(out.servers[0].daily.length >= 1, 'listForUser returns daily rollups per server');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/serverHistory.test.js`
Expected: FAIL — `Cannot find module '../lib/serverHistory'`

- [ ] **Step 3: Write the implementation**

Create `lib/serverHistory.js`:

```js
// ─── Per-user server uptime history persistence ─────────────────────────────
// makeServerHistory(db): logCheck() writes a raw row + upserts the day's rollup;
// listForUser() returns daily rollups + recent raw checks grouped per server;
// prune() drops raw rows older than RAW_RETENTION_DAYS (rollups kept forever).
const RAW_RETENTION_DAYS = 90;

function dayOf(ts) { return new Date(ts || Date.now()).toISOString().slice(0, 10); }

function makeServerHistory(db) {
  return {
    async logCheck({ userId, serverUrl, label = null, up, responseMs = null, day = null }) {
      const d = day || dayOf();
      await db.query(
        `INSERT INTO server_health_log(user_id, server_url, label, up, response_ms) VALUES($1,$2,$3,$4,$5)`,
        [userId, serverUrl, label, up, responseMs]
      );
      // Upsert daily rollup: increment checks/up_checks, maintain running avg_ms over non-null samples.
      await db.query(
        `INSERT INTO server_uptime_daily(user_id, server_url, label, day, checks, up_checks, avg_ms)
         VALUES($1,$2,$3,$4,1,$5,$6)
         ON CONFLICT (user_id, server_url, day) DO UPDATE SET
           checks = server_uptime_daily.checks + 1,
           up_checks = server_uptime_daily.up_checks + $5,
           label = EXCLUDED.label,
           avg_ms = CASE WHEN $6 IS NULL THEN server_uptime_daily.avg_ms
             ELSE ROUND(((COALESCE(server_uptime_daily.avg_ms,0) * server_uptime_daily.checks) + $6) / (server_uptime_daily.checks + 1)) END`,
        [userId, serverUrl, label, d, up ? 1 : 0, responseMs]
      );
    },
    async listForUser(userId) {
      const daily = await db.query(
        `SELECT server_url, label, day, checks, up_checks, avg_ms FROM server_uptime_daily
          WHERE user_id=$1 ORDER BY day DESC`, [userId]);
      const recent = await db.query(
        `SELECT server_url, label, up, response_ms, checked_at FROM server_health_log
          WHERE user_id=$1 AND checked_at > now() - interval '2 days' ORDER BY checked_at DESC LIMIT 1000`, [userId]);
      const byUrl = new Map();
      for (const row of daily.rows) {
        if (!byUrl.has(row.server_url)) byUrl.set(row.server_url, { url: row.server_url, label: row.label, daily: [], recent: [] });
        byUrl.get(row.server_url).daily.push(row);
      }
      for (const row of recent.rows) {
        if (!byUrl.has(row.server_url)) byUrl.set(row.server_url, { url: row.server_url, label: row.label, daily: [], recent: [] });
        byUrl.get(row.server_url).recent.push(row);
      }
      return { servers: [...byUrl.values()] };
    },
    async prune() {
      await db.query(`DELETE FROM server_health_log WHERE checked_at < now() - interval '${RAW_RETENTION_DAYS} days'`);
    },
  };
}

module.exports = { makeServerHistory, RAW_RETENTION_DAYS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/serverHistory.test.js`
Expected: PASS — `5 tests: 5 passed, 0 failed`

- [ ] **Step 5: Register the test in package.json**

In `package.json` `scripts.test`, append ` && node test/serverHistory.test.js`.

- [ ] **Step 6: Commit**

```bash
git add lib/serverHistory.js test/serverHistory.test.js package.json
git commit -m "feat(health): per-user server uptime persistence (lib/serverHistory.js)"
```

---

## Task 4: Emit billing audit events from `lib/billing.js`

**Files:**
- Modify: `lib/billing.js`
- Test: `test/billing.test.js` (extend)

- [ ] **Step 1: Extend the test**

In `test/billing.test.js`, extend `fakeDb()` to capture events and assert. Add to the `query` matcher (before the final `return`):

```js
    if (/INSERT INTO billing_events/i.test(text)) { (fakeDb._events ||= []).push({ user_id: params[0], type: params[1] }); return { rowCount: 1 }; }
```

And after the existing assertions in the IIFE, add:

```js
  // events: pass an event sink and verify status changes emit audit rows
  const events = [];
  const b2 = makeBilling(fakeDb(), { addEvent: (e) => events.push(e) });
  await b2.comp('u9');
  A(events.some(e => e.type === 'comped' && e.userId === 'u9'), 'comp emits a comped billing event');
  await b2.cancel('u9');
  A(events.some(e => e.type === 'cancelled'), 'cancel emits a cancelled billing event');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/billing.test.js`
Expected: FAIL — `comp emits a comped billing event` (no event emitted yet).

- [ ] **Step 3: Implement the event sink**

In `lib/billing.js`, change the signature and emit events. Replace `function makeBilling(db) {` with:

```js
function makeBilling(db, events = null) {
  const emit = (userId, type, detail = {}, actorId = null) => {
    if (events && typeof events.addEvent === 'function') {
      Promise.resolve(events.addEvent({ userId, type, detail, actorId })).catch(() => {});
    }
  };
```

Then inside the returned object, after the DB write in each method, add an `emit(...)`:
- `comp(userId, actorId)` → after the query: `emit(userId, 'comped', {}, actorId || null);` (add `actorId` param)
- `cancel(userId, actorId)` → `emit(userId, 'cancelled', {}, actorId || null);` (add `actorId` param)
- `setStatusFromPaypal(userId, paypalSubId, status, periodEnd)` → `emit(userId, status === 'active' ? 'activated' : status, { paypalSubId, periodEnd });`
- `redeemCode` (when `comp_100` comps) → `emit(userId, 'code_redeemed', { code: c.code, type: c.type });`

Keep all existing behavior; events are best-effort and never throw.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/billing.test.js`
Expected: PASS (all prior + 2 new event assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/billing.js test/billing.test.js
git commit -m "feat(billing): emit billing_events on comp/cancel/activate/redeem"
```

---

## Task 5: Record payments + events in the billing routes

**Files:**
- Modify: `routes/billing.js`

- [ ] **Step 1: Wire payments into the router**

At the top of `makeBillingRouter()` in `routes/billing.js`, add:

```js
  const { makePayments } = require('../lib/payments');
  const payments = makePayments(db);
  const billing = makeBilling(db, payments); // events sink
```

(Replace the existing `const billing = makeBilling(db);`.)

- [ ] **Step 2: Record the payment in the webhook**

In the `r.post('/webhook', ...)` handler, inside the `PAYMENT.SALE.COMPLETED` branch, after the status update, resolve the user and record:

```js
        else if (type === 'PAYMENT.SALE.COMPLETED' && resource.billing_agreement_id) {
          await billing.setByPaypalSub(resource.billing_agreement_id, 'active', null);
          try {
            const u = await db.query('SELECT user_id FROM subscriptions WHERE paypal_subscription_id=$1', [resource.billing_agreement_id]);
            if (u.rowCount) {
              const userId = u.rows[0].user_id;
              const amt = resource.amount && (resource.amount.total || resource.amount.value);
              const cur = resource.amount && (resource.amount.currency || resource.amount.currency_code) || 'USD';
              await payments.record({ userId, paypalSaleId: resource.id, amount: amt, currency: cur, paidAt: resource.create_time || null });
              await payments.addEvent({ userId, type: 'payment', detail: { saleId: resource.id, amount: amt, currency: cur } });
            }
          } catch (e) { console.error('[webhook/payment-record]', e.message); }
        }
```

- [ ] **Step 3: Add `GET /history` endpoint**

Add to the router (after `/status`):

```js
  r.get('/history', requireAuth, async (req, res) => {
    try {
      const sub = await billing.get(req.user.id);
      const list = await payments.listForUser(req.user.id);
      const events = await payments.listEvents(req.user.id);
      const upcoming = sub.current_period_end
        ? { date: sub.current_period_end, amount: PLAN_PRICE }
        : null;
      res.json({ status: sub.status, periodEnd: sub.current_period_end || null, planPrice: PLAN_PRICE, upcoming, payments: list, events });
    } catch (e) { console.error('[billing/history]', e.message); res.status(500).json({ error: 'history failed' }); }
  });
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npm test`
Expected: PASS (no route-level unit tests; ensure nothing imported breaks).

- [ ] **Step 5: Commit**

```bash
git add routes/billing.js
git commit -m "feat(billing): record payments from webhook + GET /api/billing/history"
```

---

## Task 6: Write per-user uptime from the health pinger

**Files:**
- Modify: `lib/health.js`

**Context:** `pingHealthServers()` (lib/health.js:107) pings each registered URL and pushes into the in-memory `healthHistory[url]`. We add per-user persistence: after computing each server's result, map URL→users via `user_config.config_json->'servers'` and write a `server_health_log` row + rollup per (user, url).

- [ ] **Step 1: Add a URL→users resolver**

In `lib/health.js`, near the top (after requires), add:

```js
const dbLib = require('./db');
const { makeServerHistory } = require('./serverHistory');
const _serverHistory = makeServerHistory(dbLib);

// Map server URL → [userId] from stored user configs. Empty when DB not configured.
async function usersForServerUrls() {
  if (!dbLib.isConfigured()) return new Map();
  const map = new Map();
  try {
    const r = await dbLib.query(`SELECT user_id, config_json FROM user_config`);
    for (const row of r.rows) {
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      for (const s of (cfg.servers || [])) {
        const url = (s.url || '').replace(/\/+$/, '');
        if (!url) continue;
        if (!map.has(url)) map.set(url, []);
        map.get(url).push(row.user_id);
      }
    }
  } catch (e) { console.error('[health/usersForServerUrls]', e.message); }
  return map;
}
```

- [ ] **Step 2: Persist per-user results after a ping cycle**

In `pingHealthServers()`, capture each server's `{ url, up, ms }` into a local array `results`, then after the `Promise.all`, fan out to users:

```js
async function pingHealthServers() {
  const results = [];
  await Promise.all(healthServers.map(async (server) => {
    // ... existing ping logic that computes `up` and `ms` ...
    results.push({ url: server.url, label: server.label, up, ms });
    // ... existing healthHistory push + cap ...
  }));
  saveHealthData();
  // Persist per-user durable history (best-effort; never throws)
  try {
    const map = await usersForServerUrls();
    for (const res of results) {
      const users = map.get(res.url) || [];
      for (const userId of users) {
        await _serverHistory.logCheck({ userId, serverUrl: res.url, label: res.label, up: res.up, responseMs: res.up ? res.ms : null });
      }
    }
  } catch (e) { console.error('[health/persist]', e.message); }
}
```

(Adapt to the exact existing variable names in the function; keep the in-memory history + `saveHealthData()` behavior intact.)

- [ ] **Step 3: Schedule the daily prune**

Near the existing `setInterval(pingHealthServers, ...)` at the bottom, add:

```js
setInterval(() => { _serverHistory.prune().catch(() => {}); }, 24 * 60 * 60 * 1000);
```

- [ ] **Step 4: Smoke-test the module loads**

Run: `node -e "require('./lib/health.js'); console.log('ok')"`
Expected: prints `ok` with no throw (DB not configured → resolver returns empty map).

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/health.js
git commit -m "feat(health): persist per-user uptime checks + daily rollups from pinger"
```

---

## Task 7: User server-history endpoint

**Files:**
- Modify: `routes/user.js`

- [ ] **Step 1: Add the endpoint**

In `routes/user.js`, add (following the file's existing auth pattern — match how other `/api/user/*` routes guard with `req.user`):

```js
  const { makeServerHistory } = require('../lib/serverHistory');
  const serverHistory = makeServerHistory(db);

  r.get('/server-history', async (req, res) => {
    if (!db.isConfigured()) return res.json({ servers: [] });
    if (!req.user) return res.status(401).json({ error: 'not signed in' });
    try { res.json(await serverHistory.listForUser(req.user.id)); }
    catch (e) { console.error('[user/server-history]', e.message); res.status(500).json({ error: 'history failed' }); }
  });
```

(Place `require`/`makeServerHistory` at the top of the router factory alongside existing requires.)

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/user.js
git commit -m "feat(user): GET /api/user/server-history"
```

---

## Task 8: Admin user-detail + control endpoints

**Files:**
- Modify: `routes/admin.js`

- [ ] **Step 1: Wire payments + serverHistory + paypal into the admin router**

At the top of `makeAdminRouter()`, add:

```js
  const { makePayments } = require('../lib/payments');
  const { makeServerHistory } = require('../lib/serverHistory');
  const paypal = require('../lib/paypal');
  const { makeUsers } = require('../lib/users');
  const payments = makePayments(db);
  const serverHistory = makeServerHistory(db);
  const usersLib = makeUsers(db);
  const billing = makeBilling(db, payments); // events sink (replace existing makeBilling(db))
```

- [ ] **Step 2: Add the detail endpoint**

```js
  r.get('/users/:id/detail', requireAdmin, async (req, res) => {
    try {
      const sub = await billing.get(req.params.id);
      res.json({
        subscription: sub,
        payments: await payments.listForUser(req.params.id),
        events: await payments.listEvents(req.params.id),
        servers: (await serverHistory.listForUser(req.params.id)).servers,
      });
    } catch (e) { console.error('[admin/detail]', e.message); res.status(500).json({ error: 'detail failed' }); }
  });
```

- [ ] **Step 3: Add manual subscription override**

```js
  r.post('/users/:id/subscription', requireAdmin, async (req, res) => {
    const { status, periodEnd } = req.body || {};
    const allowed = ['none', 'active', 'cancelled', 'past_due', 'comped'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
    if (periodEnd && Number.isNaN(Date.parse(periodEnd))) return res.status(400).json({ error: 'invalid periodEnd' });
    try {
      await db.query(
        `INSERT INTO subscriptions(user_id, status, current_period_end, updated_at)
         VALUES($1,$2,$3,now())
         ON CONFLICT (user_id) DO UPDATE SET status=$2, current_period_end=$3, updated_at=now()`,
        [req.params.id, status, periodEnd || null]
      );
      await payments.addEvent({ userId: req.params.id, type: 'admin_override', detail: { status, periodEnd: periodEnd || null }, actorId: req.user.id });
      res.json({ ok: true, status, periodEnd: periodEnd || null });
    } catch (e) { console.error('[admin/subscription]', e.message); res.status(500).json({ error: 'override failed' }); }
  });
```

- [ ] **Step 4: Add PayPal resync**

```js
  r.post('/users/:id/resync', requireAdmin, async (req, res) => {
    if (!paypal.isConfigured()) return res.status(503).json({ error: 'paypal not configured' });
    try {
      const sub = await billing.get(req.params.id);
      if (!sub.paypal_subscription_id) return res.status(400).json({ error: 'no paypal subscription on file' });
      const ps = await paypal.getSubscription(sub.paypal_subscription_id);
      const status = ['ACTIVE', 'APPROVED'].includes(ps.status) ? 'active' : (ps.status === 'CANCELLED' ? 'cancelled' : (ps.status === 'SUSPENDED' ? 'past_due' : 'none'));
      const periodEnd = ps.billing_info && ps.billing_info.next_billing_time || null;
      await billing.setStatusFromPaypal(req.params.id, sub.paypal_subscription_id, status, periodEnd);
      await payments.addEvent({ userId: req.params.id, type: 'resync', detail: { paypalStatus: ps.status, status, periodEnd }, actorId: req.user.id });
      res.json({ ok: true, status, periodEnd });
    } catch (e) { console.error('[admin/resync]', e.message); res.status(502).json({ error: 'resync failed' }); }
  });
```

- [ ] **Step 5: Add password reset**

```js
  r.post('/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });
    try {
      const ok = await usersLib.setPassword(req.params.id, password);
      if (!ok) return res.status(404).json({ error: 'user not found' });
      await payments.addEvent({ userId: req.params.id, type: 'admin_password_reset', detail: {}, actorId: req.user.id });
      res.json({ ok: true });
    } catch (e) { console.error('[admin/password]', e.message); res.status(500).json({ error: 'reset failed' }); }
  });
```

- [ ] **Step 6: Ensure `users.setPassword` exists**

Run: `grep -n "setPassword" lib/users.js`
Expected: a method exists. If NOT, add to `lib/users.js`:

```js
    async setPassword(id, password) {
      const hash = await require('./auth').hashPassword(password);
      const r = await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, id]);
      return r.rowCount > 0;
    },
```

(Match the hashing helper actually used in `lib/users.js`/`lib/auth.js` — check `grep -n "hashPassword\|bcrypt\|hash" lib/users.js lib/auth.js` and reuse it.)

- [ ] **Step 7: Make comp/uncomp pass actorId**

In the existing `/users/:id/comp` and `/users/:id/uncomp` handlers, pass the actor: `await billing.comp(req.params.id, req.user.id);` and `await billing.cancel(req.params.id, req.user.id);`.

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add routes/admin.js lib/users.js
git commit -m "feat(admin): user detail + subscription override/resync/password reset"
```

---

## Task 9: User Billing portal (frontend)

**Files:**
- Modify: `public/configure.html` (page-billing already exists: `<div id="billing-body">`)
- Modify: `public/js/billing-ui.js`
- Modify: `public/css/configure.css`

**Context:** `#page-billing` has `<div id="billing-body"></div>` populated by `billing-ui.js`. We render: status/plan card, Next payment, Past payments table, and a collapsible activity timeline — all from `GET /api/billing/history`.

- [ ] **Step 1: Render the portal from history**

In `public/js/billing-ui.js`, add a render function called on billing page show (find where the page currently fetches `/api/billing/status` and add a history fetch). Render into `#billing-body`:

```js
async function renderBillingPortal() {
  const body = document.getElementById('billing-body');
  if (!body) return;
  let h;
  try { h = await (await fetch('/api/billing/history', { credentials: 'same-origin' })).json(); }
  catch { body.innerHTML = '<div class="card">Could not load billing history.</div>'; return; }
  const money = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—') + (p.currency && p.currency !== 'USD' ? ' ' + p.currency : '');
  const date = d => d ? new Date(d).toLocaleDateString() : '—';
  const rows = (h.payments || []).map(p => `<tr><td>${date(p.paid_at)}</td><td>${money(p)}</td><td><span class="pay-status ${p.status}">${p.status}</span></td></tr>`).join('')
    || '<tr><td colspan="3" class="log-empty">No payments yet.</td></tr>';
  body.innerHTML = `
    <div class="ak-grid">
      <div class="card">
        <div class="label">Subscription</div>
        <div class="bill-statusrow">Status <span class="mtag">${h.status || 'none'}</span></div>
        <div class="bill-statusrow">Plan <span class="mtag">${h.planPrice || '—'}</span></div>
        <div class="bill-statusrow">Next payment <span class="mtag">${h.upcoming ? date(h.upcoming.date) + ' · ' + h.upcoming.amount : '—'}</span></div>
      </div>
      <div class="card">
        <div class="label">Past payments</div>
        <div class="log-table-wrap"><table class="log-table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Call it on billing page show**

Hook into the existing page-show path. In `public/js/configure.js` `onPageShow`, add: `if (name === 'billing' && typeof renderBillingPortal === 'function') renderBillingPortal();` — and expose `window.renderBillingPortal = renderBillingPortal;` in billing-ui.js. Keep any existing PayPal-button rendering intact (the portal renders alongside/below it).

- [ ] **Step 3: Style**

In `public/css/configure.css` add:

```css
.bill-statusrow{ display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid var(--border); font-size:.85rem; }
.bill-statusrow:last-child{ border-bottom:0; }
.pay-status{ font-size:.7rem; font-weight:700; text-transform:uppercase; padding:2px 8px; border-radius:999px; }
.pay-status.completed{ color:#34d399; background:rgba(52,211,153,.14); }
.pay-status.refunded{ color:#fbbf24; background:rgba(251,191,36,.14); }
.pay-status.failed{ color:#f87171; background:rgba(248,113,113,.14); }
```

- [ ] **Step 4: Manual verification**

Deploy to a branch or run locally; load `#/billing` as a logged-in user. Expected: Subscription card (status/plan/next payment) + Past payments table render. With no payments, table shows "No payments yet."

- [ ] **Step 5: Commit**

```bash
git add public/js/billing-ui.js public/js/configure.js public/css/configure.css
git commit -m "feat(ui): billing history portal (next payment + past payments)"
```

---

## Task 10: Per-server uptime history on the Health page (frontend)

**Files:**
- Modify: `public/js/health.js`
- Modify: `public/css/configure.css` (reuse existing styles where possible)

**Context:** Health server cards already have a "Show history" control. Extend it to fetch `/api/user/server-history` once and, per server (matched by URL), render uptime % (from `daily`) and a recent strip (from `recent`).

- [ ] **Step 1: Fetch + cache server history**

In `public/js/health.js`, add:

```js
let _svHistory = null;
async function getServerHistory() {
  if (_svHistory) return _svHistory;
  try { _svHistory = await (await fetch('/api/user/server-history', { credentials: 'same-origin' })).json(); }
  catch { _svHistory = { servers: [] }; }
  return _svHistory;
}
function uptimePct(daily) {
  const t = daily.reduce((a, d) => a + d.checks, 0), u = daily.reduce((a, d) => a + d.up_checks, 0);
  return t ? Math.round((u / t) * 1000) / 10 : null;
}
```

- [ ] **Step 2: Render history when "Show history" is expanded**

In the existing show-history handler, after the current history renders, append the durable history for the matching server URL:

```js
  const hist = await getServerHistory();
  const match = (hist.servers || []).find(s => s.url === serverUrl.replace(/\/+$/, ''));
  if (match) {
    const pct = uptimePct(match.daily);
    const days = match.daily.slice(0, 30).map(d =>
      `<div class="uh-day" title="${d.day}: ${d.up_checks}/${d.checks} up"><div class="uh-bar" style="height:${d.checks ? Math.round((d.up_checks/d.checks)*100) : 0}%"></div></div>`).join('');
    container.insertAdjacentHTML('beforeend',
      `<div class="uptime-hist"><div class="uh-head">Uptime ${pct != null ? pct + '%' : '—'} <span class="uh-sub">last ${match.daily.length} day(s)</span></div><div class="uh-bars">${days}</div></div>`);
  }
```

(Adapt `serverUrl` / `container` to the actual variables in the existing handler.)

- [ ] **Step 3: Style**

```css
.uptime-hist{ margin-top:12px; padding-top:10px; border-top:1px solid var(--border); }
.uh-head{ font-size:.78rem; font-weight:700; margin-bottom:8px; }
.uh-sub{ color:var(--text-dim); font-weight:400; font-size:.7rem; }
.uh-bars{ display:flex; gap:2px; align-items:flex-end; height:40px; }
.uh-day{ flex:1; height:100%; display:flex; align-items:flex-end; background:rgba(255,255,255,.04); border-radius:2px; }
.uh-bar{ width:100%; background:linear-gradient(180deg,var(--accent),var(--accent-2)); border-radius:2px; min-height:2px; }
```

- [ ] **Step 4: Manual verification**

After the pinger has logged ≥1 cycle for a logged-in user's servers, expand a server's history on `#/health`. Expected: an "Uptime X%" bar strip appears below the existing chart.

- [ ] **Step 5: Commit**

```bash
git add public/js/health.js public/css/configure.css
git commit -m "feat(ui): durable per-server uptime history on Health page"
```

---

## Task 11: Admin user-detail drawer + actions (frontend)

**Files:**
- Modify: `public/js/admin.js`
- Modify: `public/css/configure.css`

**Context:** Admin → Users list renders rows (`#admin-users-list`). Make each row open a detail modal (reuse `window.openModal`) showing Subscription / Payments / Activity / Servers and the action controls.

- [ ] **Step 1: Add a "Manage" action per user row**

In `public/js/admin.js` where each user row is built, add a button: `<button class="btn-soft" data-manage="${u.id}">Manage</button>`. Add a delegated click handler:

```js
document.addEventListener('click', async (e) => {
  const m = e.target.closest('[data-manage]');
  if (!m) return;
  const id = m.dataset.manage;
  const d = await (await fetch(`/api/admin/users/${id}/detail`, { credentials: 'same-origin' })).json();
  openUserManageModal(id, d);
});
```

- [ ] **Step 2: Render the modal**

```js
function openUserManageModal(id, d) {
  const money = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—');
  const date = x => x ? new Date(x).toLocaleString() : '—';
  const pays = (d.payments || []).map(p => `<div class="mrow">${date(p.paid_at)}<span class="mtag">${money(p)} · ${p.status}</span></div>`).join('') || '<div class="field-hint">No payments.</div>';
  const evs = (d.events || []).map(e => `<div class="mrow">${date(e.created_at)}<span class="mtag">${e.type}</span></div>`).join('') || '<div class="field-hint">No events.</div>';
  const servers = (d.servers || []).map(s => { const t = s.daily.reduce((a,x)=>a+x.checks,0), u = s.daily.reduce((a,x)=>a+x.up_checks,0); return `<div class="mrow">${s.label || s.url}<span class="mtag">${t?Math.round(u/t*100):0}% up</span></div>`; }).join('') || '<div class="field-hint">No history.</div>';
  window.openModal(`
    <div class="modal-head"><div><div class="modal-nm">Manage user</div><div class="modal-sub">${(d.subscription&&d.subscription.status)||'none'}</div></div><div class="modal-x" data-close>✕</div></div>
    <div class="modal-tabs"><button class="on" data-mt="sub">Subscription</button><button data-mt="pay">Payments</button><button data-mt="act">Activity</button><button data-mt="srv">Servers</button></div>
    <div class="modal-body">
      <div class="mtab on" id="mt-sub">
        <div class="field"><div class="field-label">Status</div>
          <select id="adm-status"><option>none</option><option>active</option><option>cancelled</option><option>past_due</option><option>comped</option></select></div>
        <div class="field"><div class="field-label">Access until (period end)</div><input class="input" id="adm-period" type="datetime-local" /></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-generate" id="adm-save" style="flex:1">Save override</button>
          <button class="btn-soft" id="adm-resync">Re-sync from PayPal</button>
        </div>
        <h3 class="block-title" style="margin-top:16px">Reset password</h3>
        <div style="display:flex;gap:8px"><input class="input" id="adm-pass" type="text" placeholder="new password (min 6)"/><button class="btn-soft" id="adm-pass-btn">Set</button></div>
        <div class="auth-err" id="adm-msg"></div>
      </div>
      <div class="mtab" id="mt-pay">${pays}</div>
      <div class="mtab" id="mt-act">${evs}</div>
      <div class="mtab" id="mt-srv">${servers}</div>
    </div>`);
  const sel = document.getElementById('adm-status'); if (sel && d.subscription) sel.value = d.subscription.status || 'none';
  const api = (path, body) => fetch(`/api/admin/users/${id}/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
  const msg = t => { const e = document.getElementById('adm-msg'); if (e) e.textContent = t; };
  document.getElementById('adm-save').onclick = async () => { const pe = document.getElementById('adm-period').value; const r = await api('subscription', { status: sel.value, periodEnd: pe ? new Date(pe).toISOString() : null }); msg(r.ok ? 'Saved' : (r.error || 'failed')); };
  document.getElementById('adm-resync').onclick = async () => { const r = await api('resync'); msg(r.ok ? 'Re-synced: ' + r.status : (r.error || 'failed')); };
  document.getElementById('adm-pass-btn').onclick = async () => { const r = await api('password', { password: document.getElementById('adm-pass').value }); msg(r.ok ? 'Password set' : (r.error || 'failed')); };
}
```

- [ ] **Step 3: Manual verification**

As admin on `#/users`, click Manage on a user. Expected: modal with four tabs; changing status + Save shows "Saved"; Re-sync returns a status (or a clear error if PayPal not configured); password set works.

- [ ] **Step 4: Commit**

```bash
git add public/js/admin.js public/css/configure.css
git commit -m "feat(admin): user management drawer (override, resync, password, history)"
```

---

## Task 12: Full verification + deploy

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all test files pass (existing + `payments.test.js` + `serverHistory.test.js`).

- [ ] **Step 2: Verify migration applies on a configured DB**

Deploy to main (`git push origin main`); watch Railway logs for `[migrate]` applying `005_history.sql` with no error. Confirm tables exist (Railway DB console or `\dt`).

- [ ] **Step 3: End-to-end smoke (live, as admin)**

- Billing page → portal renders (status/next/past).
- After one ping cycle, Health → a server's "Show history" shows uptime %.
- Admin → Users → Manage → override status, save, confirm it reflects in the list; events tab shows the `admin_override` row.

- [ ] **Step 4: Final commit (if any tweaks)**

```bash
git add -A && git commit -m "chore: billing history + uptime feature verification fixes"
git push origin main
```

---

## Self-Review Notes

- **Spec coverage:** payments (T1,T2,T5) ✓; billing_events audit (T1,T2,T4,T5,T8) ✓; server_health_log + daily rollup (T1,T3,T6) ✓; user billing portal (T9) ✓; user server history view (T7,T10) ✓; admin detail+override+resync+password (T8,T11) ✓; going-forward only / no backfill ✓ (no backfill task); 90-day prune (T3,T6) ✓.
- **Type consistency:** `makePayments`/`makeServerHistory` method names (`record`, `listForUser`, `addEvent`, `listEvents`, `logCheck`, `prune`) are used identically across routes/health. Endpoint shapes (`{servers:[{url,label,daily,recent}]}`, `{status,periodEnd,planPrice,upcoming,payments,events}`) match between producer and consumer.
- **Assumption to verify during execution:** exact variable names inside `pingHealthServers()` (Task 6) and the existing "Show history" handler (Task 10), and the password-hash helper in `lib/users.js` (Task 8 Step 6) — each step says to adapt to the real names.
