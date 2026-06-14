// configure/dashboard-health.js — health pings, card status, filters
let _dashFilterSaveTimer = null;
function wireDashServerFilters() {
  const toolbar = document.getElementById('dash-servers-toolbar');
  const filterEl = document.getElementById('dash-filter');
  const sortEl = document.getElementById('dash-sort');
  const onlyIssuesEl = document.getElementById('dash-only-issues');
  const countEl = document.getElementById('dash-visible-count');
  const wrap = document.getElementById('dash-cards');
  if (!wrap || !toolbar) return;

  const LS_KEY = 'meb-dash-prefs-v2';
  // restore
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.q && filterEl) filterEl.value = s.q;
    if (s.sort && sortEl) sortEl.value = s.sort;
    if (typeof s.only === 'boolean' && onlyIssuesEl) onlyIssuesEl.checked = s.only;
  } catch {}

  const apply = () => {
    const q = (filterEl && filterEl.value || '').toLowerCase().trim();
    const sortMode = (sortEl && sortEl.value) || 'status';
    const onlyIssues = !!(onlyIssuesEl && onlyIssuesEl.checked);
    const cards = Array.from(wrap.querySelectorAll('.gcard[data-server-url]'));
    let visible = 0;

    cards.forEach(card => {
      const nm = (card.querySelector('.gcard-nm')?.textContent || '').toLowerCase();
      const host = (card.querySelector('.gcard-host')?.textContent || '').toLowerCase();
      const pill = card.querySelector('.gpill');
      const st = (pill?.className || '').includes('offline') ? 'down' : (pill?.className || '').includes('degraded') ? 'degraded' : 'ok';
      const msEl = card.querySelector('[data-bridge-ms]');
      const ms = msEl ? parseInt(msEl.textContent, 10) || 99999 : 99999;
      const movies = parseInt((card.querySelector('[data-st="movies"]')?.textContent || '0').replace(/[^\d]/g,'') || '0', 10);
      card._dashMeta = { nm, host, st, ms, movies, el: card };
      const isIssue = st !== 'ok';
      const match = !q || nm.includes(q) || host.includes(q);
      const show = match && (!onlyIssues || isIssue);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    let sorted = cards.filter(c => c.style.display !== 'none');
    if (sortMode === 'latency') sorted.sort((a,b) => (a._dashMeta.ms - b._dashMeta.ms) || a._dashMeta.nm.localeCompare(b._dashMeta.nm));
    else if (sortMode === 'name') sorted.sort((a,b) => a._dashMeta.nm.localeCompare(b._dashMeta.nm));
    else if (sortMode === 'library') sorted.sort((a,b) => (b._dashMeta.movies - a._dashMeta.movies) || a._dashMeta.nm.localeCompare(b._dashMeta.nm));
    else sorted.sort((a,b) => {
      const rank = s => s==='ok'?0 : s==='degraded'?1 : 2;
      return rank(a._dashMeta.st) - rank(b._dashMeta.st) || a._dashMeta.ms - b._dashMeta.ms || a._dashMeta.nm.localeCompare(b._dashMeta.nm);
    });
    sorted.forEach(c => wrap.appendChild(c));

    if (countEl) countEl.textContent = `${visible}/${cards.length}`;
    _updateFleetPulse();
    _wirePingDotInteractions();

    // persist (debounced)
    clearTimeout(_dashFilterSaveTimer);
    _dashFilterSaveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ q: filterEl?.value||'', sort: sortEl?.value||'status', only: !!onlyIssuesEl?.checked })); } catch {}
    }, 300);
  };

  const onChange = () => { clearTimeout(_dashFilterTimer); _dashFilterTimer = setTimeout(apply, 55); };
  if (filterEl) filterEl.addEventListener('input', onChange);
  if (sortEl) sortEl.addEventListener('change', apply);
  if (onlyIssuesEl) onlyIssuesEl.addEventListener('change', apply);

  // quick chips
  toolbar.querySelectorAll('.dash-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.quick;
      if (m === 'issues' && onlyIssuesEl) onlyIssuesEl.checked = true;
      else if (m === 'healthy' && onlyIssuesEl) onlyIssuesEl.checked = false;
      // 'all' leaves the checkbox as-is
      apply();
      // visual active
      toolbar.querySelectorAll('.dash-chip-btn').forEach(b => b.classList.toggle('on', b === btn));
    });
  });

  // keyboard: / focuses filter when dashboard visible
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.getElementById('page-dashboard')?.classList.contains('on')) {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      e.preventDefault();
      filterEl && filterEl.focus();
      filterEl && filterEl.select();
    }
  });

  // initial apply + wires
  requestAnimationFrame(() => {
    apply();
    _wirePingDotInteractions();
    _updateFleetPulse();
  });

  window._dashReapplyFilters = apply;
}

