# Advanced Admin Console + Watching Activity + Health/Layout Polish — Design

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review → plan → implementation

## Goal

Turn the thin Admin → Users page into a **full, data-rich admin console**, and ship three smaller polish items alongside it:

1. **Admin console** — overview stats, a sortable/filterable user table, and a rich per-user detail panel showing **what each user is watching** (recent + live), **which server**, their **configured servers + uptime**, and full **billing** (subscription, payments, audit) — with all management actions working.
2. **Watching infrastructure** — per-user activity (from the request log) + live now-playing (from each server's sessions API).
3. **Top server of the day** on the Health page.
4. **Page centering** for narrow single-column pages.

Everything dark-theme-matched, with dropdowns, sorting, and graceful degradation when a data source is unavailable.

## Non-Goals

- No new payment/billing capture changes (built previously). No retroactive backfill of request-log user tags (tagging starts going-forward).
- Live now-playing is best-effort: servers that don't expose sessions to the stored key simply show "nothing playing / unavailable."
- No per-user request-log table migration; the existing global capped JSON log is reused, now tagged with `userId` and filtered per user.

## Data Sources (what "lots of data" draws on)

| Source | Provides |
|---|---|
| `users` | username, role, created_at, last_seen_at, last_ip |
| `subscriptions` | status, current_period_end, paypal_subscription_id |
| `payments`, `billing_events` | payment history + audit trail (existing) |
| request log (`REQUEST_LOG`, global JSON) | per stream request: title, server, type, season/ep, ms, found, ts — **to be tagged with `userId`** |
| `server_uptime_daily`, `server_health_log` | per-user uptime % + response times (existing) |
| `user_config.config_json` | each user's configured servers (label, url, type) |
| live Emby/Jellyfin `/Sessions` | now-playing (best-effort, on demand) |
| `systemMetrics()` | CPU / RAM / uptime (existing, for a system strip) |

## Architecture / Components

### Backend

**A. Request-log per-user tagging** (`server.js`)
- The `/u/:token` middleware resolves `token → user_id → config`, then re-routes to the `/:config/*` handlers, losing the user id. Thread it through: stash `req._mebUserId = rec.user_id` before `app.handle(req,res)`, and read it in the stream handler's `addLogEntry({... userId: req._mebUserId || null ...})`.
- Add `userId` to the log entry shape. Existing entries (untagged) simply have `userId: null`.

**B. Live sessions** (`lib/sessions.js` NEW, or extend `lib/health.js`)
- `makeLiveSessions()` → `forUser(servers)`: for each of a user's servers, GET `${url}/Sessions?api_key=<key>` (Emby/Jellyfin compatible), with a short timeout; collect entries that have `NowPlayingItem`. Return `[{ server, user, title, type, positionTicks?, client }]`. All failures swallowed → server contributes nothing. Never throws.
- Server creds come from `userConfig.getForServe(userId)` (decrypts keys).

**C. Admin endpoints** (`routes/admin.js`)
- `GET /api/admin/overview` → `{ users:{total,active,comped,admins,newThisWeek}, revenue:{monthly,lifetime,currency}, recentPayments:[...], activity:{requests24h,requests7d,topTitles:[...],busiestServer} }`.
- Enrich `GET /api/admin/users` → add `last_seen_at`, `created_at`, `server_count` (from user_config), `sub_status`, `period_end`. (Sorting/filtering done client-side.)
- `GET /api/admin/users/:id/activity` → `{ recent:[{ts,title,type,season,episode,server,ms,found}], live:[{server,title,type,client,user}], totals:{requests24h,requests7d,lastActive} }`. `recent` = request log filtered by `userId`; `live` = `liveSessions.forUser(...)`.
- Existing `/detail`, `/subscription`, `/resync`, `/password`, `/comp`, `/uncomp` stay; `/detail` continues to return subscription+payments+events+servers.
- A helper to read the global request log per user (export an accessor from `server.js` or pass the log array into the admin router factory).

### Frontend

**D. Admin page rebuild** (`public/configure.html` `#page-users` + `public/js/admin.js` + CSS)
- **Overview cards row**: Users (total · active · comped) · Monthly revenue · Requests (24h) · Busiest server. Small, glassy, like the dashboard tiles.
- **Controls bar**: search input (filter by username), status filter `<select>` (all / active / comped / none / cancelled), sort `<select>` (recent activity / name / status / newest). All client-side over the `/users` list.
- **User table**: columns — User (avatar+name+role) · Status (pill) · Last active · Servers (#) · Actions (Manage). Rows are clickable → open detail.
- **Per-user detail** (reuse modal shell, expand to wider modal): tabs
  - **Activity** — live now-playing banner (if any) + recent watches table (title · server · when · result).
  - **Servers** — their configured servers (label · host · type) with uptime % from rollups.
  - **Subscription** — status, next payment, override (status + access-until), resync, comp/uncomp.
  - **Payments** — table + audit timeline.
  - **Account** — created, last active, last IP, reset password.
- **Add user** + **Discount codes** sections tidied into clean cards with theme-matched inputs.

**E. Top server of the day** (`public/js/health.js` + CSS)
- After loading `/api/health/history`, compute per server over last 24h: uptime % (`up/total`) and avg ms (over up checks). Rank by uptime desc, then avg ms asc. Render a banner above the grid: 🏆 *Top server (24h) — <name> · <uptime>% · <avg>ms*. Hidden if no data.

**F. Page centering** (CSS)
- Center narrow single-column page content. Implementation: a `.page-narrow` wrapper (or target the accordion list containers) with `max-width` + `margin-inline:auto`. Apply to single-column pages (Appearance, Settings, API Keys already grid-centered). Grid pages unaffected.

## Error Handling

- Live sessions, request-log reads, and overview aggregates are wrapped; failures degrade to empty/"unavailable" and never break the admin page.
- All new admin routes behind `requireAdmin`.
- All rendered user-controlled strings (titles, usernames, server labels, client names) HTML-escaped (continue the XSS-escaping discipline already in admin.js).
- Endpoints degrade gracefully when `db.isConfigured()` is false.

## Testing

- `lib/sessions.js` (or new module): unit test `forUser` aggregation + that a throwing server contributes nothing (fake fetch).
- `routes/admin.js`: overview aggregation shape; activity endpoint filters log by userId; requireAdmin enforced.
- Extend request-log: an entry carries `userId` when threaded.
- Frontend: manual verification live (no FE test harness), covering table sort/filter, detail tabs, top-server banner, centered pages, dark inputs.

## Rollout

- Additive: no schema migration (reuses existing tables + global request log). Safe deploy via push to main.
- Watching activity accrues from deploy (per-user tagging is going-forward). Existing untagged log entries show under no user.

## Open Questions / Future

- If the global request log proves too small/volatile for good per-user history, a future `request_log` DB table could replace the JSON file (out of scope now).
- Live now-playing is on-demand per detail open; a future enhancement could poll/stream it.
