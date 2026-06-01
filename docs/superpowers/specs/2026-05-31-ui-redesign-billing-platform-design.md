# Design: UI Redesign + Billing & Multi-User Platform

**Date:** 2026-05-31
**Status:** Approved design, pending implementation planning
**Visual reference:** `.superpowers/brainstorm/2574-1780256349/content/redesign-prototype-v10.html` (and v1–v9 for iteration history)

## Overview

Two intertwined efforts:

1. **A full visual redesign** of the addon's web UI — a dark, animated, themeable single-page app with a hover-expand sidebar, replacing the current long-scroll `configure.html`.
2. **A multi-user platform layer** — accounts, PayPal subscriptions, an admin panel, a Postgres database, encrypted API-key storage, per-user revocable manifest URLs, and persistent health history.

Because these are large and partly independent, the work is split into **phases** (below). Each phase becomes its own implementation plan. Phase 1 (frontend) ships value immediately and has no backend dependencies; Phases 2–5 build the platform.

### Goals
- A polished, "feels smooth," themeable UI that looks complete when pushed to Railway.
- Per-user accounts with secure, subscription-gated access to manifest generation.
- API keys stored encrypted at rest in Postgres.
- Health/uptime/ping history that survives refreshes and restarts.
- An admin panel for system monitoring, user management, discount codes, and comping plans.

### Non-goals (this design)
- Stopping a determined user from *manually copying* a URL string (impossible at the protocol level). We mitigate via subscription-gating + revocation, not DRM.
- Migrating away from the existing catalog-fetching logic (`lib/catalogs.js`) — it stays.
- Mobile-native apps. The UI is responsive web only.

---

## Phase 1 — Frontend redesign (no backend)

A self-contained visual overhaul of the existing client-side configurator. Everything here works against the current architecture (config encoded into the install link); no server changes required.

### 1.1 Shell & navigation
- **Single-page app** driven by the existing hash router (`shell.js`). Sections are `#page-<name>` divs toggled with `.on`.
- **Hover-expand sidebar**: rests as a 66px icon rail; expands to 218px on hover (and tap on touch via a floating menu button under 600px). Icons sit in a fixed centered slot so they're centered when collapsed and align with labels when expanded.
- Nav grouped into sections: **Overview** (Dashboard, Servers), **Configuration** (Catalogs, Streaming, Appearance, API Keys), **Monitoring** (Health, Ping test, Request log), plus bottom items (Billing, Install, Settings) and an admin-only **Administration** group (System, Users).
- **Page transitions**: each section fades + scales in (`flowin`, ~340ms) on navigation.

### 1.2 Theme system
- One canonical `:root` of CSS custom properties (consolidating the current two competing `:root` blocks in `configure.css`).
- Each theme is a `[data-theme="…"]` override block on `<html>`: **purple (default), red, pink, blue, rgb**. Each defines `--accent`, `--accent-2` (contrast pair), `--glow`, and background tints.
- **RGB** theme uses an `@property --hue` + keyframe to cycle the accent through the spectrum.
- A small `theme.js` sets `document.documentElement.dataset.theme` and persists to `localStorage`. Default is purple.
- **Reduce-motion** toggle (Settings) + `prefers-reduced-motion` media query pause all animation.

### 1.3 Animated background
- Layered, theme-aware: 3 large blurred drifting **orbs** behind a dense field of ~72 **falling particles** (gentle "snowfall"/stipple, randomized size/speed/sway). Re-tints with the active theme. Paused by reduce-motion.

