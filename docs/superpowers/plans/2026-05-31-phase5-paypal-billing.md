# Phase 5 (FINAL) — PayPal Subscriptions + Billing Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add recurring PayPal subscriptions that gate access: unpaid users see only Billing; paying/comped users get full access and a *working* manifest URL; lapsed/cancelled users are re-locked and their manifest stops serving. Admins manage discount codes and comp access.

**Architecture:** A `subscriptions` table is the source of truth for access. PayPal Subscriptions API (smart buttons + webhooks) drives `status`/`current_period_end`. The Phase 3 anti-sharing stub (`hasActiveAccess`) is replaced with a real check. Discount codes + comps live in our own DB (PayPal has no native coupons). Degrades gracefully: without PayPal env vars, billing is dormant and access stays open (as today).

**Tech stack:** Node + Express, `pg`, PayPal REST API via `node-fetch` (no SDK needed). Tests: fake-DB unit tests + live verification.

**Prerequisites (user-provided, PayPal dashboard + Railway):**
- A PayPal **app** → `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`.
- A **subscription product + plan** (e.g. $4/mo) → `PAYPAL_PLAN_ID`.
- `PAYPAL_ENV` = `sandbox` (testing) or `live`.
- (Optional later) `PAYPAL_WEBHOOK_ID` for webhook signature verification.

**Access rule (single source of truth):**
`hasAccess(user) = (subscription.status IN ('active','comped')) AND (status='comped' OR current_period_end > now())`. Admins always have access.

**Out of scope:** proration, multiple tiers, tax. One plan, monthly.

---

## Pre-flight
- [ ] **0a:** `git checkout -b phase5/paypal-billing && npm test` → all green (147+).
- [ ] **0b:** Confirm PayPal env vars present in the target environment (or note billing stays dormant).

---

## Task 1: Migration — subscriptions + discount codes
**Files:** `migrations/004_billing.sql`

- [ ] **Step 1: Write the SQL**
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'paypal' CHECK (provider IN ('paypal','comp')),
  paypal_subscription_id TEXT,
  status               TEXT NOT NULL DEFAULT 'none'
                         CHECK (status IN ('none','active','cancelled','past_due','comped')),
  current_period_end   TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discount_codes (
  code        TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('comp_100','percent_50','first_month_free')),
  active      BOOLEAN NOT NULL DEFAULT true,
  max_uses    INTEGER,
  uses        INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- [ ] **Step 2:** `node -e "require('./lib/migrate').runMigrations()"` → skips w/o DB (no crash). Commit.

---

## Task 2: Billing repo (`lib/billing.js`) — access checks, comps, codes
**Files:** `lib/billing.js`, `test/billing.test.js`

- [ ] **Step 1: Write fake-DB tests** covering:
  - `hasAccess` true for `active` with future period end; false for `active` past end; true for `comped`; false for `none`/`cancelled`.
  - `comp(userId)` sets status `comped`.
  - `setStatusFromPaypal(userId, paypalSubId, status, periodEnd)` upserts.
  - `redeemCode(userId, code)`: `comp_100` → comps the user + increments `uses`; invalid/inactive/maxed → rejected.
- [ ] **Step 2: Implement `makeBilling(db)`** with: `get(userId)`, `hasAccess(userId)` (applies the access rule; returns true for admins is handled by caller), `comp(userId)`, `cancel(userId)`, `setStatusFromPaypal(...)`, `createCode(...)`, `listCodes()`, `redeemCode(userId, code)`. Pure SQL via injectable `db`. (No `Date.now()` purity issue — this is app code, not a workflow script.)
- [ ] **Step 3:** Run tests → green. Add to `npm test`. Commit.

---

## Task 3: PayPal client (`lib/paypal.js`)
**Files:** `lib/paypal.js`, `test/paypal.test.js`

- [ ] **Step 1:** Implement: `isConfigured()` (env vars present), `baseUrl()` (sandbox vs live), `getAccessToken()` (OAuth client-credentials, cached), `getSubscription(id)` (GET subscription), `verifyWebhook(headers, body)` (stub returns true unless `PAYPAL_WEBHOOK_ID` set, then calls verify-webhook-signature). All via `node-fetch`.
- [ ] **Step 2:** Unit-test `isConfigured()` and `baseUrl()` (pure, env-driven). Network calls are integration-verified live. Commit.

---

## Task 4: Billing routes + webhook
**Files:** `routes/billing.js`; mount in `server.js`

