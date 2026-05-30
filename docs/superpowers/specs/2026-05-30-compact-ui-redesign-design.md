# Compact UI Redesign — Design

**Date:** 2026-05-30
**Status:** Approved (visual companion)
**Builds on:** 2026-05-30-ui-redesign (the sidebar shell already shipped)

## Goal

Make the heavy settings tabs (Streaming, Catalogs, Appearance) "POP, clean, simple,
family-friendly" by replacing stacked dropdown/checkbox rows ("log boxes") with a shared
toolkit of compact visual controls — segmented pills, toggle chips, switch tiles, sliders,
icon tiles, status pills. Plus three targeted fixes: square server cards, a broken Manage
button, and the Dashboard re-fetching library stats on every visit.

**Hard constraint:** This is a *control-surface* rewrite only. The saved config schema and the
generated install-link format MUST stay byte-for-byte compatible. No change to addon behavior,
`generateLinks`, the manifest, or any `/api/*` endpoint. Existing saved profiles/links keep working.

## Components — shared compact-control toolkit

New CSS classes + a tiny JS helper module (`public/js/controls.js`), reused by every redesigned
tab so the look is consistent:

- **Segmented pills** (`.seg` / `.seg button.on`) — mutually exclusive choice, 2–6 options.
  Replaces small `<select>`s and radio groups (mode, sort, codec, type, prefer/only).
- **Toggle chips** (`.chip.on` / `.chip.exclude.on`) — independent multi-toggle. Replaces
  checkbox groups (exclude-resolutions, language filters).
- **Switch tiles** (`.sw.on .knob`) — boolean on/off with label + subtext. Replaces the
  `.option-item` checkbox cards (recommended, fastest, auto-select, ping-detail, no-dupes, etc.).
- **Slider** (`.slider`) — numeric range with live value. Replaces max-bitrate `<select>`.
- **Icon tiles** (`.tile.on`) — pick-one or quick-action grid. Used for catalog provider picker
  and streaming-service quick-add.
- **Status pills** (`.st.set` / `.st.unset`) — show whether an API key is configured.
- **Compact dropdown** (`.pick`) — kept for genuinely long lists (audio language: 13 options).

Each control reads/writes the **same config values** as the control it replaces. The canonical
state stays in the existing config object; the toolkit just renders a different surface over it.

### Wiring strategy (critical)

`configure.js` currently reads settings in `collectConfig`/`generateLinks` via element ids
(`#sort-order`, `#max-bitrate`, `.res-cb`, `#show-recommend`, …) and restores them in
`restoreFromLocalStorage`. To avoid rewriting all of that:

- Keep a **hidden canonical input** for each setting (the existing `<select>`/`<input>`/
  `<checkbox>`, hidden via `display:none`), and have the visual control update that hidden input
  + dispatch its `change`/`input` event. So `collectConfig`, autosave, and restore keep working
  unchanged — they still read the hidden inputs.
- The visual control is a thin presentation layer: clicking a pill sets the hidden `<select>`'s
  value and fires `change`; rendering reads the hidden input's value to show the active pill.
- A helper `bindSegment(hiddenSelectId, containerEl)`, `bindChips(...)`, `bindSwitch(...)`,
  `bindSlider(...)` in `controls.js` sets up this two-way sync generically.

This keeps the config schema identical and minimizes risk: the hidden inputs remain the single
source of truth; restore-from-localStorage and install-link generation are untouched.

## Tab-by-tab

### Streaming (`#page-streaming`)
- Delivery mode (normal/split/timeout) → segmented pills; timeout value (when "Fast timeout"
  active) → small inline segment or compact select revealed beneath.
- Sort streams by (size/audio/bitrate) → 3-segment.
- Exclude resolutions (4K/1080p/720p/SD) → red toggle chips (lit = excluded).
- Prefer codec (Any/H.264/HEVC/AV1/VP9) → chips; prefer/only → 2-segment.
- Audio language → compact dropdown (unchanged control, restyled).
- Max bitrate → slider with live "N Mbps" / "No limit" label.
- Extras (recommended, fastest, auto-select, ping-detail) → switch tiles in a 2-col grid.

