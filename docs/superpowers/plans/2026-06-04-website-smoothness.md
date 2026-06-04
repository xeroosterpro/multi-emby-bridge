# Website Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole `public/` frontend feel smooth — page-wide scroll flow, themed scrollbars, a consistent motion-token system, polished hover/focus, and rich reduced-motion-safe load-in (staggered + on-scroll reveals + subtle parallax) — with no new features or backend changes.

**Architecture:** CSS owns all animation via a consolidated motion-token layer; a small vanilla `reveal.js` module toggles classes when elements enter the viewport (IntersectionObserver) and handles staggering/parallax. The "hidden-until-revealed" CSS is scoped under `html.js-reveal`, which JS adds ONLY when motion is allowed — so reduced-motion or JS failure leaves all content visible. A `?motion=force` toggle previews everything on a reduced-motion machine.

**Tech Stack:** Vanilla CSS (`public/css/configure.css`, ~97KB), vanilla JS (`public/js/`), single-page `configure.html`. Verification: Node test suite (`npm test`) for the pure gate logic + backend regression; browser MCP (Playwright) for visual/motion checks.

> **Verification note:** This is mostly CSS/motion polish — the one genuinely unit-testable unit is `reveal.js`'s pure "should animate?" decision (Task 5), which gets a real Node test. Everything else is verified via browser MCP observation + keeping `npm test` green.

---

## File Structure

- **Modify:** `public/css/configure.css` — tokens, transitions, hover/focus, scrollbars, reveal/stagger/parallax CSS.
- **Create:** `public/js/reveal.js` — reveal orchestration + motion gate + dev toggle (single responsibility: decide if motion is allowed, then drive reveals/parallax via class toggles). Exposes a pure `shouldAnimate()` for testing.
- **Create:** `test/reveal-gate.test.js` — unit test for `shouldAnimate()`.
- **Modify:** `public/configure.html` — add `<script src="js/reveal.js">` and `[data-reveal]` hooks during the coverage sweep.
- **Modify:** `package.json` — add the new test file to the `test` script.

No backend / `lib/` / `routes/` changes.

---

## Task 1: Motion foundation — consolidate `:root` + motion tokens

**Files:** Modify `public/css/configure.css` (`:root` blocks at ~lines 2, 43, 895, 938)

- [ ] **Step 1: Snapshot current tokens**

Run: `grep -nE "^\s*:root|--ease|--side-ease" public/css/configure.css`
Expected: `:root` at ~2, ~43, ~895, ~938; `--ease:cubic-bezier(.22,.61,.36,1)`; `--side-ease:cubic-bezier(.33,0,.2,1)`.

- [ ] **Step 2: Add a motion-token block right after the first `:root` (line ~20, before `* { box-sizing }`)**

```css
/* ============ Motion system (single source of truth) ============ */
:root {
  --ease: cubic-bezier(.22,.61,.36,1);
  --side-ease: cubic-bezier(.33,0,.2,1);
  --ease-out: cubic-bezier(.16,1,.3,1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 280ms;
  --t-colors: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  --t-transform: transform var(--dur-base) var(--ease);
  --t-pop: transform var(--dur-fast) var(--ease), box-shadow var(--dur-base) var(--ease);
}
```

- [ ] **Step 3: Merge the trailing `:root` blocks (~895, ~938) into one**

Move `--accent-2`, `--glow`, `--side-collapsed` into a single `:root`; delete the duplicate `--ease`/`--side-ease` redefinitions so each token is defined once. Keep `@property --hue{...}` in place. If any token (e.g. `--border`) is defined twice with the same value, keep one.

- [ ] **Step 4: Verify**

Run: `grep -cE "^\s*:root" public/css/configure.css` → fewer than 4.
Run: `grep -nE "\-\-ease:|--side-ease:" public/css/configure.css` → each exactly once.

- [ ] **Step 5: Commit**

```bash
git add public/css/configure.css
git commit -m "refactor(css): consolidate :root + add motion token system"
```

---

## Task 2: Replace `transition: all` with presets

**Files:** Modify `public/css/configure.css` (lines ~101,185,259,279,295,341,363,390,419,489,496,500,762,796)

- [ ] **Step 1: List sites** — Run: `grep -n "transition: all" public/css/configure.css` (expect 14).

- [ ] **Step 2: Replace each** — `transition: all <dur>;` → `transition: var(--t-colors);` for color-only hovers (most), or `transition: var(--t-colors), var(--t-pop);` for elements that also lift/shadow on hover (CTA buttons ~363, ~390). Inspect each rule's `:hover` to choose; default to `var(--t-colors)`.

- [ ] **Step 3: Verify** — Run: `grep -c "transition: all" public/css/configure.css` → `0`.

