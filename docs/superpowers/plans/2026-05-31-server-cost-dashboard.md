# Server Cost + Dashboard Glow Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-server cost (amount + billing period) edited in Manage Server and shown on restyled dashboard cards, restyle the dashboard server cards as OMEGA-sized neon-glass 3D cards with the official Emby/Jellyfin brand logo (animated), and add a normalized total-cost tile.

**Architecture:** Frontend-only (configure UI). New `cost`/`costPeriod` fields ride along each server entry in the existing config (additive). `buildServerBlock` adds the cost inputs to the shared server edit form; `renderDashboard` is rewritten to emit glow cards with brand SVGs, a cost row, and a Manage button; a 5th top tile shows the monthly-normalized total + yearly equivalent.

**Tech Stack:** Vanilla JS/CSS, no build step. Browser verification (no frontend test harness); pure cost math exposed on `window` and checked in-browser.

---

## Verification convention

Server runs on `http://localhost:7000`. Browser caches — append `?v=N` to bust cache. Each task: load the page, confirm rendering + **zero console errors** (favicon 404 OK), exercise the behavior in the console, and confirm `npm test` stays at baseline **46 pass / 2 fail**. Commit only after checks pass. Do not push (controller pushes at end).

---

## Task 1: Per-server cost fields + collection + monthlyCost helper

**Files:**
- Modify: `public/js/configure.js` (`buildServerBlock`, `addServer`, `collectConfig`, add `monthlyCost`)

- [ ] **Step 1: Add the cost inputs to the server edit form**

In `buildServerBlock(id)`, the `.sc-edit` container holds the `.f-*` credential fields. Add a Cost field group alongside them (place it after the thumbnail/emoji area — match the existing field markup style). Insert this HTML into the fields markup:
```html
<div class="field-group">
  <label>Cost (optional)</label>
  <div style="display:flex;gap:8px">
    <input class="f-cost" type="number" min="0" step="0.01" placeholder="0.00" style="flex:1" />
    <select class="f-cost-period">
      <option value="none">No cost</option>
      <option value="monthly">Monthly</option>
      <option value="quarterly">Quarterly</option>
      <option value="yearly">Yearly</option>
    </select>
  </div>
</div>
```
(If `buildServerBlock` builds the fields as a template string assigned to `.sc-edit`, add this block inside that string. Keep all existing `.f-*` fields unchanged.)

- [ ] **Step 2: Populate the inputs when a server is restored**

In `addServer(data = null)`, where it sets `.f-label`/`.f-url`/etc. from `data`, add:
```js
    if (block.querySelector('.f-cost')) block.querySelector('.f-cost').value = (data.cost != null ? data.cost : '');
    if (block.querySelector('.f-cost-period')) block.querySelector('.f-cost-period').value = data.costPeriod || 'none';
```

- [ ] **Step 3: Read cost in collectConfig**

In `collectConfig`, in the per-block loop where `entry` is built and `thumbnail`/`emoji` are conditionally added, add:
```js
    const costRaw = block.querySelector('.f-cost')?.value.trim() || '';
    const costPeriod = block.querySelector('.f-cost-period')?.value || 'none';
    const cost = costRaw === '' ? NaN : Number(costRaw);
    if (!Number.isNaN(cost) && cost > 0 && costPeriod !== 'none') { entry.cost = cost; entry.costPeriod = costPeriod; }
```

- [ ] **Step 4: Add the `monthlyCost` helper (exposed for verification)**

Near the top of configure.js (module scope), add:
```js
function monthlyCost(cost, period) {
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (period === 'monthly')   return c;
  if (period === 'quarterly') return c / 3;
  if (period === 'yearly')    return c / 12;
  return 0;
}
window.monthlyCost = monthlyCost;
```

- [ ] **Step 5: Verify**

Run `npm start`, open `/configure?v=1#/servers`. Manage a server → the Cost input + period dropdown appear. Set cost 20, period Monthly. In console: `collectConfig(true).servers[0]` → has `cost:20, costPeriod:'monthly'`. Set period back to "No cost" → the entry omits `cost`/`costPeriod`. Console: `[monthlyCost(20,'monthly'), monthlyCost(30,'quarterly'), monthlyCost(120,'yearly'), monthlyCost(5,'none')]` → `[20, 10, 10, 0]`. Reload (?v=1b) after saving → cost fields restore. Zero console errors; `npm test` baseline.

- [ ] **Step 6: Commit**

