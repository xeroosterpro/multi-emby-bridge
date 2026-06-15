# Stream Hub — UI Audit (live site)

**Date:** 2026-06-15 · **Build audited:** `4415d4e` (production) · signed in as admin `Eli`
Driven with a real browser (desktop 1280 + mobile 390). Console noise baseline = the known
per-server polling errors (server-sessions 502 + one server's stale-key 401); only *new* UI
issues are listed.

## Findings

| ID | Sev | Finding | Location | Status |
|----|-----|---------|----------|--------|
| UI-1 | **Med** | The **"API keys"** nav item (deep-links `#/catalogs?step=connect`) and any hash with a `?query` render the **home page** instead of the target. Cause: the `viewas-changed` listener calls `showPage(location.hash…)` without stripping the query, so `showPage("catalogs?step=connect")` isn't in `PAGES` → falls back to `home`. | `public/js/shell.js`, `site-controls.js` | **Fixed** — `showPage` strips the `?query`; hardened `applyTabs` too |
| UI-2 | **Med** | Live "now playing" dock double-escapes HTML entities — a title like *Romance & Confectionery* renders as `Romance &amp; Confectionery`. Cause: text is `esc()`-ed then assigned via `.textContent` (already safe) → double-escape. | `public/js/configure/dashboard-live.js:522` | **Fixed** — dropped the redundant `esc()` (textContent is safe) |

## Pages verified clean (render + load OK)
- Home, Dashboard, Connections/Servers, Catalogs, Streaming (Media Sources), Install, Health,
  Ping, Request Log, Tickets, Settings, Admin·System, Admin·Console (Users), Admin·Data Center,
  Billing — all render correctly, no new JS/CSP/500 errors beyond the polling baseline.

## Interactions tested ✓
- **Theme switcher**: all 20 palettes/presets load; clicking a swatch updates `--accent` live
  and persists (verified emerald → restored default).
- **Per-server "YOU" test**: now returns real client-side pings (was "—" — confirms the LIVE-3
  CSP fix works interactively in prod).
- **Mobile drawer nav**: hamburger opens a well-grouped drawer with backdrop; live dock anchors
  at the bottom.
- Navigation across all pages, accordions/cards, range tabs — no dead links or JS errors.

## Responsive ✓
- Mobile (390px) and desktop (1280px): KPIs/cards stack, drawer nav works, no overflow/clipping.

## Notes (not UI bugs)
- Heavy backend re-auth failures surfaced in Admin·Data Center ("10224 re-auth failure(s) in
  24h") + one server (`emby.ompremium.cc`) returning 401 → **stale/expired server API keys**;
  worth refreshing those credentials. Operational, not a UI defect.

## Verification
- Edited JS syntax-checked; full `npm test` green. Fixes require a redeploy to verify live.