- [ ] **Step 4: Browser check** — `npm start`, open `http://localhost:7000/configure`, hover primary buttons / `.cat-test-btn` / `.range-tab`; confirm smooth ~120ms color transitions, no layout shift.

- [ ] **Step 5: Commit**

```bash
git add public/css/configure.css
git commit -m "refactor(css): replace transition:all with motion presets"
```

---

## Task 3: Normalize hover / active / focus-visible

**Files:** Modify `public/css/configure.css`

- [ ] **Step 1: Inventory** — Run: `grep -nE "\.(nav-item|btn|swatch|switch|range-tab|cat-[a-z-]+btn|tile|card)[^{]*:hover" public/css/configure.css`. Note which lack `:hover` or `:focus-visible`.

- [ ] **Step 2: Add a shared focus ring** near the top control styles:

```css
.nav-item:focus-visible, button:focus-visible, .swatch:focus-visible,
.range-tab:focus-visible, a.btn:focus-visible, .input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Standardize hover lift** on interactive cards/buttons missing it:

```css
.btn-soft:hover, .tile:hover, .card:hover { transform: translateY(-1px); }
.btn-soft:active, .tile:active, .card:active { transform: translateY(0); }
```

Add `transition: var(--t-pop), var(--t-colors);` to those selectors if absent. Only touch elements that don't already match the vocabulary.

- [ ] **Step 4: Browser check** — Tab through the Catalogs tab via browser MCP; confirm consistent focus ring + uniform hover lift.

- [ ] **Step 5: Commit**

```bash
git add public/css/configure.css
git commit -m "style(css): unify hover/active/focus-visible vocabulary"
```

---

## Task 4: Scroll flow — smooth scroll, themed scrollbars, overscroll

**Files:** Modify `public/css/configure.css`

- [ ] **Step 1: Add themed scrollbars + scroll tokens** (append a new block, near the body styles):

```css
/* themed scrollbars */
html { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--accent); background-clip: padding-box; }
/* smooth scroll only when motion is allowed */
html.js-reveal { scroll-behavior: smooth; }
/* keep inner scroll areas from chaining/jittering */
.mdblist-browse-grid, .log-table-wrap { overscroll-behavior: contain; }
```

- [ ] **Step 2: Add `scrollbar-gutter` to the main scroll container** — find the primary content scroller (the `.content`/`.app` wrapper around `.page`); add `scrollbar-gutter: stable;` to whichever element owns the vertical scroll (verify with `grep -nE "\.content\b|\.app\b" public/css/configure.css`).

- [ ] **Step 3: Browser check** — Reload; confirm scrollbars are thin/dark with accent-on-hover thumb, and the mdblist browse grid / log table scroll without chaining to the page.

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css
git commit -m "feat(css): themed scrollbars, gated smooth-scroll, overscroll containment"
```

---

## Task 5: Reveal module — motion gate + dev toggle (safety spine) + unit test

**Files:** Create `public/js/reveal.js`, `test/reveal-gate.test.js`; Modify `public/configure.html`, `package.json`, `public/css/configure.css` (reduced-motion block ~line 38)

- [ ] **Step 1: Write the failing test** — `test/reveal-gate.test.js`:

```js
const assert = require('assert');
const { shouldAnimate } = require('../public/js/reveal.js');

let pass = 0;
function t(name, fn) { fn(); console.log('  ✓ ' + name); pass++; }

t('animates when motion not reduced', () => assert.strictEqual(shouldAnimate({ reduced: false, forced: false }), true));
t('suppressed when reduced and not forced', () => assert.strictEqual(shouldAnimate({ reduced: true, forced: false }), false));
t('forced wins over reduced', () => assert.strictEqual(shouldAnimate({ reduced: true, forced: true }), true));
t('forced with no reduced still animates', () => assert.strictEqual(shouldAnimate({ reduced: false, forced: true }), true));
console.log(pass + ' tests: ' + pass + ' passed, 0 failed');
```

- [ ] **Step 2: Run it to verify it fails** — Run: `node test/reveal-gate.test.js`
Expected: FAIL — `Cannot find module '../public/js/reveal.js'`.

- [ ] **Step 3: Create `public/js/reveal.js`** (DOM-guarded so it loads in Node for testing):

