# Multi-Emby Bridge — UI Redesign Design

**Date:** 2026-05-30
**Status:** Approved (visual language locked via brainstorming visual companion)

## Goal

Replace the current single long-scrolling configure page with a friendly, immersive,
sidebar-driven UI inspired by the OMEGA Media client area. Every existing feature carries
over — nothing is dropped. The redesign is a **reskin + reorganization**, not a tech rewrite.

## Tech approach

- **No framework, no build step.** Vanilla HTML/CSS/JS served by Express, as today.
- **All existing logic preserved and reused** — autosave, `localStorage` config, install-link
  generation, `/api/library-stats`, ping logic, catalog/label/appearance/streaming settings.
- **One shell, many pages.** `public/configure.html` becomes a sidebar shell. The content area
  swaps between "pages" via a tiny client-side hash router (`#/dashboard`, `#/servers`, …).
  No reloads — show/hide sections — so all config state stays alive while navigating.
- **Merge `servers.html`** (health dashboard) into the shell as the **Health** page. Keep the
  `/servers` route as a redirect so existing links don't break.
- **New CSS design system** replaces `public/css/configure.css`.
- **JS organization:** keep `public/js/configure.js` as the logic core; add `public/js/shell.js`
  for nav/routing, dashboard rendering, and server-card rendering, so presentation stays separate
  from business logic.

## Navigation (sidebar)

Reordered to follow the actual setup flow. Sidebar sections:

- **Main list:** Dashboard → Servers → Catalogs → Streaming → Appearance → Health
- **Footer area:** Quick Install button (pinned, animated RGB border) + small links to
  Profile / Tools (Ping Test, Request Log) + "Settings saved" indicator
- **Install** is reachable both via the pinned Quick Install button (opens link + QR in a
  modal) and as its own destination.

**Labels folded into Appearance** (both are presentation concerns). Ping Test, Request Log, and
Install are secondary — tucked under the footer to keep the main nav short.

Responsive: sidebar collapses to a top hamburger on narrow screens.

## Pages / feature mapping

| Page | Contents (all carried over from current UI) |
|------|----------------------------------------------|
| **Dashboard** (new) | Gradient stat tiles (Servers up · Catalog rows · Movies · Fastest ping) + live server cards (status badge + Movies/Shows/Episodes mini-stats). On-demand browser ping + `/api/library-stats` when opened. Friendly greeting + plain-language status line. |
| **Servers** | Grid of OMEGA-style server cards (detailed-rows variant): accent top bar, icon, live status badge, Movies/Shows/Episodes rows, "Manage Server" expands the credential edit form in place. "+ Add Server". Profile save/load/export/import lives here. |
| **Health** | The old `servers.html`: time-range tabs, sparklines, ping comparison, persisted 5-min history. |
| **Catalogs** | My Library row + RPDB key · API keys (Trakt/MDbList/TMDB) · filters · streaming presets · MDbList & Trakt browsers · catalog list + add form (incl. TMDB charts/discover). |
| **Streaming** | Mode (normal/split/timeout), sort order, exclude resolutions, audio language, codec pref, max bitrate, recommended/fastest/auto-select toggles, ping-RTT detail. |
| **Appearance** | Stream label format presets + custom name/description builder + preview (formerly Labels); results summary card; quality badges; language/bitrate/subtitle display styles. |
| **Install** | Generated install link + QR + copy + "Open in Stremio". Also surfaced via the pinned Quick Install button as a modal popover. |
| **Ping Test** (tool) | Browser vs addon-server origin, run test, results. |
| **Request Log** (tool) | Request history table, refresh/clear, link to Health. |

## Visual language (locked)

**Vibe:** Warm & Friendly.

- **Base:** dark warm gradient background (`#1a1420 → #0f0c14`), extra-rounded corners
  (12–17px), soft borders (`#2c2333`).
- **Accent:** sunset gradient orange→pink (`#fb923c → #f472b6`); secondary indigo `#818cf8`
  and mint `#34d399` used in stat tiles.
- **Stat tiles:** four colorful gradient tiles (orange / pink / indigo / mint).
- **Server cards:** dark rounded cards, gradient icon, status badge, mini-stat chips.
- **Status colors:** UP = mint/green, SLOW = amber `#fcd34d`.
- **Friendly touches:** greeting headers ("Hey there 🍿"), emoji nav/section icons,
  plain-language status copy.

**Animated RGB accents (accent-only, not everywhere):**

- Rainbow gradient flow cycling through the brand logo and the active nav item (~5–6s loop).
- Spinning conic-gradient border on the Quick Install button (~4s loop).
- Hover: rainbow conic border + 3px lift on each server card.
- Pulsing status dots on UP badges (~2s loop).
- Drifting light sheen sweeping across the stat tiles, staggered per tile (~4.5s loop).

**Rejected:** ambient drifting aurora-blob background (too much). Background stays a static
warm gradient.

**Accessibility:** respect `prefers-reduced-motion` — freeze/disable all the above animations
for users who opt out.

## Data flow (unchanged backends)

- Config lives in `localStorage` with existing autosave. No new persistent server-side state.
- Dashboard/Servers live status: browser ping + existing `POST /api/library-stats`.
- Health page: existing health endpoints / `data/health-history.json` (via `lib/health.js`).
- Install link: existing `generateLinks()` logic.

## Files touched

- `public/configure.html` — rewritten as the sidebar shell containing all page sections.
- `public/css/configure.css` — replaced with the new warm + RGB design system.
- `public/js/shell.js` — **new**: hash router, nav, dashboard + server-card rendering.
- `public/js/configure.js` — retained as logic core; refactored to expose render hooks the
  shell calls (server-card rendering moves out of the old single-block builder where needed).
- `public/servers.html` — content merged into the Health page; `/servers` route redirects.
- `server.js` — add `/servers` → shell redirect (Health page). No other backend changes.

## Out of scope

- No backend/API changes beyond the `/servers` redirect.
- No framework or build tooling.
- `lib/health.js` `pingLocations` stubs remain out of scope for this redesign.