### Catalogs (`#page-catalogs`)
- **Quick add** streaming services → icon-tile grid + "Add all major networks" button
  (wraps existing `applyAllNetworks` / preset apply).
- **Connections** → 2×2 status-pill grid for Trakt / MDbList / TMDB / RPDB keys; clicking a
  tile expands its key input inline. Hidden canonical key inputs preserved.
- **Add a custom row** → provider icon tiles (Trakt/MDbList/IMDb/Letterboxd/TMDB) drive the
  existing `#cat-provider`; provider-specific fields (Trakt list, URL, TMDB charts/discover)
  reveal compactly under the tiles; media type → segment; name + Add.
- **Browse a user's lists** (MDbList/Trakt) → revealed under the relevant provider tile, not a
  permanent block.
- **Filters** → language chips + "No duplicate rows" switch on one line.
- **Your rows** → existing catalog list restyled as draggable pills (drag handle, provider·type
  tag, ✕). Drag-reorder behavior preserved.

### Appearance (`#page-appearance`)
- Summary-card toggle, quality-badge, language/bitrate/subtitle display, label-format custom
  checkboxes → switches / segments / chips per the toolkit. Label-format preset (6 options) and
  the live preview stay; long lists stay compact dropdowns. Nothing removed.

## Targeted fixes

### Manage-button bug (Servers)
Root cause confirmed: `.server-card::before` (the animated rainbow border, `position:absolute;
inset:0`) overlays the card and intercepts pointer events, so clicks never reach `.sc-manage`
(or the Test/Remove/Fetch buttons inside the edit form). Fix: `.server-card::before {
pointer-events: none; }`. One line; re-enables every button on the card.

### Square server cards
Change `.server-card` `border-radius` from `var(--r-lg)` (17px) to a crisp `4px`; keep the
existing full-width layout and the `sc-top` accent bar. (Option B.) Adjust the `::before` and
`.sc-top` radii to match so corners stay square.

### Dashboard library-stats caching
`renderDashboard` currently POSTs `/api/library-stats` for every server on every visit. Change:
cache results in memory keyed by `url|apiKey|userId`, with the config's server list as the
invalidation signal. On Dashboard show, render from cache instantly; only fetch servers whose
key isn't cached (or changed). Add a small "↻ Refresh" control on the Dashboard to force a
re-fetch. Optionally persist the cache in `localStorage` (key `meb-libstats-cache`) with a TTL
(e.g. 1 hour) so a page reload doesn't re-hammer servers. Also add the re-entry guard the review
noted (ignore overlapping `renderDashboard` calls).

## Files touched

- **New** `public/js/controls.js` — the bind helpers (`bindSegment`, `bindChips`, `bindSwitch`,
  `bindSlider`, `bindTiles`) that sync visual controls ↔ hidden canonical inputs.
- `public/configure.html` — Streaming/Catalogs/Appearance section markup rewritten to the new
  controls, each keeping a hidden canonical input where needed. Load `controls.js`.
- `public/css/configure.css` — toolkit classes; square card radius; `pointer-events:none` fix.
- `public/js/configure.js` — call the bind helpers on init / `onPageShow`; library-stats cache +
  refresh + re-entry guard. No change to `collectConfig`/`generateLinks` schema.

## Out of scope
- No backend/API/manifest changes. No change to the saved-config format or install-link format.
- Servers and Dashboard layouts otherwise unchanged (beyond square corners, the button fix, and
  stats caching).
- The minor review-noted dead code (`updateSteps`, stale TEMP comment) — leave unless touched.

## Risks
- The hidden-canonical-input approach is the safety net: if a visual control is mis-wired, the
  hidden input still holds the value, so config never silently corrupts. Each bound control must
  be verified to (a) reflect the restored value on load and (b) update the hidden input + fire
  its event on change. This is the main thing to test per control.
