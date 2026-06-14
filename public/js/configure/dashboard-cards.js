// configure/dashboard-cards.js — gcard builder, skeleton, activity shell
function dashActivityEsc(x) {
  return (typeof escHtml === 'function') ? escHtml(x) : String(x == null ? '' : x);
}

function dashActivityHasContent(el) {
  return !!(el && el.querySelector('.dash-activity-grid[data-ready="1"]'));
}

function dashEmptyServersHtml() {
  return `<div class="dash-empty-state">
    <div class="dash-empty-glow" aria-hidden="true"></div>
    <div class="dash-empty-icon" aria-hidden="true">📡</div>
    <h4 class="dash-empty-title">Connect your first server</h4>
    <p class="dash-empty-copy">Add Emby or Jellyfin endpoints to unlock library stats, uptime charts, live playback, and watch history on this dashboard.</p>
    <button type="button" class="btn primary dash-empty-cta">Add server</button>
  </div>`;
}

function wireDashEmptyCta(root) {
  root?.querySelector?.('.dash-empty-cta')?.addEventListener('click', () => { location.hash = '#/servers'; });
}

const _DASH_CARD_PALETTE = [
  ['linear-gradient(135deg,#fb923c,#f472b6)','rgba(244,114,182,.5)'],
  ['linear-gradient(135deg,#818cf8,#22d3ee)','rgba(34,211,238,.5)'],
  ['linear-gradient(135deg,#34d399,#22d3ee)','rgba(52,211,153,.5)'],
  ['linear-gradient(135deg,#f59e0b,#fb7185)','rgba(245,158,11,.5)'],
  ['linear-gradient(135deg,#a78bfa,#f472b6)','rgba(167,139,250,.5)'],
];

/**
 * Single source of truth for a dashboard server card element.
 * Used by skeleton (initial/ cached view) and full/partial bundle apply paths.
 * Eliminates HTML drift and makes future state (incl. degraded) easier to keep consistent.
 */
function _createDashboardGCard(s, idx, enhance = {}) {
  const PALETTE = _DASH_CARD_PALETTE;
  const [bar, glow] = PALETTE[idx % PALETTE.length];
  const isJelly = (s.type === 'jellyfin');
  const brandSvg = isJelly ? JELLYFIN_LOGO : EMBY_LOGO;
  const card = document.createElement('div');
  card.className = 'gcard';
  card.dataset.serverUrl = s.url || '';
  card.style.setProperty('--bar', bar);
  card.style.setProperty('--accentglow', glow);
  card.style.setProperty('--badgebg', isJelly ? 'linear-gradient(135deg,#aa5cc3,#00a4dc)' : 'linear-gradient(135deg,#52b54b,#2f8f3e)');

  // enhance may contain { conn, lib, healthRec, useCache, cached }
  const lib = enhance.lib || null;
  const healthRec = enhance.healthRec || null;
  const useCache = !!enhance.useCache;
  const cached = enhance.cached || null;

  let m = '—', sh = '—', ep = '—';
  let chipErr = '';
  if (lib && lib.ok) {
    m = (lib.movies || 0).toLocaleString();
    sh = (lib.shows || 0).toLocaleString();
    ep = (lib.episodes || 0).toLocaleString();
  } else if (useCache && cached) {
    m = (cached.movies || 0).toLocaleString();
    sh = (cached.shows || 0).toLocaleString();
    ep = (cached.episodes || 0).toLocaleString();
  } else if (lib && lib.ok === false) {
    m = '—'; sh = '—'; ep = '—';
    chipErr = ` title="${escHtml(lib.error || 'failed')}"`;
  } else if (!lib) {
    // skeleton or pending
    m = '…'; sh = '…'; ep = '…';
  }

  const healthHtml = healthRec && healthRec.history
    ? _dashHealthPanel(healthRec.history)
    : '<div class="gcard-health"></div>';

  const initialPillClass = (enhance.initialPillClass || 'loading');
  const initialPillTitle = (enhance.initialPillTitle || 'Bridge connection status');
  const initialPillText = (enhance.initialPillText || '…');

  card.innerHTML = `
    <div class="gcard-top"></div>
    <div class="gcard-pad">
      <div class="gcard-head">
        <div class="gbrand" style="--accentglow:${isJelly ? 'rgba(122,70,200,.7)' : 'rgba(82,181,75,.7)'}">${brandSvg}</div>
        <div style="flex:1;min-width:0">
          <div class="gcard-nm">${escHtml(s.label || 'Server')}</div>
          <div class="gcard-host">${escHtml((s.url || '').replace(/^https?:\/\//, ''))}</div>
        </div>
        <div class="gstatus"><span class="gpill ${initialPillClass}" data-pill title="${escHtml(initialPillTitle)}">${initialPillText}</span><span class="gbridge-now" data-bridge-ms title="Bridge latency now (addon → server)"></span></div>
      </div>
      <div class="gtype" style="display:none">${isJelly ? 'Jellyfin' : 'Emby'}</div>
      <div class="gchips">
        <div class="gchip"><div class="cn${chipErr ? ' gchip-err' : ''}" data-st="movies"${chipErr}>${m}</div><div class="ct">Movies</div></div>
        <div class="gchip"><div class="cn${chipErr ? ' gchip-err' : ''}" data-st="shows">${sh}</div><div class="ct">Shows</div></div>
        <div class="gchip"><div class="cn${chipErr ? ' gchip-err' : ''}" data-st="episodes">${ep}</div><div class="ct">Episodes</div></div>
      </div>
      <div class="gcard-ping-dots" aria-hidden="true"></div>
      ${healthHtml}
      <div class="gcard-status-log" data-status-log hidden></div>
    </div>`;

  if (enhance.healthRec && enhance.healthRec.history) {
    // paint immediately for optimistic skeleton path
    setTimeout(() => _paintPingDots(card, enhance.healthRec.history), 0);
  }
  return card;
}