```js
(function (global) {
  // Pure decision: animate if explicitly forced, else only when motion isn't reduced.
  function shouldAnimate(opts) {
    const o = opts || {};
    return !!o.forced || !o.reduced;
  }

  if (typeof document !== 'undefined') {
    try {
      var params = new URLSearchParams(location.search);
      if (params.get('motion') === 'force') localStorage.setItem('forceMotion', '1');
      if (params.get('motion') === 'off') localStorage.removeItem('forceMotion');
    } catch (e) {}
    var forced = false;
    try { forced = localStorage.getItem('forceMotion') === '1'; } catch (e) {}
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (forced) document.documentElement.classList.add('force-motion');

    if (shouldAnimate({ reduced: reduced, forced: forced })) {
      var root = document.documentElement;
      root.classList.add('js-reveal');

      // on-scroll reveal (one-shot)
      var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('revealed'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }) : null;
      function observeAll() {
        if (!io) return;
        document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(function (el) { io.observe(el); });
      }
      document.addEventListener('DOMContentLoaded', observeAll);

      // tab-open stagger: when a .page gains .on, index its children
      function staggerPage(page) {
        if (!page) return;
        page.classList.add('reveal-seq');
        var kids = page.children, i = 0;
        for (var k = 0; k < kids.length && i < 12; k++, i++) kids[k].style.setProperty('--i', i);
        observeAll();
      }
      window.addEventListener('hashchange', function () {
        var on = document.querySelector('.page.on'); staggerPage(on);
      });
      document.addEventListener('DOMContentLoaded', function () { staggerPage(document.querySelector('.page.on')); });

      // parallax: single rAF-throttled scroll handler over decorative accents
      var ticking = false;
      function onScroll() {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () {
          var y = window.scrollY || 0;
          document.documentElement.style.setProperty('--par', (y * 0.04).toFixed(1) + 'px');
          ticking = false;
        });
      }
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { shouldAnimate };
  else global.Reveal = { shouldAnimate: shouldAnimate };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes** — Run: `node test/reveal-gate.test.js`
Expected: `4 tests: 4 passed, 0 failed`.

- [ ] **Step 5: Rewrite the reduced-motion CSS block (~line 38) to honor force-motion**

Replace:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; }
}
```
with:
```css
@media (prefers-reduced-motion: reduce) {
  html:not(.force-motion) *,
  html:not(.force-motion) *::before,
  html:not(.force-motion) *::after { animation: none !important; }
}
```
Do NOT touch the deliberate `!important` overrides (`.gbrand*`, `status-blink`) near lines ~1105–1120.

- [ ] **Step 6: Include the script + register the test**

In `public/configure.html`, add near other early `js/` scripts (e.g. after `js/theme.js`):
```html
<script src="js/reveal.js"></script>
```
In `package.json`, append ` && node test/reveal-gate.test.js` to the end of the `test` script string.

- [ ] **Step 7: Verify wiring** — Run: `npm test` → all suites including `reveal-gate` pass. Open `/configure?motion=force` and `evaluate` `document.documentElement.classList.contains('js-reveal')` → `true`; open `/configure?motion=off` then reload (with OS reduced-motion ON) → `js-reveal` absent.

- [ ] **Step 8: Commit**

```bash
git add public/js/reveal.js test/reveal-gate.test.js public/configure.html package.json public/css/configure.css
git commit -m "feat(motion): reveal gate + dev force-motion toggle; reduced-motion safe"
```

---

## Task 6: Tab-open staggered reveal (CSS)

**Files:** Modify `public/css/configure.css`

- [ ] **Step 1: Add stagger CSS** (gated under `html.js-reveal`):

```css
@keyframes reveal-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
html.js-reveal .page.reveal-seq > * {
  animation: reveal-rise var(--dur-slow) var(--ease-out) both;
  animation-delay: calc(var(--i, 0) * 40ms);
}
```

- [ ] **Step 2: Confirm fallback safety** — Because the rule is under `html.js-reveal` (added only when motion allowed), reduced-motion users never get `opacity:0`. Verify: `grep -n "html.js-reveal .page.reveal-seq" public/css/configure.css`.

- [ ] **Step 3: Browser check** — `/configure?motion=force`: switch tabs; confirm child blocks rise+fade in sequence. With reduced-motion + no force: switch tabs; confirm content appears instantly and fully visible.

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css
git commit -m "feat(motion): staggered tab-open reveal"
```

---

## Task 7: On-scroll reveal hooks (CSS + markup)

**Files:** Modify `public/css/configure.css`, `public/configure.html`

- [ ] **Step 1: Add reveal CSS** (gated):

```css
html.js-reveal [data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out); will-change: opacity, transform; }
html.js-reveal [data-reveal].revealed { opacity: 1; transform: none; will-change: auto; }
```

- [ ] **Step 2: Add `data-reveal` to major content blocks** — In `configure.html`, add `data-reveal` to top-level section/card containers on the longer tabs (Catalogs sections, Dashboard cards group, Health cards, Servers cards). For data-heavy lists (Log stream `.log-table-wrap`, large tables), add `data-reveal` to the *container*, NOT each row. Identify blocks with `grep -nE "class=\"(block|card|panel|section|dash-cards|tiles)" public/configure.html | head -40`.

- [ ] **Step 3: Browser check** — `/configure?motion=force`: scroll a long tab (Catalogs); confirm blocks fade/rise as they enter view, once each. With reduced-motion + no force: confirm all blocks visible without scrolling trigger.

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css public/configure.html
git commit -m "feat(motion): on-scroll reveal for content blocks"
```

