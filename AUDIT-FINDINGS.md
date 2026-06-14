# Stream Hub — Elite Audit Findings

**Audit date:** 2026-06-14
**Scope:** Code/backend (Stage 1) + live Railway website (Stage 2, pending URL)
**Method:** Fix-as-we-go in reviewable batches. Severity: Critical / High / Medium / Low.
Each fix is verified with the existing `test/*.test.js` suite (plus new targeted tests).

> This supplements the prior `REVIEW_REPORT.md` (Grok, 2026-06-13). Items here are
> *new* findings from this deeper pass, or things that report missed.

---

## Stage 1 — Code & Backend

### Security

| ID | Sev | Finding | Location | Status |
|----|-----|---------|----------|--------|
| SEC-1 | **High** | `/api/auth/login` & `/api/auth/register` have **no rate limiter** — brute-force / credential-stuffing open. An `authLimiter` (10/min) exists but is only wired to profile/credential routes, not the actual login endpoints. | `lib/createApp.js:60`, `routes/auth.js` | **Fixed** |
| SEC-2 | **High** | `userConfig.getForServe()` re-encrypts + re-writes the full config row on **every call** (manifest/stream hot path). `hasPlaintext` is computed from `cfg.servers` *after* `applyServerCreds()` re-injects decrypted creds, so it's always truthy → infinite lazy-"migration". | `lib/userConfig.js:156-172` | **Fixed** |
| SEC-3 | Medium | Login user-enumeration timing oracle: `verifyPassword` is skipped when the username doesn't exist, so "no such user" returns measurably faster than "wrong password". | `routes/auth.js:58-61` | **Fixed** |
| SEC-4 | Medium | Discount-code redemption is check-then-increment (TOCTOU). Concurrent redeems can exceed `max_uses`. No per-user cap either (same user can redeem repeatedly). | `lib/billing.js`, `migrations/014_discount_redemptions.sql` | **Fixed** — atomic claim + per-user `discount_redemptions` ledger (one redeem per user/code) |
| SEC-5 | Medium | `/api/billing/cancel` flipped local status to `cancelled` but never called PayPal's cancel API — the subscription kept billing the customer. | `routes/billing.js:85-88` | **Fixed** — calls `paypal.cancelSubscription()` before local cancel; treats 404/422 as already-done |
| SEC-6 | Medium | SSRF guard validated the URL pre-fetch, but `node-fetch` then **followed redirects** and re-resolved DNS — bypassable via 30x→internal-IP or DNS-rebinding. Affected test-connection, fetch-credentials, ping, reauth, health, catalogs. | `lib/auth.js`, `lib/urlSafety.js` | **Fixed** — custom validating `dns.lookup` on a shared agent re-checks the connect-time IP on every hop; redirects capped at 5 |
| SEC-7 | Low | `isPrivateIp` misses CGNAT `100.64.0.0/10` and some IPv6 forms. | `lib/urlSafety.js:9-33` | **Fixed** |
| SEC-8 | Low | CORS `*` applied to all routes incl. `/api/*`. Mitigated today by `SameSite=lax` cookies + no `Allow-Credentials`, so cross-site reads can't carry the session. Recommend scoping CORS to Stremio routes only. | `lib/createApp.js:44-50` | Noted |
| SEC-9 | Low | PayPal webhook: signature verified against re-serialized JSON (not raw body) and handler returns 200 even when post-verification processing throws (silent event loss). | `routes/billing.js:98-136`, `lib/paypal.js:42-61` | Noted |
| SEC-10 | Low | Per-process unbounded in-memory maps (`tokenCache`, `_dedupCache`, rate-limiter `hits`) and rate-limiter `setInterval` not `unref()`'d. | `lib/utils.js`, `lib/auth.js` | **Partial fix** (unref) |

**Verified non-issues** (checked, no action):
- Admin self-delete / self-demote guards (`req.params.id === req.user.id`) — IDs are UUIDs (strings) on both sides, so the comparison works correctly.
- AES-256-GCM crypto (`lib/crypto.js`): random 12-byte IV, auth tag, key length enforced — sound.
- scrypt password hashing + `timingSafeEqual` verify — sound.
- Session tokens: 32 random bytes, SHA-256 hashed at rest, server-generated (no fixation vector), destroyed on logout, expiry enforced in lookup query.

