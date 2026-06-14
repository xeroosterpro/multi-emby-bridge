# multi-emby-bridge — Code Review Report

**Date:** 2026-06-13  
**Stack:** Node.js 18+, Express, PostgreSQL, vanilla JS SPA  
**Reviewer:** Grok Composer (automated deep review)

---

## Executive Summary

Stream Hub is a capable Stremio addon with a well-structured `lib/` layer, 45+ automated tests, and thoughtful production patterns (graceful shutdown, SSRF guards on server URLs, encrypted catalog API keys, subscription gating). Prior review risks — catalog proxy auth gaps, plaintext Emby credentials at rest, and monolithic `server.js` / `configure.js` — have been addressed in this cycle.

**Implemented in this review cycle:**
- SSRF guard on Letterboxd catalog fetches
- Production auth on catalog browse/validate, addon-catalogs, legacy profiles
- Health history locked down in production (no anonymous `?urls=` probing)
- Encrypted per-server Emby/Jellyfin credentials (`servers_enc` migration 013)
- Merge-on-save so partial config updates don't wipe stored secrets
- Targeted error logging (replacing silent catches in auth/request-log paths)
- Orphaned tests wired into `npm test`; new SSRF + server-cred tests
- HTTP integration tests for production auth gates (`test/serverAuth.integration.test.js`)
- HTTP integration tests for SSRF on `/api/fetch-credentials`, `/api/test-connection`, `/api/library-stats` (`test/apiSsrf.integration.test.js`)
- Configure page + module smoke tests (`test/configureModules.test.js`, `test/configurePage.integration.test.js`)
- GitHub Actions CI (`.github/workflows/test.yml`)
- `server.js` split into `lib/createApp.js`, `routes/*` (~115-line entry)
- `configure.js` modularized into `public/js/configure/*.js` (20 modules, ~90-line orchestrator; dashboard split into shared, health, library, cards, live, activity, bundle, render, and page modules)
- `server.js` exportable for testing (`require.main` guard)
- Configure UI shows "saved (hidden)" placeholders for encrypted server creds
- README added

---

## Architecture

### What it does

1. **Stremio protocol** — Serves `manifest.json`, `catalog/*`, `stream/*` per Stremio addon spec
2. **Multi-server bridge** — Queries all configured Emby/Jellyfin servers for IMDB-matched content; ranks audio streams
3. **Web configurator** — SPA at `/configure` for servers, catalogs, themes, health dashboard
4. **Hosted platform** (with Postgres) — User accounts, encrypted secrets, revocable manifest tokens, PayPal billing, admin panel

### Config flow

| Mode | Manifest URL | Credential storage |
|------|--------------|-------------------|
| Legacy | `/:config/manifest.json` (base64 JSON in URL) | In URL (visible in logs/history) |
| Hosted | `/u/:token/manifest.json` | Postgres + AES-256-GCM |

The `/u/:token` handler loads decrypted config and re-dispatches through existing `/:config/*` handlers via `app.handle()`.

### Hot path

`GET /:config/stream/:type/:id.json` → `getAllStreams()` → parallel `Promise.allSettled` across servers → PlaybackInfo per match → audio ranking sort.

---

## Findings by Severity

### P0 — Critical (fixed)

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| S1 | Letterboxd RSS fetched user URL without SSRF check | `lib/catalogs.js` | **Fixed** — `assertSafeFetchUrl` before fetch |
| S2 | `/api/catalog/validate`, `/api/catalogs/browse-*` unauthenticated in production | `server.js` | **Fixed** — `requireAuthInProduction` |
| S3 | `/api/addon-catalogs` no production auth | `server.js` | **Fixed** |
| S4 | Emby/Jellyfin `apiKey`/`password` plaintext in `config_json` | `lib/userConfig.js` | **Fixed** — `servers_enc` column + migration 013 |
| S5 | `/api/health/history?urls=` allowed anonymous URL enumeration | `server.js` | **Fixed** — auth required in production; `?urls=` dev-only |

### P1 — High

| ID | Finding | Location | Status |
|----|---------|----------|--------|
| H1 | Legacy profile save/load (HMAC, not scrypt) without prod auth | `lib/profiles.js`, `server.js` | **Fixed** — prod auth gate |
| H2 | Request log readable without production middleware consistency | `server.js` | Already required `req.user`; no change needed |
| H3 | Silent `catch {}` masks failures | `lib/auth.js`, `server.js`, `lib/userConfig.js` | **Partially fixed** — warnings added in critical paths |
| H4 | No README | project root | **Fixed** |
| H5 | Legacy base64 config URLs leak credentials | `server.js` `decodeConfig` | **Documented** — README warns; hosted `/u/:token` recommended |

### P2 — Medium

| ID | Finding | Recommendation | Status |
|----|---------|----------------|--------|
| M1 | `server.js` monolith (~1250 lines) | Extract Stremio routes, API routes, middleware into modules | **Fixed** — `lib/createApp.js`, `routes/*` |
| M2 | `configure.js` (~5700 lines) | Split by page concern (servers, dashboard, install) | **Fixed** — 20 modules + ~90-line orchestrator |
| M3 | No CI test step before Railway deploy | Add GitHub Actions `npm test` on push | **Fixed** |
| M4 | Postgres SSL `rejectUnauthorized: false` | Acceptable on Railway; use proper CA in self-hosted deploys | Deferred |
| M5 | 3 orphaned tests | Wire into `npm test` | **Fixed** |