### 1.4 Components
- **Server cards**: accent top-bar, branded Emby/Jellyfin line-icons, live status badge, library stat chips; lift + glow on hover. On the Dashboard, clicking a card opens a **detail modal** (tabs: Overview / Health / Ping / Watching).
- **Accordions** (Catalogs, Streaming): collapsible sections, status pills on headers, fluid open/close animation. Overflow is enabled only after the open transition settles (timer-based, cancel-safe) so dropdowns can escape without the "snap" bug. **Multiple open allowed.** Wide screens use an **independent masonry-column layout** (`column-count`) so expanding one accordion only grows its own column (no linked-row gaps/overlap).
- **Custom dropdowns**: replace all native `<select>`s. Transparent button with theme-tinted border (no solid black box), animated popup list with accent checkmark on the selected option; opening one closes others; click-outside closes. The card/accordion containing an open dropdown is elevated (`:has(.dd.open) → z-index`) so the menu paints over neighbors, and its container allows overflow.
- **Brand marks**: Trakt / MDBList / IMDb / Letterboxd rendered as inline SVG (`<symbol>` + `<use>`). For production these become bundled official brand SVGs under `public/img/brands/`.
- **No emoji** in UI chrome — all line-art SVG icons.
- **Selection hygiene**: `user-select:none` on chrome (buttons, nav, labels, cards); inputs and `.allow-select` (e.g. manifest URL) stay selectable/copyable.

### 1.5 Pages (Phase 1 versions, client-side)
Dashboard, Servers, Catalogs, Streaming, Appearance, Health, Ping test, Request log, Install, Settings. The Dashboard stat cards are clickable shortcuts (Fastest ping → Ping test, etc.). Dashboard auto-refreshes every 5s (no manual refresh button) — in Phase 1 this re-pings client-side like the existing Ping Test. Server cards open a detail modal (Overview/Health/Ping/Watching).

### 1.5a User preferences (Settings)
- **UI scale**: a slider (80%–130%) that scales the whole interface via `document.documentElement.style.zoom`. Persisted in `localStorage`.
- **Sidebar lock (pin)**: a pin button in the sidebar + a matching Settings toggle keep the sidebar expanded persistently (`.locked`); content margin shifts to the expanded width. Persisted in `localStorage`.
- **Reduce motion** and **theme** also persisted in `localStorage`.

### 1.5b Access-gating scaffold (UI only in Phase 1; enforced server-side in Phase 4)
- The shell supports a `subscribed` state: when **unsubscribed**, only the **Billing** nav item is shown (raised to the top of the rail by collapsing the flex spacer) and all other pages are hidden; when **subscribed**, all tabs show, the **Billing tab is hidden**, and subscription management (plan change / cancel) lives in **Settings**.
- In Phase 1 this state is a client flag for layout; in Phase 4 it is driven by real subscription status from the server. Admin users bypass the gate.

### 1.6 Files touched (Phase 1)
- `public/configure.html` — restructure into sidebar + sections.
- `public/css/configure.css` — consolidate `:root`, add themes, background, components.
- `public/js/shell.js` — extend `PAGES`, keep router.
- New `public/js/theme.js` — theme load/save/apply, reduce-motion.
- `public/js/configure.js`, `controls.js`, `health.js` — adapt to new DOM ids/structure.

---

## Phase 2 — Backend foundation: Postgres + accounts

Introduce a server-side data layer and authentication. This is the prerequisite for everything after.

### 2.1 Database (Railway Postgres)
Add a Railway Postgres service. Use a small query layer (e.g. `pg` with a thin `lib/db.js`; migrations as plain SQL files in `migrations/`).

Initial tables:
- `users` — `id` (uuid), `username` (unique), `password_hash` (bcrypt/argon2), `role` (`user` | `admin`), `created_at`, `last_seen_at`, `last_ip`.
- `sessions` — `id`, `user_id`, `token_hash`, `expires_at`, `created_at`. (Or signed JWT cookies; see 2.2.)

