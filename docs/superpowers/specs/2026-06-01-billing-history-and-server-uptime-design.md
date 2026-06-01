# Billing History Portal + Per-User Server Uptime History — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan

## Goal

Give each user a durable, database-backed view of:
1. **Billing history** — their current plan/status, the upcoming payment (date + amount), and a list of past payments.
2. **Server uptime history** — per-server online/offline + response-time history that persists and is always viewable.

Give the admin full visibility and control over any user's subscription, payments, audit trail, and server uptime — including manual fixes when a subscription isn't behaving.

All of this must be persisted in the Postgres database so nothing is lost across restarts/redeploys.

## Non-Goals

- No historical backfill of past PayPal payments. Payment capture is **going-forward only** (from the first webhook/activation after this ships).
- No new payment provider work; PayPal remains the only provider. Comps and discount codes are unchanged in behavior.
- No change to how access is gated (`subscriptions` remains the source of truth for `hasAccess`).
- No real-time "who's watching" / streaming-session tracking.

## Current State (baseline)

- `subscriptions` (migration 004): one row per user — `provider, paypal_subscription_id, status, current_period_end, updated_at`. Source of truth for access.
- PayPal webhook (`routes/billing.js`) handles `PAYMENT.SALE.COMPLETED` but only flips status to `active`; **individual payments are not recorded**.
- Admin (`routes/admin.js`) can list users, create/delete, set role, manage discount codes, comp/uncomp. **Cannot** see payments or any per-user history.
- Health monitoring (`lib/health.js`) pings a **global, URL-keyed** server list and keeps a rolling ~7-day window (`MAX_HEALTH_ENTRIES = 2016`) in a JSONB blob (`health_state`) + JSON file. **Not per-user, not durable long-term.**

## Architecture Overview

Two related subsystems sharing DB persistence and admin surfacing:

- **A. Billing history + admin control** — new `payments` and `billing_events` tables, capture logic in the billing routes, a rebuilt user Billing page, and an admin user-detail drawer with actions.
- **B. Per-user server uptime history** — new `server_health_log` (raw, pruned) + `server_uptime_daily` (permanent rollup) tables, writes from the health pinger, and history views for user + admin.

### Module boundaries

- `lib/payments.js` (new) — `makePayments(db)`: `record(...)`, `listForUser(userId)`, audit helpers for `billing_events`. One purpose: persist + read billing history. Depends on `db`.
- `lib/serverHistory.js` (new) — `makeServerHistory(db)`: `logCheck(...)`, `rollupDay(...)`, `listForUser(userId)`, `prune()`. One purpose: persist + read per-user uptime. Depends on `db`.
- Existing `lib/billing.js` extended only where status changes should also emit a `billing_events` audit row.
- Routes: extend `routes/billing.js` (user payment history endpoints), `routes/admin.js` (per-user detail + admin actions), `routes/user.js` or new endpoint for server uptime history.

## Data Model — migration `005_history.sql`