---

## Task 8: Parallax accents

**Files:** Modify `public/css/configure.css`

- [ ] **Step 1: Apply the `--par` scroll variable** (set by reveal.js) to decorative accents, gated:

```css
html.js-reveal .bg .o1 { transform: translateY(calc(var(--par, 0px) * 1)); }
html.js-reveal .bg .o2 { transform: translateY(calc(var(--par, 0px) * -0.6)); }
html.js-reveal .bg .o3 { transform: translateY(calc(var(--par, 0px) * 0.4)); }
```

Note: the orbs already have `animation` (float). Use `translate` on the element while the keyframes handle their own transform on a child if conflict arises; if the orbs animate `transform` directly, instead apply `--par` to a wrapping `.bg` translate: `html.js-reveal .bg { transform: translateY(calc(var(--par,0px) * 0.5)); }` — verify which by `grep -nE "\.bg|\.orb|orb1|orb2|orb3" public/css/configure.css` and pick the non-conflicting target.

- [ ] **Step 2: Browser check** — `/configure?motion=force`: scroll; confirm background drifts subtly at a different rate than content, no jank (watch for dropped frames). With reduced-motion + no force: no parallax, static background.

- [ ] **Step 3: Commit**

```bash
git add public/css/configure.css
git commit -m "feat(motion): subtle scroll parallax on background accents"
```

---

## Task 9: Coverage sweep — all 13 tabs

**Files:** Modify `public/css/configure.css`, `public/configure.html`

- [ ] **Step 1: Walk each tab** (Dashboard, Servers, Catalogs, Streaming, Appearance, API Keys, Health, Ping, Log, Settings, Users, Billing, Admin) via browser MCP at `/configure?motion=force`, desktop (1280) + narrow (480). For each, confirm: interactive elements have unified hover/focus (Task 3), major blocks have `[data-reveal]` (Task 7), scroll areas are themed (Task 4).

- [ ] **Step 2: Fill gaps** — Add missing `data-reveal` hooks / hover states found in Step 1. Skip per-row reveal on Log/large tables (container only).

- [ ] **Step 3: Verify safety on every tab** — With OS reduced-motion ON and NO force: visit each tab; confirm zero stuck-hidden content (everything visible).

- [ ] **Step 4: Commit**

```bash
git add public/css/configure.css public/configure.html
git commit -m "style(motion): coverage sweep across all 13 tabs"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend + gate tests** — Run: `npm test` → all 19 files green (18 existing + reveal-gate).

- [ ] **Step 2: No regressions in tokens/transitions** — Run: `grep -c "transition: all" public/css/configure.css` → `0`; `grep -cE "^\s*:root" public/css/configure.css` → < 4.

- [ ] **Step 3: Motion-OFF safety sweep (the critical check)** — OS reduced-motion ON, no `?motion=force`: via browser MCP, for all 13 tabs assert no element has computed `opacity: 0` that should be visible (spot-check `[data-reveal]` blocks render at opacity 1). Confirm smooth-scroll is OFF (instant) and parallax is OFF.

- [ ] **Step 4: Motion-ON experience sweep** — `/configure?motion=force`: confirm smooth scroll, themed scrollbars, tab-open stagger, on-scroll reveals (one-shot), parallax — all fire, no jank/CLS. Screenshot Dashboard, Catalogs, Admin at 1280 + 480.

- [ ] **Step 5: Final commit (if Step 3/4 produced fixes)**

```bash
git add public/css/configure.css public/js/reveal.js public/configure.html
git commit -m "fix(motion): verification-pass fixes"
```

---

## Self-Review

- **Spec coverage:** motion foundation (T1–T3) ✓; scroll flow + scrollbars + overscroll (T4) ✓; reveal module + gate + dev toggle + reduced-motion rewrite (T5) ✓; staggered tab-open reveal (T6) ✓; on-scroll reveal (T7) ✓; parallax accents (T8) ✓; coverage sweep all 13 tabs (T9) ✓; safety spine `html.js-reveal` (T5–T9, verified T10 Step 3) ✓; unit test for gate (T5) ✓; npm test green + browser verification (T10) ✓.
- **Placeholder scan:** no TBD/TODO; all CSS/JS shown literally; commands have expected output. Task 8 Step 1 gives an explicit fallback decision rule (not a vague "handle conflict").
- **Name consistency:** `shouldAnimate({reduced,forced})`, `html.js-reveal`, `html.force-motion`, `forceMotion` localStorage key, `?motion=force`/`?motion=off`, `[data-reveal]`/`.revealed`, `.reveal-seq`/`--i`, `--par`, and the `--dur-*`/`--t-*`/`--ease-out` tokens are used identically across all tasks.