Seed an initial admin (`Eli`) via migration/env — **not** hardcoded in client JS (the prototype's `Eli`/`Admin` check was browser-only and is explicitly thrown away here).

### 2.2 Auth
- **Login / Register** pages (the redesigned auth screen: username + password, sliding tab + crossfade, fade-scale transitions). Real `<form>` with `name`/`autocomplete` for browser credential saving.
- Server-side: passwords hashed (argon2id preferred, bcrypt acceptable). Session via httpOnly, Secure, SameSite cookie (signed token or session row). CSRF protection on state-changing routes.
- Middleware gates app routes; admin-only routes check `role = admin`.

### 2.3 Files
- New `lib/db.js`, `migrations/*.sql`, `lib/auth.js`, auth routes in `server.js` (or a `routes/auth.js`).

---

## Phase 3 — Encrypted keys + per-user manifest + anti-sharing

### 3.1 API key storage (encrypted at rest)
- New table `user_config` — `user_id`, `trakt_client_id_enc`, `tmdb_key_enc`, `mdblist_key_enc`, `settings_jsonb`, `updated_at`.
- Encryption: **AES-256-GCM** via Node `crypto`. A master key lives in a Railway env var (`CONFIG_ENC_KEY`, 32 bytes base64). Each field stored as `iv:authTag:ciphertext`. Decrypted only in-memory when serving that user's manifest/streams.
- The **API Keys** page saves keys over an authenticated endpoint; UI shows the "🔒 Encrypted at rest" badge.

### 3.2 Per-user manifest URL (subscription-gated + revocable)
- New table `manifest_tokens` — `token` (long random, e.g. 32 bytes base64url, unique, indexed), `user_id`, `created_at`, `revoked_at` (nullable).
- URL shape: `https://<host>/u/<token>/manifest.json` (and the matching catalog/stream routes under `/u/<token>/…`).
- **On every request** to a `/u/<token>/…` route, the server: looks up the token → user → checks the user has an **active subscription** (enforced in the final billing phase; stubbed always-allowed until then). If not active or token revoked → `403`/`410`. This is the anti-sharing mechanism: a leaked URL stops working the instant the payer's subscription lapses, and the user can **Regenerate** (issues a new token, sets `revoked_at` on the old) to kill a shared link.
- One active token per user at a time (regenerate replaces). Tokens are unguessable; never derived from username.
- **Explicitly documented limitation:** this does not prevent copying a URL while a subscription is active among a small trusted group; per the decision, we are not adding device/IP limits or short-lived signed sub-tokens in this design (those remain future options).

### 3.3 Files
- New `lib/crypto.js` (AES helpers), `lib/manifest.js` (token issue/revoke/lookup), guarded `/u/:token/*` routes.

---

## Phase 5 — FINAL — PayPal subscriptions + billing gating

*(Built last. Presented here next to the manifest/anti-sharing material it relates to, but implemented after Phase 4.)*

### 4.1 Subscription model
- **Recurring** subscription ("Bridge Pro", e.g. $4/mo) via **PayPal Subscriptions API** (Billing Plans + embedded PayPal JS SDK smart buttons on the Billing page).
- New table `subscriptions` — `user_id`, `provider` (`paypal` | `comp`), `paypal_subscription_id` (nullable), `status` (`active` | `cancelled` | `past_due` | `comped`), `current_period_end`, `updated_at`.
- **Access check** (used by manifest routes and UI): a user has access if `status IN ('active','comped')` and (for active) `current_period_end` in the future.

### 4.2 Flow
- Billing page renders PayPal buttons → on approval, backend verifies the subscription with PayPal and writes the `subscriptions` row.
- **PayPal webhooks** (`server.js` webhook route) keep status in sync: activation, payment completed (extend `current_period_end`), cancelled, suspended/past_due → flips access off, which immediately invalidates the manifest (Phase 3 check).
- Once active, the Billing page hides the pay area and shows "Subscription active" + renewal date + Cancel. The API Keys manifest section unlocks.

### 4.3 Discount codes & comps (admin-managed; PayPal has no native coupons)
- New table `discount_codes` — `code` (unique), `type` (`comp_100` | `percent_50` | `first_month_free`), `active`, `created_by`, `created_at`, `max_uses`, `uses`.
- Redemption: a `comp_100` code sets the user's subscription to `comped` (no PayPal charge) — this is the "give a family member access" path. Percentage/first-month codes map to alternate PayPal plan pricing or a free initial period.
- Admin can also directly set a user's plan/status from the Users page (comp, cancel, change).

### 4.4 Files
- New `lib/paypal.js` (SDK + plan + verify + webhook handling), `lib/billing.js` (access checks, code redemption), billing routes.

---

## Phase 4 — Admin panel + health persistence

### 5.1 Health/uptime/ping persistence
- Replace `lib/health.js`'s JSON-file persistence (`data/health-history.json`) with a Postgres table `health_checks` — `server_id`, `user_id`, `checked_at`, `status` (`up`|`slow`|`down`), `ping_ms`. Written on each 5-min ping.
- The Health page and server-detail modal read aggregated history (sparklines, uptime %, last outage) from this table, so data **survives page refresh and Railway restarts**.

### 5.2 Admin pages
- **System**: live CPU/RAM gauges, memory, uptime, CPU & requests sparklines, connected users. CPU/RAM sourced server-side (Node `os`/`process` metrics) via an authenticated admin endpoint polled ~2.5s.
- **Users**: list all users; add user; click a user → detail (streams, watch time, role, joined, last IP, status) + **streaming history** (from request/stream logs) + actions (reset password, change/comp plan, remove). Discount-code management (create/list/deactivate) lives here.

### 5.3 Files
- `lib/health.js` (Postgres-backed), `lib/metrics.js` (system stats), admin routes, `public/js` admin page logic.

---

## Cross-cutting: security

- All secrets (`CONFIG_ENC_KEY`, PayPal client id/secret, DB URL, session secret) in **Railway env vars**, never in the repo or client.
- HTTPS only (Railway provides). Cookies httpOnly/Secure/SameSite. CSRF tokens on mutations. Rate-limit auth + manifest endpoints.
- API keys never sent back to the client after save (write-only fields; show masked state).
- Manifest/stream routes are the trust boundary — every hit re-validates token + subscription server-side.
- Passwords hashed with argon2id; never logged.

## Module/structure summary (additions)
```
migrations/                 SQL migrations
lib/db.js                   pg pool + query helper
lib/auth.js                 register/login/session/middleware
lib/crypto.js               AES-256-GCM encrypt/decrypt
lib/manifest.js             per-user token issue/revoke/lookup
lib/paypal.js               subscriptions + webhooks
lib/billing.js              access checks, discount codes, comps
lib/metrics.js              system CPU/RAM/uptime
lib/health.js               (rewritten) Postgres-backed health history
public/js/theme.js          theme load/save/apply
public/css/configure.css    consolidated :root + themes + components
public/configure.html       sidebar SPA shell + all pages
```

## Phasing / sequencing

**Billing is intentionally the LAST phase** (per decision 2026-05-31). Until it lands, access is ungated (or admin-comped) so the whole app is usable while the rest is built.

1. **Phase 1 (Frontend)** — ship the redesign against current client-side config. Independent; highest immediate value.
2. **Phase 2 (DB + accounts)** — foundation for everything server-side.
3. **Phase 3 (Encryption + manifest tokens + anti-sharing)** — depends on 2. The anti-sharing "active subscription" check is stubbed to always-allowed until the billing phase enforces it.
4. **Phase 4 (Admin + health persistence)** — depends on 2; health persistence can land any time after 2.
5. **Phase 5 — FINAL (PayPal + billing gating)** — depends on 2–4. Turns on real subscription status, which drives the anti-sharing check (Phase 3) and the access-gating UI (Phase 1 scaffold). Admin comp/discount-code management (built in Phase 4) becomes fully functional here.

Each phase gets its own implementation plan via the writing-plans skill, starting with Phase 1.

## Open questions / future options (not in scope now)
- Stronger anti-sharing (device/IP caps, short-lived signed stream tokens) if casual sharing becomes a problem.
- Email (verification, password reset, dunning emails on failed payments).
- Multiple subscription tiers.
