# Website Smoothness — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Branch:** `polish/smoothness`
**Scope:** All frontend surfaces of `public/` — the single-page `configure.html` app and all 13 tabs.

## Goal

Make the whole site feel smooth and alive: page-wide scroll flow, consistent and
cohesive transitions, polished hover/focus, and **rich, expressive load-in** (staggered
reveals, on-scroll reveals, subtle parallax accents). Close the coverage gaps where some
elements animate and others snap. **No new features, no backend changes.**

Motion character: **rich & expressive**, built on a strict performance/safety spine —
animate only `transform`/`opacity`, never leave content invisible if motion is off.

## Current state (audit)

**Already has motion:** page/modal-tab entrance (`flowin` fade+rise, lines ~965, ~1059);
toast slide-in; admin skeleton shimmer (`adm-shimmer`); a few manual
`scrollIntoView({behavior:'smooth'})` calls (configure.js ~229/1222/1948,
user-account.js ~91); ~85 hover transitions; decorative loops (orbs, snow `fall`, brand
logo, status blink).

**Missing / inconsistent:**
- No page-wide `scroll-behavior: smooth` — only ad-hoc `scrollIntoView`.
- Default browser scrollbars (unstyled, jarring on the dark theme); scroll areas include
  `.mdblist-browse-grid` (~552) and `.log-table-wrap` (~367).
- No per-element load-in — whole pages fade, but cards / table rows / list items pop in
  instantly.
- No on-scroll reveal anywhere (no `IntersectionObserver`).
- Transition inconsistency: mixed durations (`0.1/0.12/0.15/0.2/0.34/0.35s`), 14×
  `transition: all`, 4 fragmented `:root` blocks (lines ~2, ~43, ~895, ~938).

## Constraints

- **Reduced-motion:** the dev machine has OS `prefers-reduced-motion: reduce` ON. The
  existing rule (line ~38) kills `animation` but keeps `transition`. Load-in,
  on-scroll reveal, smooth-scroll, and parallax are all suppressed there — so a dev
  preview toggle is required, and accessibility must be preserved by default.
- Railway auto-deploys on push to `main` — do not push without explicit ask.
- Backend untouched; `npm test` (18 files) must stay green.
- Vanilla only — no new runtime dependencies; match the hand-rolled SVG/CSS style.

## Design

### 1. Motion foundation
Consolidate the 4 `:root` blocks into one canonical token set (de-dupe colors/radii,
keep both `--r-*`/`--radius-*` aliases). Add motion tokens: `--ease`
(`cubic-bezier(.22,.61,.36,1)`, existing), `--side-ease` (existing), `--ease-out`
(`cubic-bezier(.16,1,.3,1)`); `--dur-fast:120ms / --dur-base:180ms / --dur-slow:280ms`;
presets `--t-colors`, `--t-transform`, `--t-pop`. Replace all 14 `transition: all` with
explicit presets. Normalize hover (subtle lift + brighter bg/border), active (settle),
and `:focus-visible` (accent ring) across buttons, `.nav-item`, rows, tabs, `.swatch`,
`.switch`, cards, dropdowns.

### 2. Scroll flow
- `html { scroll-behavior: smooth; }` gated under `html.js-reveal` (see §4) so
  reduced-motion gets instant jumps.
- **Themed scrollbars:** WebKit (`::-webkit-scrollbar`, thin ~10px, transparent/dark
  track, `--border` thumb brightening to `--accent` on hover, rounded) + Firefox
  (`scrollbar-width: thin; scrollbar-color: <thumb> <track>`). Applied to the document
  and inner scroll areas.
- `scrollbar-gutter: stable` on the main scroll container to prevent layout shift.
- `overscroll-behavior: contain` on `.mdblist-browse-grid` and `.log-table-wrap`.

### 3. Rich load-in — `public/js/reveal.js` (new)
A small module (one responsibility: orchestrate reveals via class toggles; CSS does the
animation):
- **Gate:** on load, if motion is allowed (not reduced-motion, OR `?motion=force`/stored
  `forceMotion`), add `html.js-reveal`. Otherwise do nothing — content stays visible.
- **Tab-open stagger:** when a `.page` gains `.on`, add `.reveal-seq` to it; its direct
  children animate in with a per-child delay via an inline `--i` index (capped, e.g. 12)
  → CSS `animation-delay: calc(var(--i) * 40ms)`.
- **On-scroll reveal:** elements marked `[data-reveal]` (added in the coverage sweep to
  section blocks / cards / table groups) start hidden (only under `html.js-reveal`) and
  get `.revealed` when an `IntersectionObserver` (threshold ~0.12, rootMargin bottom
  `-8%`) fires; then unobserved (one-shot).
- **Parallax accents:** a single rAF-throttled `scroll` handler translates the background
  orbs (`.bg .o1/.o2/.o3`) and active page header by a small factor; only attached under
  `html.js-reveal`; updates a CSS var, never layout properties.
- **Enhanced entrance:** strengthen `flowin` slightly (rise 8px→12px, add `--ease-out`).

### 4. Reduced-motion + dev toggle (safety spine)
- All "hidden-until-revealed" CSS is scoped under `html.js-reveal` ONLY. With
  reduced-motion (no force) or JS disabled, that class is absent → every element renders
  at full opacity immediately. **Nothing can get stuck hidden.**
- Reuse the planned `public/js/dev-motion.js` logic (merge into `reveal.js` or keep
  separate): `?motion=force` sets `localStorage.forceMotion=1` and adds `html.force-motion`;
  `?motion=off` clears it. The reduced-motion media block becomes
  `html:not(.force-motion) *{animation:none!important}` so force-motion re-enables loops.
- Preserve the deliberate `!important` animation overrides (`.gbrand` logo,
  `status-blink`) — they stay on.

### 5. Coverage audit (all 13 tabs)
Sweep Dashboard, Servers, Catalogs, Streaming, Appearance, API Keys, Health, Ping, Log,
Settings, Users, Billing, Admin. For each: every interactive element has the unified
hover/focus; every major content block gets a `[data-reveal]` hook (skip per-row reveal
on data-heavy lists — Log stream, large tables — to avoid churn; reveal their container
instead); every scroll area is themed.

### 6. Performance discipline
Animate only `transform`/`opacity`. `will-change: transform` applied just before a
reveal and removed on completion. One IntersectionObserver instance shared; one
rAF-throttled scroll handler total. Verify no jank and no layout shift (CLS) in-browser.

## Testing & verification
- **Unit:** `test/reveal-gate.test.js` (new, added to `npm test`) for the pure
  "should animate?" decision — covering reduced-motion=true→false, force flag→true,
  no-flag+reduced→false. Extract that decision into a pure exported function.
- **Browser (MCP):** with `?motion=force` — confirm smooth scroll, themed scrollbars,
  tab-open stagger, on-scroll reveals fire, parallax drifts, no jank. **Key safety check:
  with reduced-motion and NO force — every tab's content is fully visible (no stuck
  hidden elements).** Screenshot key tabs at desktop + narrow widths.
- `npm test` — all 18 files green.

## Non-goals (YAGNI)
No redesign/re-layout, no new features, no color/brand changes, no backend changes, no
new runtime dependencies, no parallax beyond the few decorative accents named above.