```bash
git add public/js/configure.js
git commit -m "Add per-server cost fields (cost + billing period) and monthlyCost helper"
```

---

## Task 2: Dashboard glow cards — brand logos, cost row, Manage, total tile

**Files:**
- Modify: `public/configure.html` (`#page-dashboard`: add the 5th tile)
- Modify: `public/js/configure.js` (rewrite `renderDashboard` card markup; add brand SVGs, cost row, total tile, `openServerManage`)
- Modify: `public/css/configure.css` (glow card + animated brand badge + 5th tile + grid)

- [ ] **Step 1: Add the 5th total-cost tile to the dashboard**

In `#page-dashboard`, in the `.tiles` block, after the `tile-ping` tile add:
```html
    <div class="tile t5"><div class="n" id="tile-cost">$0</div><div class="l" id="tile-cost-l">Total cost</div></div>
```

- [ ] **Step 2: Add brand SVG constants + openServerManage to configure.js**

At module scope add the two logo SVGs (white marks on transparent; the badge background supplies brand color) and the manage navigator:
```js
const EMBY_SVG = '<svg viewBox="0 0 100 100" aria-label="Emby"><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="9" stroke-dasharray="188 64" transform="rotate(-32 50 50)"/><path d="M41 33 L70 50 L41 67 Z" fill="#fff"/></svg>';
const JELLYFIN_SVG = '<svg viewBox="0 0 100 100" aria-label="Jellyfin"><path d="M50 14C44 30 30 41 30 59a20 20 0 0 0 40 0C70 41 56 30 50 14Z" fill="#fff"/><path d="M50 42c-3 8-9 12-9 20a9 9 0 0 0 18 0c0-8-6-12-9-20Z" fill="#6a3a8c"/></svg>';

function openServerManage(index) {
  location.hash = '#/servers';
  setTimeout(() => {
    const cards = document.querySelectorAll('#servers-container .server-card');
    const card = cards[index];
    if (!card) return;
    const edit = card.querySelector('.sc-edit');
    if (edit && edit.style.display === 'none') {
      const id = parseInt(card.id.replace('server-', ''), 10);
      if (typeof toggleManage === 'function') toggleManage(id);
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}
```

- [ ] **Step 3: Rewrite the card markup in renderDashboard**

