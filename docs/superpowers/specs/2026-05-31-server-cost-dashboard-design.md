# Server Cost + Dashboard Glow Cards — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorming + visual companion)

## Goal

Two dashboard upgrades:

1. **Per-server cost** — each server gets an optional cost + billing period, edited in Manage
   Server, shown on its dashboard card, with a normalized **total cost** tile at the top.
2. **Dashboard server cards restyle** — roomy OMEGA-sized cards with a neon-glass + 3D look, the
   official **Emby/Jellyfin brand logo** (auto-picked from server type) with a pro animated badge,
   and a Manage button that jumps to that server's edit form.

**Constraint:** Additive config only (`cost`, `costPeriod`); existing configs and install links
are unaffected. No backend/manifest/stream changes — this is frontend (configure UI) only.

---

## Feature 1 — Per-server cost

### Data model

Two optional fields on each server entry in `cfg.servers[]`:
- `cost`: number (e.g. `20`). Omitted/absent when not set.
- `costPeriod`: one of `'monthly' | 'quarterly' | 'yearly'`. Absent when cost not set or period
  is "none".

`collectConfig` reads them from new form fields and adds them to the entry only when a positive
cost and a non-"none" period are present (mirroring how `thumbnail`/`emoji` are conditionally
added).

### Manage Server form (Servers page)

`buildServerBlock` adds a "Cost" field group inside the existing `.sc-edit` credential form:
- `<input class="f-cost" type="number" min="0" step="0.01" placeholder="0.00">`
- `<select class="f-cost-period">` with options `none` (default) / `monthly` / `quarterly` /
  `yearly`.
- `addServer(data)` populates `.f-cost` from `data.cost` and `.f-cost-period` from
  `data.costPeriod || 'none'`.

### Normalization helper

A pure helper `monthlyCost(cost, period)` (in configure.js):
- `monthly` → cost; `quarterly` → cost / 3; `yearly` → cost / 12; else (none/absent/invalid) → 0.
Used for the total. Per-card display shows the raw amount + period suffix (`/mo`, `/qtr`, `/yr`),
not the normalized value.

---

## Feature 2 — Dashboard server cards restyle

`renderDashboard` (configure.js) currently builds simple `.dash-card` elements. Replace the card
markup with the OMEGA glow card. Each card (one per `cfg.servers` entry, preserving order):

- **Container** `.gcard` with per-server accent CSS vars (`--bar`, `--accentglow`, `--badgebg`)
  chosen from a small palette cycled by index so each server gets a distinct glow.
- **Accent top bar**, **3D tilt + glow on hover**, raised shadow, gradient edge (the Option-A
  "neon glass" treatment).
- **Brand badge** `.gbrand`: an inline SVG — the official **Emby** logo (green) when
  `server.type === 'emby'`, the official **Jellyfin** logo (purple-blue) otherwise. Animated:
  glow-halo pulse + gentle float + sheen sweep (CSS `@keyframes`). A small type tag ("Emby" /
  "Jellyfin") under it.
- **Live status badge** (UP/SLOW/Down + ms) reusing the existing cached library-stats + ping
  result from `renderDashboard` (same data the current dash-card shows).
- **Info rows:** Movies / Shows / Episodes (from the stats) + a gold **Price** row showing
  `$<cost> / <suffix>` or "— not set".
- **Manage Server button** → `openServerManage(index)`: sets `location.hash = '#/servers'`, then
  expands the matching server card's edit form. Match by index (dashboard cards and
  `#servers-container .server-card` are built in the same `cfg.servers` order); call the existing
  `toggleManage` on the matching block (open it if collapsed) and `scrollIntoView`.

**Sizing:** OMEGA proportions — generous padding (~16–18px), ~48px brand badge, comfortable info
rows, full-width Manage button. Grid: `repeat(auto-fit, minmax(340px, 1fr))` so cards stay at the
liked size and flow ~2–3 per row by width. Mobile: single column.

**Reduced motion:** all card animations (pulse/float/sheen/tilt) are disabled under the existing
`@media (prefers-reduced-motion: reduce)` block.

### Brand SVGs

Embed the official Emby and Jellyfin logo SVGs inline in `renderDashboard` (two constant SVG
strings, `EMBY_SVG` / `JELLYFIN_SVG`), colored white-on-brand-gradient inside the badge.

---

## Feature 3 — Total cost tile

The dashboard top tiles row gains a 5th gold tile (`.tile.t5`):
- Compute `totalMonthly = sum(monthlyCost(s.cost, s.costPeriod))` over all servers.
- Display: big value `$<round(totalMonthly)>/mo`, label `Total cost · $<round(totalMonthly*12)>/yr`.
- If no server has a cost set, show `$0/mo` (or "—") — tile still renders for consistency.
- The tiles grid changes from 4 to 5 columns on wide screens; responsive: 2–3 columns on
  narrow/mobile (the existing `@media (max-width:720px)` rule extends to keep them readable).

---

## Files touched

- `public/configure.html` — `#page-dashboard`: add the 5th `.tile`. (Server cost inputs are
  injected by `buildServerBlock` in JS, not static HTML.)
- `public/js/configure.js` — `.f-cost`/`.f-cost-period` in `buildServerBlock` + `addServer`
  populate; `collectConfig` reads cost/costPeriod; `monthlyCost` helper; rewrite the
  `renderDashboard` card markup to the glow card with brand SVGs + cost row + Manage button;
  `openServerManage(index)`; total-cost tile computation.
- `public/css/configure.css` — `.gcard` glow/3D styles, `.gbrand` animated badge + keyframes,
  brand-color helpers, `.tile.t5`, grid changes; reduced-motion already covers animations.

## Out of scope

- No currency selector — display is `$` (USD) only.
- No backend/manifest/stream changes; cost never leaves the user's saved config.
- Servers-page card styling unchanged (only the Dashboard cards are restyled); the cost inputs
  are added to the shared server edit form, which both pages use.

## Risks

- **Manage-by-index** assumes dashboard and Servers-page cards share `cfg.servers` order — they
  do (both iterate the same array). If a server fails to render a block, index mapping could
  drift; guard by falling back to navigating to `#/servers` without opening a specific card.
- **Brand SVG accuracy** — use the official marks; if a type is neither `emby` nor `jellyfin`
  (shouldn't happen), default to the Emby mark.