function _healthUrlsQuery() {
  const urls = new Set();
  [...document.querySelectorAll('.server-block .f-url, .server-card .f-url')]
    .map(el => (el.value || '').trim().replace(/\/+$/, ''))
    .filter(u => u && /^https?:\/\//i.test(u))
    .forEach(u => urls.add(u));
  if (!urls.size) {
    try {
      const cfg = collectConfig(true);
      (cfg?.servers || []).forEach(s => {
        const u = (s.url || '').trim().replace(/\/+$/, '');
        if (u && /^https?:\/\//i.test(u)) urls.add(u);
      });
    } catch { /* DOM may not be ready */ }
  }
  if (!urls.size) {
    document.querySelectorAll('#dash-cards .gcard[data-server-url]').forEach(card => {
      const u = (card.dataset.serverUrl || '').trim().replace(/\/+$/, '');
      if (u && /^https?:\/\//i.test(u)) urls.add(u);
    });
  }
  const list = [...urls];
  return list.length ? `?urls=${encodeURIComponent(list.join(','))}` : '';
}

function _invalidateHealthCache() {
  _healthHistoryCache = { ts: 0, data: null };
}

let _lastHealthKickTs = 0;
const HEALTH_KICK_MIN_MS = 60000;

async function _kickHealthPing() {
  try {
    await fetch('/api/health/ping-now', { method: 'POST', credentials: 'same-origin' });
    _invalidateHealthCache();
  } catch { /* best-effort */ }
}
window._kickHealthPing = _kickHealthPing;

async function _kickHealthPingThrottled() {
  const now = Date.now();
  if (now - _lastHealthKickTs < HEALTH_KICK_MIN_MS) return;
  _lastHealthKickTs = now;
  return _kickHealthPing();
}
window._kickHealthPingThrottled = _kickHealthPingThrottled;

let _healthHistoryCache = { ts: 0, data: null };
async function _fetchHealthByUrl() {
  const now = Date.now();
  if (_healthHistoryCache.data && (now - _healthHistoryCache.ts) < 25000) {
    return _healthHistoryCache.data;
  }
  try {
    const rows = await fetch(`/api/health/history${_healthUrlsQuery()}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []);
    const map = {};
    (rows || []).forEach(h => { map[_normServerUrl(h.url)] = h; });
    _healthHistoryCache = { ts: now, data: map };
    return map;
  } catch {
    return _healthHistoryCache.data || {};
  }
}

let _lastHealthRegisterKey = '';
let _lastHealthRegisterTs = 0;

async function _registerHealthServers(servers) {
  const payload = (servers || [])
    .filter(s => s?.url && s?.label)
    .map(s => ({ url: s.url, label: s.label, type: s.type || 'emby' }));
  if (!payload.length) return;
  const key = payload.map(s => s.url).sort().join('|');
  if (key === _lastHealthRegisterKey && Date.now() - _lastHealthRegisterTs < 30000) return;
  _lastHealthRegisterKey = key;
  _lastHealthRegisterTs = Date.now();
  try {
    await fetch('/api/health/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ servers: payload }),
    });
  } catch { /* best-effort */ }
}

function _dashboardBundleActive() {
  const onDash = document.getElementById('page-dashboard')?.classList.contains('on');
  const lc = window.DashboardState?.lifecycle;
  return onDash && (lc === 'ready' || lc === 'polling') && !!window.DashboardState?.lastBundle;
}

async function refreshDashCardHealth() {
  if (_dashBusy) return;
  if (_dashboardBundleActive()) return;
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  if (!cards.length) return;
  const byUrl = await _fetchHealthByUrl();
  cards.forEach(card => {
    const slot = card.querySelector('.gcard-health');
    if (!slot) return;
    const rec = byUrl[_normServerUrl(card.dataset.serverUrl)];
    slot.innerHTML = _dashHealthPanel(rec?.history || []);
    _paintPingsForCard(card, byUrl);
  });
  if (window._dashReapplyFilters) window._dashReapplyFilters();
}

function _applyDashCardStatus(card, online, bridgeMs, authenticated = true) {
  const pill = card.querySelector('[data-pill]');
  const msEl = card.querySelector('[data-bridge-ms]');
  if (!pill) return;
  if (!online) {
    pill.className = 'gpill offline';
    pill.textContent = 'OFFLINE';
    pill.title = 'Bridge cannot authenticate or reach this server';
  } else if (authenticated === false) {
    pill.className = 'gpill reachable';
    pill.textContent = 'REACHABLE';
    pill.title = 'Host responds to ping — verifying API access…';
  } else {
    pill.className = 'gpill online';
    pill.textContent = 'ONLINE';
    pill.title = 'Bridge reachable (authenticated)';
  }
  if (msEl) {
    if (online && bridgeMs != null) {
      msEl.textContent = bridgeMs + 'ms';
      msEl.className = 'gbridge-now ' + _srvPingClass(bridgeMs);
    } else {
      msEl.textContent = '';
      msEl.className = 'gbridge-now';
    }
  }
  card.dataset.st = online ? (authenticated === false ? 'reachable' : 'ok') : 'down';
  card.classList.remove('skeleton');
  card.classList.add('just-updated');
  setTimeout(() => card.classList.remove('just-updated'), 1100);
  if (typeof window._dashReapplyFilters === 'function') { try { window._dashReapplyFilters(); } catch {} }
}

function _applyDashCardStatusDegraded(card, bridgeMs, errMsg) {
  const pill = card.querySelector('[data-pill]');
  const msEl = card.querySelector('[data-bridge-ms]');
  const friendly = _friendlyDegradedError(errMsg);
  if (pill) {
    pill.className = 'gpill degraded';
    pill.textContent = 'DEGRADED';
    pill.title = friendly + ' — tap card for details';
  }
  if (msEl && bridgeMs != null) {
    msEl.textContent = bridgeMs + 'ms';
    msEl.className = 'gbridge-now ' + _srvPingClass(bridgeMs);
  }
  card.dataset.st = 'degraded';
  card.classList.remove('skeleton');
  card.classList.add('just-updated');
  setTimeout(() => card.classList.remove('just-updated'), 1100);
  if (typeof window._dashReapplyFilters === 'function') { try { window._dashReapplyFilters(); } catch {} }
  // enhance the status log entry with friendly + cache hint if we have prior good data

  if (card._statusLog && card._statusLog.length) {
    const last = card._statusLog[card._statusLog.length-1];
    if (last.state === 'degraded') {
      last.msg = friendly;
      // try to append last-good note from cache (best effort, urls normalized elsewhere)
      try {
        const url = card.dataset.serverUrl;
        const ck = Object.keys(_libStatsCache || {}).find(k => k.includes(url) || url.includes(k.split('|')[0]||''));
        if (ck && _libStatsCache[ck] && _libStatsCache[ck].ts) {
          const ago = Math.round((Date.now() - _libStatsCache[ck].ts)/60000);
          last.msg += ` (last good ~${ago}m ago)`;
        }
      } catch {}
    }
  }
}

function _friendlyDegradedError(raw) {
  const m = String(raw || '').toLowerCase();
  if (/502|server error|internal/i.test(m)) return 'Library fetch failed (server error on Emby/Jellyfin)';
  if (/timeout|timed out|abort/i.test(m)) return 'Connection timed out to server';
  if (/401|403|auth|unauthorized|forbidden/i.test(m)) return 'Authentication failed — check API key / User ID';
  if (/library stats failed|unavailable/i.test(m)) return 'Library/catalog data unavailable';
  return raw || 'Library unavailable';
}

function _recordDashStatusEvent(card, state, msg) {
  if (!card) return;
  if (!card._statusLog) card._statusLog = [];
  const last = card._statusLog[card._statusLog.length - 1];
  if (last && last.state === state && last.msg === msg && (Date.now() - last.ts < 20000)) return;
  card._statusLog.push({ ts: Date.now(), state, msg: msg || state });
  if (card._statusLog.length > 20) card._statusLog.shift(); // advanced history log: keep more for down/up timeline
  _paintDashStatusLog(card);
}

function _paintDashStatusLog(card) {
  const el = card.querySelector('[data-status-log]');
  if (!el) return;
  const log = card._statusLog || [];
  if (!log.length) { el.hidden = true; return; }
  el.hidden = false;
  const esc = (typeof escHtml === 'function') ? escHtml : (x) => String(x ?? '');
  // show more for advanced per-card server history log (downs, recoveries, etc)
  // Only the latest event as a compact per-card footer (prevents tall cards and visual overlap with the console below).
  // Full history stays in the unified BACKEND ACTIVITY console.
  el.innerHTML = log.slice(-1).reverse().map(e => {
    const t = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    let icon = '';
    if (e.state === 'degraded') icon = '⚠ ';
    else if (e.state === 'offline') icon = '⛔ ';
    else if (e.state === 'online' || e.state === 'reachable') icon = '✅ ';
    const msg = icon + esc(e.msg);
    return `<div class="gstatus-line gstatus-${esc(e.state)}"><span class="gstatus-ts">${t}</span><span class="gstatus-msg">${msg}</span></div>`;
  }).join('');
}

function _syncDashCardStatus(card, bundle) {
  const url = card.dataset.serverUrl;
  const conn = _bundleConnByUrl(bundle, url);
  const lib = _bundleLibByUrl(bundle, url);
  const healthByUrl = _healthMapFromBundle(bundle.health);
  const healthRec = healthByUrl[_normServerUrl(url)];

  if (conn) {
    if (!conn.ok) {
      _recordDashStatusEvent(card, 'offline', conn.error || 'Connection failed');
      _applyDashCardStatus(card, false, conn.bridgeMs);
      return;
    }
    if (lib && lib.ok === false) {
      _recordDashStatusEvent(card, 'degraded', lib.error || 'Library unavailable');
      _applyDashCardStatusDegraded(card, conn.bridgeMs, lib.error);
      return;
    }
    if (lib && lib.ok) _recordDashStatusEvent(card, 'online', 'Library OK');
    else _recordDashStatusEvent(card, 'online', 'API reachable');
    _applyDashCardStatus(card, true, conn.bridgeMs, true);
    return;
  }

  const st = _statusFromHealth(healthByUrl, url);
  if (st) {
    if (!st.online) _recordDashStatusEvent(card, 'offline', 'Confirmed down (health)');
    else if (st.authenticated === false) _recordDashStatusEvent(card, 'reachable', 'Ping only — checking API…');
    else _recordDashStatusEvent(card, 'online', 'Health probe OK');
    _applyDashCardStatus(card, st.online, st.bridgeMs, st.authenticated !== false);
  }
}

const HEALTH_DOWN_CONSECUTIVE = 2; // match backend alert threshold — avoid single-blip OFFLINE

function _isHealthDownConfirmed(healthByUrl, url, consecutive = HEALTH_DOWN_CONSECUTIVE) {
  const history = healthByUrl[_normServerUrl(url)]?.history || [];
  if (history.length < consecutive) return false;
  return history.slice(0, consecutive).every(e => e && e.up === false);
}

function _statusFromHealth(healthByUrl, url) {
  const hist = healthByUrl[_normServerUrl(url)]?.history || [];
  const lat = hist[0];
  if (!lat || Date.now() - lat.ts > BRIDGE_FRESH_MS) return null;
  if (!lat.up) {
    // One failed ping is not enough — wait for consecutive failures (same as down banner).
    if (!_isHealthDownConfirmed(healthByUrl, url)) return null;
    return { online: false, bridgeMs: null, authenticated: false };
  }
  const authenticated = lat.method === 'auth';
  return { online: true, bridgeMs: lat.ms != null ? lat.ms : null, authenticated };
}

function _dashCardIsOnline(card) {
  const pill = card.querySelector('[data-pill]');
  return !!(pill && pill.classList.contains('online'));
}

function _dashCardIsUp(card) {
  const pill = card.querySelector('[data-pill]');
  if (!pill) return false;
  return pill.classList.contains('online') || pill.classList.contains('reachable');
}

function _dashCardBridgeMs(card) {
  const msTxt = card.querySelector('[data-bridge-ms]')?.textContent || '';
  const ms = parseInt(msTxt, 10);
  return isNaN(ms) ? null : ms;
}

function _dashGenStale(gen) {
  return gen != null && gen !== _dashLoadGen;
}

function _reconcileDashServerTile() {
  if (_dashboardInFlight) return;
  // Bundle totals use authenticated connection tests; card pills can show REACHABLE from health ping.
  if (_dashboardBundleActive()) {
    const bundle = window.DashboardState?.lastBundle;
    if (bundle?.totals) _paintDashTilesFromBundle(bundle);
    return;
  }
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  if (!cards.length) return;
  let upCount = 0;
  let fastest = null;
  cards.forEach(card => {
    if (!_dashCardIsUp(card)) return;
    upCount++;
    const ms = _dashCardBridgeMs(card);
    if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
  });
  _updateDashStatusHeader(_collectDashboardServers(), upCount, fastest);
}

function _updateDashStatusHeader(servers, upCount, fastest) {
  _setDashNumber('tile-servers', upCount);
  const pingEl = document.getElementById('tile-ping');
  if (pingEl) {
    animateNumber(pingEl, fastest != null ? fastest + 'ms' : '—');
    pingEl.title = fastest != null
      ? `Fastest bridge path right now · ${fastest}ms (addon → server)`
      : 'No bridge latency data yet';
  }
  const statusEl = document.getElementById('dash-status');
  if (statusEl && servers.length) {
    statusEl.textContent = `${upCount}/${servers.length} servers reachable · health every ${Math.round(DASH_GRAPH_POLL_MS / 1000)}s · auth check every ${Math.round(DASH_CONN_POLL_MS / 1000)}s`;
  }
  _updateFleetPulse();
}

async function refreshDashCardStatus(opts = {}) {
  if (_dashBusy) return;
  if (_dashboardBundleActive()) return;
  const full = opts.full === true;
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  if (!cards.length) return;
  await ensureAccountConfigLoaded();
  const servers = _collectDashboardServers();
  const healthByUrl = await _fetchHealthByUrl();
  let upCount = 0;
  let fastest = null;
  const pingQueue = [];

  if (!full) {
    for (const s of servers) {
      const card = [...cards].find(c => _normServerUrl(c.dataset.serverUrl) === _normServerUrl(s.url));
      if (!card) continue;
      const st = _statusFromHealth(healthByUrl, s.url);
      if (!st) {
        if (_dashCardIsOnline(card)) {
          upCount++;
          const ms = _dashCardBridgeMs(card);
          if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
        }
        continue;
      }
      const pill = card.querySelector('[data-pill]');
      const wasAuthOnline = !!(pill && pill.classList.contains('online'));
      if (wasAuthOnline) {
        if (!st.online && !_isHealthDownConfirmed(healthByUrl, s.url)) {
          if (_dashCardIsUp(card)) {
            upCount++;
            const ms = _dashCardBridgeMs(card);
            if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
          }
          continue;
        }
        if (st.online && st.authenticated === false) {
          const msEl = card.querySelector('[data-bridge-ms]');
          if (msEl && st.bridgeMs != null) {
            msEl.textContent = st.bridgeMs + 'ms';
            msEl.className = 'gbridge-now ' + _srvPingClass(st.bridgeMs);
          }
          if (_dashCardIsUp(card)) {
            upCount++;
            const ms = _dashCardBridgeMs(card);
            if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
          }
          continue;
        }
      }
      _applyDashCardStatus(card, st.online, st.bridgeMs, st.authenticated !== false);
      if (_dashCardIsUp(card)) {
        upCount++;
        const ms = _dashCardBridgeMs(card);
        if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
      }
    }
    _updateDashStatusHeader(servers, upCount, fastest);
    _reconcileDashServerTile();
    return;
  }

  // HUGE LOAD TIME WIN (refined): per-server status is fully incremental.
  // Each _test (capped ~5s) updates its card *immediately*. We still compute final header from settled results, but the UI for individual boxes is never blocked by the slowest server.
  // Good boxes (history, status, pill) light up as fast as their probe; bad ones (EAGLE etc.) surface error fast without stalling the rest.
  const statusPromises = servers.map(async (s) => {
    const card = [...cards].find(c => _normServerUrl(c.dataset.serverUrl) === _normServerUrl(s.url));
    if (!card) return { ok: false };
    let conn;
    try { conn = await _testServerConnection(s); } catch { conn = { ok: false }; }
    let bridgeMs = conn.ok ? _bridgeMsFromHealth(healthByUrl, s.url) : null;
    if (conn.ok && bridgeMs == null) pingQueue.push({ card, s });
    _applyDashCardStatus(card, conn.ok, bridgeMs);   // <— instant per-box update
    return { ok: !!conn.ok, bridgeMs };
  });

  // fire-and-forget extra pings (non-blocking for load)
  if (pingQueue.length) {
    fetch('/api/ping-servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: pingQueue.map(m => ({ url: m.s.url, label: m.s.label })) }),
    }).then(r => r.ok ? r.json() : {}).then(data => {
      (data.results || []).forEach((r, i) => {
        const row = pingQueue[i];
        if (row && r.up && r.ms != null) _applyDashCardStatus(row.card, true, r.ms);
      });
    }).catch(() => {});
  }

  // Still compute aggregates for the header/tile, but the per-card "box loading" is already done incrementally.
  const statusResults = await Promise.allSettled(statusPromises);
  statusResults.forEach(res => {
    if (res.status === 'fulfilled' && res.value && res.value.ok) {
      upCount++;
      const ms = res.value.bridgeMs;
      if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
    }
  });

  _updateDashStatusHeader(servers, upCount, fastest);
  _reconcileDashServerTile();

  // Append short build to the dynamic status line (helps notice deploys)
  try {
    const st = document.getElementById('dash-status');
    const bidEl = document.getElementById('build-id');
    const bid = (window.BUILD_ID || (bidEl && bidEl.getAttribute('data-build')) || '').slice(0,7);
    if (st && bid && !st.textContent.includes(bid)) {
      st.textContent += ` · ${bid}`;
    }
  } catch {}
}

let _dashHealthPingTimer = null;

function startDashHealthPolling() {
  stopDashHealthPolling();
  _dashHealthPingTimer = setInterval(() => {
    const dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('on')) return;
    _kickHealthPing();
  }, DASH_HEALTH_PING_MS);
}

function stopDashHealthPolling() {
  clearInterval(_dashHealthPingTimer);
  _dashHealthPingTimer = null;
}