function paintDashboardSkeleton() {
  const servers = _collectDashboardServers();
  const wrap = document.getElementById('dash-cards');
  if (!wrap) return 0;
  const now = Date.now();
  const n = servers.length;
  const statusEl = document.getElementById('dash-status');
  if (statusEl) {
    statusEl.textContent = n
      ? `Loading stats for ${n} server${n === 1 ? '' : 's'}…`
      : 'No servers yet — add one on the Servers page.';
  }
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (!n) {
    wrap.innerHTML = dashEmptyServersHtml();
    wireDashEmptyCta(wrap);
    return 0;
  }
  const existing = [...wrap.querySelectorAll('.gcard[data-server-url]')];
  if (existing.length === n && existing.every(card => servers.some(s => _normServerUrl(s.url) === _normServerUrl(card.dataset.serverUrl)))) {
    return n;
  }
  let cachedMovies = 0;
  let cachedShows = 0;
  wrap.innerHTML = '';
  servers.forEach((s, idx) => {
    const cacheKey = _libKey(s);
    const c = _libStatsCache[cacheKey];
    const hasLib = c && now - c.ts < LIB_TTL_MS;
    if (hasLib) {
      cachedMovies += c.movies || 0;
      cachedShows += c.shows || 0;
    }
    const cachedForCard = hasLib ? c : null;

    const card = _createDashboardGCard(s, idx, {
      useCache: true,
      cached: cachedForCard,
      initialPillClass: 'reachable',
      initialPillTitle: 'Checking connection…',
      initialPillText: '…',
    });
    wrap.appendChild(card);
    card.classList.add('skeleton');
    requestAnimationFrame(() => { card.style.animationDelay = `${idx * 55}ms`; });
  });
  _setDashNumber('tile-servers', n);
  if (cachedMovies || cachedShows) {
    _setDashNumber('tile-movies', cachedMovies);
    _setDashNumber('tile-shows', cachedShows);
  }
  window._lastDashSyncTs = Date.now();
  updateDashLastSync('just now');
  // paint initial pings from any cached health if present (skeleton path)
  try {
    const by = _healthHistoryCache && _healthHistoryCache.data;
    if (by) wrap.querySelectorAll('.gcard[data-server-url]').forEach(c => _paintPingsForCard(c, by));
  } catch {}
  wireDashServerFilters();
  _registerHealthServers(servers).catch(() => {});
  startDashTimestampTicker();
  return n;
}

function renderDashActivityShell(serverCount) {
  const el = document.getElementById('dash-activity');
  if (!el || dashActivityHasContent(el)) return;
  const n = serverCount || collectServersForLive().length || 0;
  // Improved: note possible slowness from unreachable servers (common in mixed fleets)
  el.innerHTML = `<div class="dash-activity-grid">
    <div class="dash-act-panel dash-act-live">
      <h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3>
      <div class="da-empty da-loading">Checking playback across ${n || 'your'} server${n === 1 ? '' : 's'}… (some may be slow/unreachable – see console for details)</div>
    </div>
    <div class="dash-act-panel dash-act-history">
      <h3 class="block-title dash-act-title">Recent activity</h3>
      <div class="da-empty da-loading">Loading Stremio + server history…</div>
    </div>
  </div>`;
}

function renderLiveProbeStrip(probes) {
  const list = (probes || []).filter(p => p && (p.server || p.label));
  if (!list.length) return '';
  const esc = dashActivityEsc;
  return `<div class="da-probes">${list.map(p => {
    const name = p.server || p.label;
    const cls = p.ok ? ((p.count || 0) > 0 ? 'ok-live' : 'ok-idle') : 'bad';
    const via = p.method ? ` via ${p.method}` : '';
    const detail = p.ok
      ? ((p.count || 0) > 0 ? `${p.count} playing${via}` : `idle${via}`)
      : esc(p.error || 'unreachable');
    return `<span class="da-probe ${cls}" title="${esc(name)} — ${detail}"><span class="da-probe-dot"></span>${esc(name)}</span>`;
  }).join('')}</div>`;
}

window.paintDashboardSkeleton = paintDashboardSkeleton;
window.renderDashActivityShell = renderDashActivityShell;