```sql
-- Past payments (going-forward capture from PayPal)
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paypal_sale_id  TEXT UNIQUE,           -- dedupe webhook retries; NULL for manual/comp entries
  amount          NUMERIC(10,2),
  currency        TEXT DEFAULT 'USD',
  status          TEXT NOT NULL DEFAULT 'completed',  -- completed | refunded | failed
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, paid_at DESC);

-- Billing audit trail: lifecycle + admin actions; powers portal timeline & admin debugging
CREATE TABLE IF NOT EXISTS billing_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- activated|cancelled|past_due|comped|uncomped|code_redeemed|payment|admin_override|resync
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,  -- admin who acted; NULL = system/self
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id, created_at DESC);

-- Per-user raw server checks (detailed recent view; pruned > 90 days)
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

-- Permanent per-user daily uptime rollup ("always viewable" long-term history)
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

All tables `ON DELETE CASCADE` from `users`, so deleting a user cleans up their history.

## Capture Logic

### Payments + billing events (backend)
- **Webhook `PAYMENT.SALE.COMPLETED`**: in addition to the existing status update, insert a `payments` row (resolve `user_id` via `subscriptions.paypal_subscription_id = billing_agreement_id`; `paypal_sale_id = resource.id`; amount/currency from `resource.amount`). Insert is idempotent on `paypal_sale_id` (`ON CONFLICT DO NOTHING`) to survive webhook retries. Append a `billing_events` row `type='payment'`.
- **`/activate`**: append `billing_events` `type='activated'`. (PayPal's first payment will also arrive as a webhook → recorded there; no double-count thanks to the unique `paypal_sale_id`.)
- **Lifecycle** (cancelled/past_due) and **comp/uncomp/redeem**: each appends a `billing_events` row with `actor_id` set for admin actions.

### Server uptime (backend)
- The pinger continues to ping each **unique** URL once per cycle (efficiency). After each cycle, for every (user, server) pairing among stored user configs, write a `server_health_log` row using that cycle's result, and upsert the matching `server_uptime_daily` row (`checks+1`, `up_checks += up?1:0`, running `avg_ms`).
  - The per-(user,server) mapping comes from `user_config.config_json -> servers[].url`.
- A daily `prune()` deletes `server_health_log` rows older than 90 days. Rollups are never pruned.
- The existing in-memory rolling window stays for the live Health sparklines (no regression); the new tables add durability + per-user history.

## API Endpoints

User (auth required, own data only):
- `GET /api/billing/history` → `{ status, periodEnd, planPrice, upcoming: {date, amount}, payments: [...], events: [...] }`
- `GET /api/user/server-history` → `{ servers: [{ url, label, daily: [...], recent: [...] }] }`

Admin (admin only):
- `GET /api/admin/users/:id/detail` → subscription + payments + billing_events + server uptime summary
- `POST /api/admin/users/:id/subscription` → manual override `{ status, periodEnd }` (writes `admin_override` event)
- `POST /api/admin/users/:id/resync` → re-fetch from PayPal via `paypal.getSubscription`, update `subscriptions`, write `resync` event
- `POST /api/admin/users/:id/password` → reset password (writes audit; reuses `users` lib)
- (existing comp/uncomp now also write `billing_events`)

## UI

- **User Billing page (rebuild):** status/plan card → **Next payment** (date + amount, derived from `current_period_end` + plan price) → **Past payments** table (date, amount, status) → optional collapsible **activity** timeline from `billing_events`. Matches existing glassy card/accordion design system.
- **User Health page:** each server card's "Show history" expands to uptime % (from daily rollups) + a recent checks strip (from raw log) — extends the existing per-server card.
- **Admin → Users:** clicking a user opens a detail drawer/modal (reuse the existing modal shell) with tabs: Subscription (status, next bill, override + resync controls), Payments (table), Activity (events), Servers (uptime summary), plus Reset password. All actions confirm and refresh.

## Error Handling

- All new DB writes are wrapped; failures log and never break the request path (especially the webhook, which must always return 200 to avoid PayPal retry storms, and the pinger, which must keep running).
- Payment insert dedupes on `paypal_sale_id` (`ON CONFLICT DO NOTHING`).
- Endpoints degrade gracefully when `db.isConfigured()` is false (return empty history / 503 as the existing routes do).
- Admin override validates `status` against the allowed enum and `periodEnd` as a valid date.

## Testing

Follow the existing `test/*.test.js` node-based pattern:
- `payments.test.js` — record (incl. dedupe on duplicate sale id), listForUser ordering, event append.
- `serverHistory.test.js` — logCheck, daily rollup math (checks/up_checks/avg_ms), prune cutoff, listForUser shape.
- `billing.test.js` (extend) — status changes emit billing_events; admin override + resync write audit rows.
- Route-level: history endpoints return own-user data only; admin endpoints enforce `requireAdmin`.

## Rollout / Migration

- `005_history.sql` is additive (all `CREATE TABLE IF NOT EXISTS`); no changes to existing tables. Safe on deploy via the existing `lib/migrate.js` runner.
- No data backfill. History accrues from deploy time.

## Open Questions / Future

- Retention of `server_health_log` raw rows is fixed at 90 days; revisit if users want longer raw detail.
- `billing_events` activity timeline in the user portal is optional polish; can ship admin-only first if scope needs trimming.