### Logic & correctness

| ID | Sev | Finding | Location | Status |
|----|-----|---------|----------|--------|
| LOG-1 | Low/Perf | Stream hot path did a `getEditable` DB read (and a re-save) on **every** successful stream for a signed-in user, just to set `onboarding.testedStream` — even years after onboarding. The re-save also leaked `hasApiKey/hasUsername/hasPassword` flags into `config_json`. | `routes/stremio.js:264` | **Fixed** — in-memory "tested" set short-circuits after first set; flags stripped before save |
| LOG-2 | Low | `migrate.js` swallows a failed migration (logs, doesn't rethrow) so the server boots on a possibly-incomplete schema. This is a deliberate deploy-safety tradeoff; multi-statement `.sql` runs atomically under PG's simple-query protocol, so no partial-apply — but a genuinely broken migration fails silently. | `lib/migrate.js:21-25` | Noted (recommend louder/fail-fast in prod) |
| LOG-3 | Low | `streams.js` sets `_serverDown: down || true` on the error/timeout branch — always `true`, making the computed `down` dead. Behavior (errored servers sort last) is fine; the `down ||` is redundant. | `lib/streams.js:395` | Noted (cosmetic) |
| LOG-4 | Low | `manifest.js` in-memory store + `hasActiveAccess()` stub (`return true`) are superseded by the DB-backed `manifestStore` + `billing.hasAccess()` gate used in production — effectively dead code. | `lib/manifest.js:22-54` | Noted |

**Verified correct:** health down-detection (`isServerDown`/`detectDownServers` use `slice(0, n)` against newest-first history written via `unshift` — correct); manifest-token revoke/regenerate semantics; request-log user attribution for the `/u/:token` path (`req._mebUserId` survives the internal `app.handle()` re-dispatch).

### Performance

| ID | Sev | Finding | Location | Status |
|----|-----|---------|----------|--------|
| PERF-1 | High | (= SEC-2) Per-serve encrypt + DB write on the manifest/stream hot path. | `lib/userConfig.js` | **Fixed** |
| PERF-2 | Low | (= LOG-1) Per-stream DB read/write for the onboarding flag. | `routes/stremio.js` | **Fixed** |
| PERF-3 | Low | Unbounded in-memory maps (`tokenCache`, `_dedupCache`, rate-limiter `hits`). Bounded in practice by user/config count; sweeper timer now `unref()`'d (SEC-10). | `lib/auth.js`, `lib/utils.js` | Noted |

**Verified good:** DB hot paths are indexed (`request_log(user_id, ts DESC)` & `(ts DESC)`, `manifest_tokens(user_id)` + token PK, `sessions(token_hash)`); dashboard `/api/dashboard/bundle` is scope-parameterized (`full|live|stats|health`) with `Promise.allSettled` partial-failure tolerance and per-server timeouts; pool sized deliberately small (`max:4`) for Railway redeploys.

---

### Stage 1 verification
- `npm test` — **all suites green (exit 0)** after every batch, incl. the HTTP
  integration tests that spawn a real server in production mode.
- New/updated regression tests: `userConfig` (no hot-path re-save), `billing`
  (atomic redeem), `urlSafety` (CGNAT + safe-agent/lookup wiring).
- Boot: exercised by `serverAuth.integration.test.js` (real `server.js`,
  `NODE_ENV=production`, `/health` → 200).
- Aikido SAST/secrets scan: **not run** — the MCP server requires an interactive
  browser sign-in. Run it yourself anytime (sign in to Aikido, then re-scan the
  diff); the manual review above is the primary signal.

---

## Stage 2 — Live Railway Website

Audited the deployed site (`multi-emby-bridge-production.up.railway.app`) signed in as
admin (`Eli`), driving it with a real browser (desktop + 390px mobile).

> **Important:** the deployed build (`v=8f057d4`) is running **older, pre-modularization
> code** (monolithic `configure.js`). Some findings below are already different in your
> working tree; each is tagged. **Frontend/CSP fixes only take effect after you redeploy.**

### What works well (verified live)
- Login/session, Install page (manifest URL, QR, regenerate, Open in Stremio), Connections
  page (5 servers, bridge ping, online/offline + retry), Dashboard (KPIs, server cards,
  health sparklines, activity feed), Admin·System (vitals, platform pulse, tab toggles,
  announcement editor). All render cleanly and **degrade gracefully** (e.g. "Nothing playing"
  when session probes fail). Mobile layout stacks correctly with a hamburger drawer.
- Invite-only is enabled (`registrationOpen: false`); manifest uses the secure `/u/:token` form.

### Findings

| ID | Sev | Finding | Location | Status |
|----|-----|---------|----------|--------|
| LIVE-1 | **High** | `ReferenceError: _dashConsoleIdleTimer is not defined` thrown on **every non-dashboard page show**, aborting the rest of `onPageShow` (e.g. `Controls.syncAll()` and chained module hooks never run). Dead reference left over from the dashboard module split. Present in local code too. | `public/js/configure.js:27` | **Fixed** (guarded with `typeof`) |
| LIVE-2 | **High** | CSP `script-src 'self' 'unsafe-inline'` blocks the PayPal SDK → the billing page shows "Could not load PayPal" and **subscribe is impossible** in production. CSP also lacks `frame-src`/`connect-src`/`img-src` for PayPal. Present in local `lib/security.js`. | `lib/security.js` | **Fixed** (PayPal domains allow-listed) |
| LIVE-3 | Medium | CSP `connect-src 'self'` blocks the **client-side Emby probing** the dashboard relies on — live "now playing" sessions and the per-server "YOU" connection test (shows "—"). This probing is deliberate: it bypasses WAFs that block datacenter IPs (same reason the backend spoofs a browser UA). Can't statically list arbitrary user servers in CSP. | `lib/security.js`, `public/js/demo-mode.js`, `dashboard-shared.js` | **Fixed** — `connect-src 'self' https:` (script/frame stay locked to self+PayPal) |
| LIVE-4 | Medium | `/api/server-sessions` returns **502** for these servers — the backend's `/Sessions` probe fails even though `/System/Ping` succeeds (servers likely block the datacenter IP on that endpoint). | `routes/bridgeApi.js:405`, `lib/sessions.js` | **Mitigated** by LIVE-3 — the browser now reaches these servers directly (where Railway can't); backend remains a graceful fallback |
| LIVE-5 | Low | Console floods with errors on every navigation (LIVE-1 ×3-5 + CSP ×N). Purely a symptom of LIVE-1/2/3; resolving those clears it. | — | Resolves with above |