Replace the per-server card construction (the block that sets `card.className='dash-card'` and the `card.innerHTML=...` template) with the glow card. Keep the cache/fetch logic; only the markup + the elements the stats write to change. Use this card builder inside the `servers.map(async (s, idx) => {` callback (add `idx` to the map signature):
```js
      const PALETTE = [
        ['linear-gradient(135deg,#fb923c,#f472b6)','rgba(244,114,182,.5)'],
        ['linear-gradient(135deg,#818cf8,#22d3ee)','rgba(34,211,238,.5)'],
        ['linear-gradient(135deg,#34d399,#22d3ee)','rgba(52,211,153,.5)'],
        ['linear-gradient(135deg,#f59e0b,#fb7185)','rgba(245,158,11,.5)'],
        ['linear-gradient(135deg,#a78bfa,#f472b6)','rgba(167,139,250,.5)'],
      ];
      const [bar, glow] = PALETTE[idx % PALETTE.length];
      const isJelly = (s.type === 'jellyfin');
      const brandSvg = isJelly ? JELLYFIN_SVG : EMBY_SVG;
      const brandName = isJelly ? 'Jellyfin' : 'Emby';
      const badgeBg = isJelly ? 'linear-gradient(135deg,#aa5cc3,#00a4dc)' : 'linear-gradient(135deg,#52b54b,#2f8f3e)';
      const costStr = (s.cost && s.costPeriod)
        ? '$' + Number(s.cost).toFixed(2) + ' / ' + ({monthly:'mo',quarterly:'qtr',yearly:'yr'}[s.costPeriod] || s.costPeriod)
        : '— not set';
      const card = document.createElement('div');
      card.className = 'gcard';
      card.style.setProperty('--bar', bar);
      card.style.setProperty('--accentglow', glow);
      card.style.setProperty('--badgebg', badgeBg);
      card.innerHTML = `
        <div class="gcard-top"></div>
        <div class="gcard-pad">
          <div class="gcard-head">
            <div><div class="gbrand">${brandSvg}</div><div class="gtype">${brandName}</div></div>
            <span class="sc-badge unknown">● …</span>
          </div>
          <div class="gcard-nm">${escHtml(s.label)}</div>
          <div class="gcard-host">${escHtml((s.url||'').replace(/^https?:\/\//,''))}</div>
          <div class="grow"><span>🎞 Movies</span><span class="v" data-st="movies">—</span></div>
          <div class="grow"><span>📺 Shows</span><span class="v" data-st="shows">—</span></div>
          <div class="grow"><span>▦ Episodes</span><span class="v" data-st="episodes">—</span></div>
          <div class="grow price"><span>💵 Price</span><span class="v">${escHtml(costStr)}</span></div>
          <button class="gmanage" type="button">Manage Server →</button>
        </div>`;
      card.querySelector('.gmanage').addEventListener('click', () => openServerManage(idx));
      wrap.appendChild(card);
```
Then update the stat-writing code (both the cache branch and the fetch-success branch) to target the new elements. Replace the `card.querySelectorAll('.mc .n')` lookups with a helper used in both branches:
```js
      const setStats = (st) => {
        card.querySelector('[data-st=movies]').textContent   = (st.movies||0).toLocaleString();
        card.querySelector('[data-st=shows]').textContent    = (st.shows||0).toLocaleString();
        card.querySelector('[data-st=episodes]').textContent = (st.episodes||0).toLocaleString();
      };
```
In the cache branch use `setStats(cached);` (instead of the old `mc[...]` writes). In the fetch-success branch use `setStats(st);`. The `.sc-badge` selector stays the same (the new markup keeps `.sc-badge`). Keep all upCount/movieTotal/fastest/cache-save logic unchanged.

- [ ] **Step 4: Compute and show the total-cost tile**

After the `Promise.all(...)`, where `setTxt('tile-ping', ...)` etc. run, add:
```js
    const totalMo = servers.reduce((a, s) => a + monthlyCost(s.cost, s.costPeriod), 0);
    setTxt('tile-cost', '$' + Math.round(totalMo) + (totalMo > 0 ? '/mo' : ''));
    setTxt('tile-cost-l', 'Total cost · $' + Math.round(totalMo * 12) + '/yr');
```

- [ ] **Step 5: Add the CSS**

Append to `public/css/configure.css`:
```css
/* ===== dashboard glow cards ===== */
.dash-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
@keyframes haloPulse { 0%,100%{ box-shadow:0 0 0 0 var(--gbglow), 0 6px 16px var(--gbglow); } 50%{ box-shadow:0 0 22px 4px var(--gbglow), 0 6px 16px var(--gbglow); } }
@keyframes floaty { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-3px); } }
@keyframes brandSheen { 0%{ transform:translateX(-140%) rotate(12deg); } 55%,100%{ transform:translateX(260%) rotate(12deg); } }
.gcard { position: relative; background: linear-gradient(160deg, rgba(34,27,45,.9), rgba(16,12,22,.95)); border: 1px solid rgba(255,255,255,.08); border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,.55), 0 2px 0 rgba(255,255,255,.05) inset; transition: transform .3s, box-shadow .3s; }
.gcard:hover { transform: perspective(900px) rotateX(3deg) translateY(-5px); box-shadow: 0 22px 50px rgba(0,0,0,.6), 0 0 30px var(--accentglow); }
.gcard-top { height: 5px; background: var(--bar); box-shadow: 0 0 14px var(--accentglow); }
.gcard-pad { padding: 16px; }
.gcard-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.gbrand { --gbglow: var(--accentglow); position: relative; width: 48px; height: 48px; border-radius: 13px; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.18), rgba(255,255,255,0) 60%), var(--badgebg); animation: haloPulse 2.4s ease-in-out infinite, floaty 3.6s ease-in-out infinite; overflow: hidden; }
.gbrand::after { content: ''; position: absolute; top: 0; left: 0; width: 38%; height: 100%; background: linear-gradient(transparent, rgba(255,255,255,.5), transparent); animation: brandSheen 4s ease-in-out infinite; opacity: .7; }
.gbrand svg { width: 30px; height: 30px; position: relative; z-index: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
.gtype { font-size: .56rem; font-weight: 800; letter-spacing: .08em; color: var(--text-dim); margin-top: 5px; text-transform: uppercase; }
.gcard-nm { font-size: 1.05rem; font-weight: 800; }
.gcard-host { font-size: .64rem; color: var(--text-mute); margin-bottom: 11px; }
.grow { display: flex; justify-content: space-between; padding: 8px 11px; border-radius: 9px; margin-bottom: 6px; font-size: .78rem; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.05); }
.grow .v { font-weight: 800; }
.grow.price .v { color: #fcd34d; }
.gmanage { width: 100%; margin-top: 6px; padding: 11px; border: none; border-radius: 11px; background: var(--bar); color: #0b0910; font-weight: 800; font-size: .82rem; cursor: pointer; box-shadow: 0 6px 16px var(--accentglow); }
.tiles { grid-template-columns: repeat(5, 1fr); }
.t5 { background: linear-gradient(150deg, #fcd34d, #f59e0b); }
@media (max-width: 720px) { .tiles { grid-template-columns: repeat(2, 1fr); } .dash-cards { grid-template-columns: 1fr; } }
```
Note: a `.tiles { grid-template-columns: repeat(4,1fr); }` rule already exists from the first dashboard build — this new `.tiles` rule comes later in the file and overrides it to 5 columns. The reduced-motion block (`@media (prefers-reduced-motion: reduce){ *,*::before,*::after{ animation:none!important; transition:none!important } }`) already exists and disables the pulse/float/sheen/tilt — confirm it's still present.

- [ ] **Step 6: Verify**

Run `npm start`, open `/configure?v=2`. With servers configured (the live config has 6):
- Dashboard shows roomy glow cards in a responsive grid (~2–3/row). Hover → 3D tilt + glow.
- Emby servers show the green Emby mark + "Emby"; set a server's type to Jellyfin → it shows the purple-blue Jellyfin mark. The badge pulses/floats/sheens.
- Each card shows Movies/Shows/Episodes + a gold Price row ("— not set" when no cost).
- Set a cost on a couple of servers (Servers page), return to Dashboard → those cards show "$X / mo"; the **5th gold tile** shows the monthly total + "· $Y/yr".
- Click **Manage Server** on a card → navigates to `#/servers` and opens that server's edit form.
- DevTools "Emulate prefers-reduced-motion" → animations freeze.
- Zero console errors (favicon OK); `npm test` baseline.

- [ ] **Step 7: Commit**

```bash
git add public/configure.html public/js/configure.js public/css/configure.css
git commit -m "Restyle dashboard server cards (glow 3D + brand logos + cost) and add total-cost tile"
```

---

## Task 3: End-to-end verification

**Files:** none (verification)

- [ ] **Step 1: Cost math + total**

Run `npm start`, open `/configure?v=3`. In console: `[monthlyCost(20,'monthly'),monthlyCost(30,'quarterly'),monthlyCost(120,'yearly'),monthlyCost(0,'monthly')]` → `[20,10,10,0]`. Configure servers with mixed periods, confirm `#tile-cost` = `$<sum-of-normalized>/mo` and `#tile-cost-l` ends with the ×12 yearly figure.

- [ ] **Step 2: Brand + animation + manage**

Confirm Emby vs Jellyfin marks switch by `server.type`; the badge animates; Manage button opens the right server's edit form on the Servers page. Reduced-motion freezes animations.

- [ ] **Step 3: Config round-trip**

Set costs, generate an install link, decode its config token (base64url) → confirm `servers[i].cost`/`costPeriod` present for the ones set and absent for the rest. Reload → cost fields and dashboard tiles restore. Confirm a config WITHOUT any cost still works (total tile shows `$0`, cards show "— not set").

- [ ] **Step 4: Cross-page smoke**

Walk `#/dashboard`, `#/servers`, `#/catalogs`, `#/streaming`, `#/appearance`, `#/health` — zero console errors. `npm test` baseline 46/2.

- [ ] **Step 5: Commit (if fixes needed)**

```bash
git add -A
git commit -m "Verify server cost + dashboard glow cards end-to-end"
```

---

## Self-review notes

- **Spec coverage:** cost fields + collect + monthlyCost (T1); glow cards + brand SVGs + cost row + Manage + total tile + CSS (T2); e2e (T3). All spec sections mapped.
- **Additive schema:** `cost`/`costPeriod` added only when set; absent otherwise; install-link/config format otherwise unchanged.
- **Naming consistency:** `monthlyCost`, `openServerManage`, `EMBY_SVG`/`JELLYFIN_SVG`, `.gcard`/`.gbrand`/`.gtype`/`.grow`/`.gmanage`, `tile-cost`/`tile-cost-l`, `.f-cost`/`.f-cost-period` used consistently.
- **Reduced motion:** existing media block covers the new animations (confirmed in T2 Step 5).
- **Risk (manage-by-index):** dashboard and Servers cards share `cfg.servers` order; `openServerManage` guards on a missing card (no-op + still navigates to `#/servers`).
```