### P3 — Low (deferred)

| ID | Finding | Recommendation |
|----|---------|----------------|
| L1 | Console-only logging | Adopt Pino/Winston with log levels |
| L2 | Per-process rate limits | Redis-backed limiter for multi-instance |
| L3 | Unbounded in-memory caches | Add TTL + max-size eviction on `_watchHistCache`, rate limiter maps |
| L4 | `process.exit(1)` on unhandled rejection | Monitor; consider softer handling for known-transient fetch errors |

---

## Code Quality Assessment

### Strengths

- **Pure `lib/` modules** are testable and focused (`streams.js`, `audioRanking.js`, `urlSafety.js`, `dashboard/bundle.js`)
- **Fake-DB test pattern** works well without a test framework
- **Graceful degradation** when `DATABASE_URL` absent
- **SSRF protection** on server URL endpoints (fetch-credentials, test-connection, ping-servers, health register)
- **Security headers** on `/configure` (CSP, X-Frame-Options)
- **Subscription gate** on `/u/:token/*` when PayPal configured
- **Partial failure tolerance** in dashboard bundle (`errors[]` array, `Promise.allSettled`)

### Weaknesses

- **Dual config paths** (legacy URL vs hosted token) increase test matrix
- **CORS `*`** required for Stremio — accepted risk; only `/api/*` should be locked down (per your review note)
- **getEditable** no longer returns server credential values — frontend relies on `hasApiKey` flags + localStorage merge; new-device login requires re-entering keys (correct security tradeoff)
- **HTTP integration tests** cover auth gates and SSRF; full Postgres + Emby/Jellyfin matrix still manual

---

## Test Plan

### Automated (run locally)

```powershell
cd "C:\Users\Master Warlock\Desktop\multi-emby-bridge"
npm test
```

**New tests added:**
- `test/catalogsSsrf.test.js` — Letterboxd private IP blocked
- `test/userConfig.test.js` — server cred encryption + merge-on-save
- `test/serverAuth.integration.test.js` — production auth on `/api/*`
- `test/apiSsrf.integration.test.js` — SSRF blocks on server API routes
- `test/configureModules.test.js` — configure split file/order guards
- `test/configurePage.integration.test.js` — `/configure` + JS assets served correctly

### Manual integration matrix (Postgres + Emby/Jellyfin)

| # | Scenario | Pass criteria |
|---|----------|---------------|
| 1 | `npm start` with `.env` | Migrations through 013 apply; `/health` 200 |
| 2 | Register → login | `meb_session` cookie; `/api/auth/me` returns user |
| 3 | Save server config | `servers_enc` populated; `config_json` has no `apiKey` |
| 4 | `/u/:token/manifest.json` | Valid Stremio manifest |
| 5 | Stream lookup (known IMDB ID) | Streams returned; logged in request log |
| 6 | Catalog browse (Trakt/MDbList) | Requires sign-in in production |
| 7 | Health register + history | History scoped to user's servers only |
| 8 | Dashboard bundle `?scope=full` | No fatal errors; live sessions populated |
| 9 | SSRF negative: `POST /api/test-connection` with `http://127.0.0.1` | 400 blocked |
| 10 | Auth negative: unauthenticated catalog validate (prod) | 401 |
| 11 | Stremio E2E | Install manifest → browse → play stream |

### Performance smoke

- 10× stream lookup same IMDB ID across 3+ servers — check `ms` in request log
- Dashboard poll 5s × 2min — no memory spike, no unhandled rejections

---

## Recommendations (Prioritized)

### Do next

1. Consider encrypting `userId` field if treated as sensitive
2. Further split `dashboard-page.js` render path if it grows again
3. Manual Postgres + Emby/Jellyfin integration matrix (see Test Plan)

### Do later

1. ~~Split `server.js`~~ — **Done** (`lib/createApp.js`, `routes/stremio.js`, `routes/bridgeApi.js`)
2. ~~Modularize `configure.js`~~ — **Done** (20 modules under `public/js/configure/`)
3. ~~CI + integration tests~~ — **Done** (GitHub Actions, auth/SSRF/configure smoke)
4. Structured logging
5. Shared rate-limit store for Railway horizontal scaling

---

## Files Changed in This Review

| File | Change |
|------|--------|
| `lib/catalogs.js` | SSRF guard on Letterboxd |
| `lib/userConfig.js` | Server cred encryption, merge-on-save, lazy migration |
| `lib/auth.js` | Warning logs instead of silent catches |
| `server.js` | Auth on catalog/profile/addon endpoints; health history lockdown |
| `migrations/013_server_creds_enc.sql` | New `servers_enc` column |
| `test/userConfig.test.js` | Server cred tests |
| `test/catalogsSsrf.test.js` | Letterboxd SSRF test |
| `package.json` | Orphaned tests + new tests in `npm test` |
| `README.md` | Project onboarding |
| `REVIEW_REPORT.md` | This document |