### Stage-2 verification — ✅ confirmed live (deploy `302c845`)
Merged to `main` → Railway deployed in ~30s → re-driven on production (cache-busted):
- **LIVE-1** ✅ `_dashConsoleIdleTimer` ReferenceError **gone** on every page (was firing 3-5×/nav).
- **LIVE-2** ✅ PayPal SDK no longer CSP-blocked (the `script-src` violation is gone). Admin
  account sees the billing "history" view, so the button itself renders only for non-subscribers.
- **LIVE-3** ✅ Browser now **connects directly to the Emby servers** (real HTTP responses, e.g.
  a `401` from a server with a stale key) instead of CSP `connect-src` blocks. Console errors
  per page dropped from ~48-79 to ~8-10.
- **LIVE-4** Backend `/api/server-sessions` still `502`s for WAF'd servers (expected), but the
  now-working client-side path compensates.
- **No regressions:** dashboard, install, connections, health, request-log, catalogs, admin
  all render correctly with zero new JS/CSP/500 errors. Mobile layout verified.

### Residual (deferred, low priority)
- One demo/real server (`emby.ompremium.cc`) returns `401` — stale/invalid API key (data, not a bug).
- `/api/server-sessions` 502 noise: could be suppressed by not attempting the backend probe
  for servers the client can reach directly.
- ~~Per-user discount-code cap~~ — **done** (`discount_redemptions` ledger, migration 014).
- PayPal webhook raw-body verification; structured logging; CORS scoping (SEC-8). All low severity.