- [ ] **Step 1: Implement** (auth-gated except webhook):
  - `GET /api/billing/status` → `{ status, hasAccess, planPrice, periodEnd }` for `req.user`.
  - `GET /api/billing/config` → `{ enabled, clientId, planId, env }` (public-ish; clientId is not secret) so the frontend can render PayPal buttons.
  - `POST /api/billing/activate` → body `{ subscriptionID }` from the approved PayPal button; server calls `paypal.getSubscription()` to verify it's ACTIVE and belongs to this plan, then `billing.setStatusFromPaypal(...)`.
  - `POST /api/billing/cancel` → mark cancelled locally (and optionally call PayPal cancel).
  - `POST /api/billing/redeem` → `{ code }` → `billing.redeemCode`.
  - `POST /api/billing/webhook` (NO auth) → verify signature, handle `BILLING.SUBSCRIPTION.ACTIVATED|CANCELLED|SUSPENDED` and `PAYMENT.SALE.COMPLETED` → update status / extend `current_period_end`.
- [ ] **Step 2:** DB-less/PayPal-less: every route 503s cleanly; webhook 200-no-op. Commit.

---

## Task 5: Flip the anti-sharing gate to real
**Files:** `server.js` (the `/u/:token` middleware), `lib/manifest.js`

- [ ] **Step 1:** In the `/u/:token` handler, replace the stubbed `hasActiveAccess(rec)` with a real check: load `req`-independent `billing.hasAccess(rec.user_id)` (admins always pass). If not allowed → `402 { error: 'subscription required' }`.
- [ ] **Step 2:** Keep `lib/manifest.js` `hasActiveAccess` as a thin default for tests, but the live path uses `lib/billing`. Add a fake-DB test asserting a `none`-status user is denied and an `active` user is served.
- [ ] **Step 3:** Verify locally (fake) + note: this means unpaid users' manifest URLs stop working. Commit.

---

## Task 6: Billing UI + access gating
**Files:** `public/js/billing.js`, `public/configure.html` (Billing page section + nav), `public/css/configure.css` (append)

- [ ] **Step 1:** Add a **Billing** page section + nav link. Render from `GET /api/billing/config` + `status`:
  - Unsubscribed → plan card ($/mo), PayPal smart buttons (load `https://www.paypal.com/sdk/js?client-id=<id>&vault=true&intent=subscription`), and a discount-code field.
  - Subscribed/comped → "active" state + renewal date + Cancel (managed in Settings per the earlier UX).
- [ ] **Step 2: Access gating** — extend the existing shell so that when `billing.enabled && !hasAccess && role!=='admin'`: hide all nav except Billing (reuse the prototype's `applyAccess` logic adapted to the real app), land on Billing; once access granted, reveal nav + hide the standalone Billing tab and surface subscription management in Settings.
- [ ] **Step 3:** PayPal button `onApprove` → `POST /api/billing/activate {subscriptionID}` → on success, re-fetch status, unlock UI, toast.
- [ ] **Step 4:** Commit.

---

## Task 7: Admin — discount codes + plan management
**Files:** `routes/admin.js` (extend), `public/js/admin.js` (extend), `configure.html` (admin Users/Billing section)

- [ ] **Step 1:** Admin API: `GET /api/admin/codes`, `POST /api/admin/codes` (create), `POST /api/admin/codes/:code/deactivate`; `POST /api/admin/users/:id/comp` (grant comp), `POST /api/admin/users/:id/uncomp`.
- [ ] **Step 2:** Admin UI: a "Discount codes" card (create/list/deactivate) + per-user comp toggle on the Users page (your "give a family member access" flow).
- [ ] **Step 3:** Commit.

---

## Task 8: Verify + deploy
- [ ] **Step 1:** `npm test` all green.
- [ ] **Step 2:** DB-less + PayPal-less smoke: billing routes 503, `/u/:token` still serves (access open when billing disabled), app fully usable.
- [ ] **Step 3:** Merge to main, push. Set PayPal env vars in Railway.
- [ ] **Step 4: Live verify (sandbox first):** register a user → Billing-only lockout → complete PayPal sandbox subscription → access unlocks, manifest serves → cancel → re-locked, manifest 402. Redeem a `comp_100` code → access without payment. Admin creates a code + comps a user.
- [ ] **Step 5:** Switch `PAYPAL_ENV=live` when ready.

---

## Self-Review (coverage)
- Spec §5 subscriptions table + access rule → Tasks 1, 2.
- PayPal integration (buttons, verify, webhooks) → Tasks 3, 4, 6.
- Anti-sharing enforcement flip → Task 5.
- Access-gating UI (Billing-only when unsubscribed; manage in Settings) → Task 6.
- Discount codes + comps (admin) → Tasks 2, 7.
- Degrade-gracefully (no PayPal env → dormant, app open) → Tasks 4, 5, 8.

**Security:** PayPal secret server-only; verify subscription server-side on activate (never trust client); webhook signature verification when `PAYPAL_WEBHOOK_ID` set; access always re-checked server-side on every `/u/:token` hit.
