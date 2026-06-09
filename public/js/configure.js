// ── State ─────────────────────────────────────────────────────────────────
const LS_KEY_BASE = 'meb_config_v1';
const LS_LAST_BASE = 'meb-last-config';
const LS_ACTIVE_USER = 'meb_active_user';
const LS_LEGACY_KEYS = [LS_KEY_BASE, LS_LAST_BASE, 'meb-libstats-cache'];

function getActiveUsername() {
  try { return sessionStorage.getItem(LS_ACTIVE_USER) || ''; } catch { return ''; }
}

function lsKey() {
  const u = getActiveUsername();
  return u ? `${LS_KEY_BASE}:${u}` : LS_KEY_BASE;
}

function lsLastKey() {
  const u = getActiveUsername();
  return u ? `${LS_LAST_BASE}:${u}` : LS_LAST_BASE;
}

function setActiveUsername(username) {
  try {
    if (username) sessionStorage.setItem(LS_ACTIVE_USER, username);
    else sessionStorage.removeItem(LS_ACTIVE_USER);
  } catch { /* */ }
}

function purgeLegacyGlobalConfig() {
  LS_LEGACY_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch {} });
}

function hasCompleteServers(servers) {
  return (servers || []).some(s => s?.url && s?.apiKey && s?.userId);
}

let nextId = 0;
// nextCatId owned by catalogs-wizard.js

// Library-stats cache: key = url|apiKey|userId -> {movies,shows,episodes,ms,ts}
let _libStatsCache = {};
let _dashboardInFlight = false;
let _accountConfigPromise = null;

function domHasEnabledServers() {
  const blocks = document.querySelectorAll('.server-block');
  if (!blocks.length) return false;
  return [...blocks].some(b =>
    b.querySelector('.f-enabled')?.checked &&
    b.querySelector('.f-url')?.value.trim() &&
    b.querySelector('.f-apikey')?.value.trim() &&
    b.querySelector('.f-userid')?.value.trim()
  );
}

function _mergeLocalCredsIntoServers(servers) {
  let local = {};
  try { local = JSON.parse(localStorage.getItem(lsKey()) || '{}'); } catch {}
  const localByUrl = new Map((local.servers || []).map(s => [_normServerUrl(s.url), s]));
  return (servers || []).map(s => {
    const loc = localByUrl.get(_normServerUrl(s.url));
    if (!loc) return s;
    const merged = { ...s };
    if (loc.username && loc.password && (!merged.username || !merged.password)) {
      merged.username = loc.username;
      merged.password = loc.password;
    }
    return merged;
  });
}

function _applyCredsToDomBlocks(servers) {
  const byUrl = new Map((servers || []).map(s => [_normServerUrl(s.url), s]));
  document.querySelectorAll('.server-block').forEach(block => {
    const url = block.querySelector('.f-url')?.value.trim();
    const acc = byUrl.get(_normServerUrl(url));
    if (!acc) return;
    const uEl = block.querySelector('.f-username');
    const pEl = block.querySelector('.f-password');
    if (uEl && acc.username && !uEl.value.trim()) uEl.value = acc.username;
    if (pEl && acc.password && !pEl.value) pEl.value = acc.password;
  });
}

let _accountSyncTimer = null;
function scheduleAccountConfigSync() {
  clearTimeout(_accountSyncTimer);
  _accountSyncTimer = setTimeout(async () => {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!me.ok) return;
      const auth = await me.json().catch(() => null);
      if (!auth?.user) return;
      if (typeof generateLinks === 'function') generateLinks({ silent: true });
      const enc = localStorage.getItem(lsLastKey());
      if (!enc) return;
      let b = enc.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const bin = atob(b);
      const json = decodeURIComponent(Array.prototype.map.call(bin, c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const cfg = JSON.parse(json);
      const acctR = await fetch('/api/user/config', { credentials: 'same-origin' });
      if (acctR.ok) {
        const acctData = await acctR.json().catch(() => null);
        const acctServers = acctData?.config?.servers || [];
        if (!hasCompleteServers(acctServers) && hasCompleteServers(cfg.servers)) return;
      }
      await fetch('/api/user/config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
    } catch { /* best-effort */ }
  }, 2000);
}

function _applyExcludeRes(excludeRes) {
  if (!Array.isArray(excludeRes)) return;
  if (excludeRes.length && typeof excludeRes[0] === 'boolean') {
    document.querySelectorAll('.res-cb').forEach((cb, i) => {
      if (i < excludeRes.length) cb.checked = excludeRes[i];
    });
    return;
  }
  const set = new Set(excludeRes);
  document.querySelectorAll('.res-cb').forEach(cb => { cb.checked = set.has(cb.value); });
}

const STREAM_PROFILE_VERSION = 2;
const STREMIO_STREAM_DEFAULTS = {
  autoSelect: true,
  labelPreset: 'compact',
  audioRank: true,
  audioRankMode: 'audioFirst',
  audioDisableAction: 'hide',
  showSummary: true,
  summaryStyle: 'compact',
  recommend: true,
  ping: true,
  pingDetail: false,
};

function needsStreamProfileUpgrade(obj) {
  return !obj || (obj.streamProfile | 0) < STREAM_PROFILE_VERSION;
}

function upgradeStreamProfileState(obj) {
  if (!obj || !needsStreamProfileUpgrade(obj)) return false;
  for (const [k, v] of Object.entries(STREMIO_STREAM_DEFAULTS)) {
    if (obj[k] === undefined) obj[k] = v;
  }
  obj.streamProfile = STREAM_PROFILE_VERSION;
  return true;
}

function applyManifestSettings(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  upgradeStreamProfileState(cfg);
  const c = { ...STREMIO_STREAM_DEFAULTS, ...cfg };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = !!v; };
  const deliveryMode = c.mode || (c.timeout != null ? 'timeout' : null);
  if (deliveryMode) {
    const radio = document.querySelector(`input[name="perf-mode"][value="${deliveryMode}"]`);
    if (radio) { radio.checked = true; onModeChange(); }
  }
  if (c.timeoutValue != null) setVal('timeout-value', String(c.timeoutValue));
  else if (c.timeout != null) setVal('timeout-value', String(c.timeout));
  if (c.sortOrder) setVal('sort-order', c.sortOrder);
  if (Array.isArray(c.excludeRes)) _applyExcludeRes(c.excludeRes);
  setChk('show-recommend', c.recommend);
  setChk('failover-hide-down', c.failoverHideDown);
  setChk('show-ping', c.ping);
  setChk('ping-detail', c.pingDetail);
  if (c.audioLang) setVal('audio-lang', c.audioLang);
  if (c.prefCodec) setVal('pref-codec', c.prefCodec);
  if (c.codecMode) setVal('codec-mode', c.codecMode);
  setAudioRankToggle(c.audioRank ? 'on' : 'off');
  setVal('audio-rank-mode', c.audioRankMode || 'audioFirst');
  setVal('audio-disable-action', c.audioDisableAction || 'hide');
  setSurroundPriorityToggle(c.surroundPriority ? 'on' : 'off');
  if (Array.isArray(c.audioOrder) || Array.isArray(c.audioDisabled) || c.audioRank) {
    const order = (c.audioOrder && c.audioOrder.length) ? c.audioOrder : AUDIO_FORMATS.map(f => f.token);
    renderAudioRankList(order, c.audioDisabled || []);
  }
  (c.audioPresets || []).forEach(id => {
    const chip = document.querySelector('#audio-preset-chips .chip[data-preset="' + id + '"]');
    if (chip) chip.classList.add('on');
  });
  if (c.maxBitrate != null) setVal('max-bitrate', String(c.maxBitrate));
  setChk('auto-select', c.autoSelect);
  setVal('label-preset', c.labelPreset || 'compact');
  setChk('show-summary', c.showSummary);
  setVal('summary-style', c.summaryStyle || 'compact');
  if (c.showSummary) {
    const opts = document.getElementById('summary-options');
    if (opts) opts.style.display = 'flex';
  }
  if (c.qualityBadge != null) setVal('quality-badge', c.qualityBadge);
  if (c.flagEmoji != null) setVal('flag-emoji', c.flagEmoji);
  if (c.bitrateBar != null) setVal('bitrate-bar', c.bitrateBar);
  if (c.subsStyle) setVal('subs-style', c.subsStyle);
  if (c.showCatalog === false) { setChk('show-catalog', false); if (window.toggleCatalogOptions) window.toggleCatalogOptions(); }
  if (c.catalogContent) setVal('catalog-content', c.catalogContent);
  if (Array.isArray(c.libraryRows)) {
    ['recent', 'resume', 'nextup', 'favorites'].forEach(k => {
      const el = document.getElementById('libchk-' + k);
      if (el) el.checked = c.libraryRows.indexOf(k) !== -1;
    });
    if (window.CatalogsWizard && window.CatalogsWizard.syncLibChips) window.CatalogsWizard.syncLibChips();
  }
  if (c.rpdbKey) setVal('rpdb-key', c.rpdbKey);
  if (Array.isArray(c.externalCatalogs) && c.externalCatalogs.length) {
    const catList = document.getElementById('catalog-list');
    if (catList && window.addExternalCatalog) { catList.innerHTML = ''; window.nextCatId = 0; c.externalCatalogs.forEach(cat => window.addExternalCatalog(cat, { autoTest: false })); }
  }
  toggleCustomPreset();
  if (typeof updateLabelPreview === 'function') updateLabelPreview();
  if (typeof updateSummaryPreview === 'function') updateSummaryPreview();
  if (window.Controls) Controls.syncAll();
  updateRankingUX();
}

async function ensureAccountConfigLoaded() {
  if (_accountConfigPromise) return _accountConfigPromise;
  _accountConfigPromise = (async () => {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!me.ok) return null;
      const auth = await me.json().catch(() => null);
      if (!auth?.user) return null;
      const r = await fetch('/api/user/config', { credentials: 'same-origin' });
      if (!r.ok) return null;
      const data = await r.json().catch(() => null);
      const cfg = data?.config || {};
      const profileUpgraded = upgradeStreamProfileState(cfg);
      const accountServers = _mergeLocalCredsIntoServers(cfg.servers);
      cfg.servers = accountServers;
      if (!accountServers.length) {
        const container = document.getElementById('servers-container');
        if (container) {
          container.innerHTML = '';
          nextId = 0;
          addServer();
        }
        try { localStorage.removeItem(lsKey()); localStorage.removeItem(lsLastKey()); } catch {}
        return null;
      }
      const hadLocal = !!localStorage.getItem(lsKey());
      const domServers = (collectConfig(true) || {}).servers || [];
      if (!hadLocal || !domHasEnabledServers() || accountServers.length > domServers.length || profileUpgraded) {
        populateFromConfig(cfg);
        applyManifestSettings(cfg);
        saveToLocalStorage();
        if (profileUpgraded && typeof generateLinks === 'function') {
          try { await generateLinks({ silent: true }); } catch {}
        }
      } else {
        _applyCredsToDomBlocks(accountServers);
      }
      return cfg;
    } catch {
      return null;
    }
  })();
  return _accountConfigPromise;
}

function _normServerUrl(u) { return (u || '').replace(/\/+$/, '').toLowerCase(); }

function _dashHealthPanel(history) {
  if (window.HealthWidgets && typeof window.HealthWidgets.buildMiniHealthPanel === 'function') {
    return window.HealthWidgets.buildMiniHealthPanel(history, { range: '24h', compact: true });
  }
  return '<div class="gcard-health-empty">Health charts loading…</div>';
}

function _healthUrlsQuery() {
  const urls = [...document.querySelectorAll('.server-block .f-url, .server-card .f-url')]
    .map(el => (el.value || '').trim().replace(/\/+$/, ''))
    .filter(u => u && /^https?:\/\//i.test(u));
  return urls.length ? `?urls=${encodeURIComponent(urls.join(','))}` : '';
}

async function _fetchHealthByUrl() {
  try {
    const rows = await fetch(`/api/health/history${_healthUrlsQuery()}`, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []);
    const map = {};
    (rows || []).forEach(h => { map[_normServerUrl(h.url)] = h; });
    return map;
  } catch {
    return {};
  }
}

function _registerHealthServers(servers) {
  if (!servers?.length) return;
  const payload = servers.map(s => ({ url: s.url, label: s.label, type: s.type || 'emby' }));
  fetch('/api/health/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ servers: payload }),
  }).catch(() => {});
}

async function refreshDashCardHealth() {
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  if (!cards.length) return;
  const byUrl = await _fetchHealthByUrl();
  cards.forEach(card => {
    const slot = card.querySelector('.gcard-health');
    if (!slot) return;
    const rec = byUrl[_normServerUrl(card.dataset.serverUrl)];
    slot.innerHTML = _dashHealthPanel(rec?.history || []);
  });
}

function _applyDashCardStatus(card, online, bridgeMs) {
  const pill = card.querySelector('[data-pill]');
  const msEl = card.querySelector('[data-bridge-ms]');
  if (!pill) return;
  pill.className = 'gpill ' + (online ? 'online' : 'offline');
  pill.textContent = online ? 'ONLINE' : 'OFFLINE';
  pill.title = online
    ? 'Bridge reachable (authenticated)'
    : 'Bridge cannot authenticate or reach this server';
  if (msEl) {
    if (online && bridgeMs != null) {
      msEl.textContent = bridgeMs + 'ms';
      msEl.className = 'gbridge-now ' + _srvPingClass(bridgeMs);
    } else {
      msEl.textContent = '';
      msEl.className = 'gbridge-now';
    }
  }
}

function _statusFromHealth(healthByUrl, url) {
  const lat = healthByUrl[_normServerUrl(url)]?.history?.[0];
  if (!lat || Date.now() - lat.ts > BRIDGE_FRESH_MS) return null;
  return { online: !!lat.up, bridgeMs: lat.up && lat.ms != null ? lat.ms : null };
}

function _dashCardIsOnline(card) {
  const pill = card.querySelector('[data-pill]');
  return !!(pill && pill.classList.contains('online'));
}

function _dashCardBridgeMs(card) {
  const msTxt = card.querySelector('[data-bridge-ms]')?.textContent || '';
  const ms = parseInt(msTxt, 10);
  return isNaN(ms) ? null : ms;
}

function _updateDashStatusHeader(servers, upCount, fastest) {
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('tile-servers', upCount);
  const pingEl = document.getElementById('tile-ping');
  if (pingEl) {
    pingEl.textContent = fastest != null ? fastest + 'ms' : '—';
    pingEl.title = fastest != null
      ? `Fastest bridge path right now · ${fastest}ms (addon → server)`
      : 'No bridge latency data yet';
  }
  const statusEl = document.getElementById('dash-status');
  if (statusEl && servers.length) {
    statusEl.textContent = `${upCount}/${servers.length} servers reachable · health every ${Math.round(DASH_GRAPH_POLL_MS / 1000)}s · auth check every ${Math.round(DASH_CONN_POLL_MS / 1000)}s`;
  }
}

async function refreshDashCardStatus(opts = {}) {
  const full = opts.full === true;
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  if (!cards.length) return;
  await ensureAccountConfigLoaded();
  const cfg = collectConfig(true) || { servers: [] };
  const servers = cfg.servers || [];
  const healthByUrl = await _fetchHealthByUrl();
  let upCount = 0;
  let fastest = null;
  const pingQueue = [];

  if (!full) {
    for (const s of servers) {
      const card = [...cards].find(c => _normServerUrl(c.dataset.serverUrl) === _normServerUrl(s.url));
      if (!card) continue;
      const st = _statusFromHealth(healthByUrl, s.url);
      if (st) _applyDashCardStatus(card, st.online, st.bridgeMs);
      if (_dashCardIsOnline(card)) {
        upCount++;
        const ms = _dashCardBridgeMs(card);
        if (ms != null && (fastest === null || ms < fastest)) fastest = ms;
      }
    }
    _updateDashStatusHeader(servers, upCount, fastest);
    return;
  }

  await Promise.all(servers.map(async (s) => {
    const card = [...cards].find(c => _normServerUrl(c.dataset.serverUrl) === _normServerUrl(s.url));
    if (!card) return;
    const conn = await _testServerConnection(s);
    let bridgeMs = conn.ok ? _bridgeMsFromHealth(healthByUrl, s.url) : null;
    if (conn.ok) {
      upCount++;
      if (bridgeMs != null && (fastest === null || bridgeMs < fastest)) fastest = bridgeMs;
      if (bridgeMs == null) pingQueue.push({ card, s });
    }
    _applyDashCardStatus(card, conn.ok, bridgeMs);
  }));

  if (pingQueue.length) {
    try {
      const resp = await fetch('/api/ping-servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: pingQueue.map(m => ({ url: m.s.url, label: m.s.label })) }),
      });
      const data = resp.ok ? await resp.json().catch(() => ({})) : {};
      (data.results || []).forEach((r, i) => {
        const row = pingQueue[i];
        if (!row || !r.up || r.ms == null) return;
        _applyDashCardStatus(row.card, true, r.ms);
        if (fastest === null || r.ms < fastest) fastest = r.ms;
      });
    } catch { /* keep last known status */ }
  }

  _updateDashStatusHeader(servers, upCount, fastest);
}

function formatLiveTitleClient(np) {
  if (!np) return 'Unknown';
  if (np.Type === 'Episode' && np.SeriesName) {
    const s = np.ParentIndexNumber != null ? `S${np.ParentIndexNumber}` : '';
    const e = np.IndexNumber != null ? `E${np.IndexNumber}` : '';
    const ep = np.Name && np.Name !== np.SeriesName ? ` — ${np.Name}` : '';
    return `${np.SeriesName} ${s}${e}${ep}`.trim();
  }
  return np.Name || 'Unknown';
}

function parseBrowserSessions(data, server) {
  const out = [];
  for (const sess of (Array.isArray(data) ? data : [])) {
    const np = sess && sess.NowPlayingItem;
    if (!np) continue;
    const ps = sess.PlayState || {};
    const runTicks = Number(np.RunTimeTicks) || 0;
    const posTicks = ps.PositionTicks != null ? Number(ps.PositionTicks) : null;
    let progressPct = null;
    if (runTicks > 0 && posTicks != null && posTicks >= 0) {
      progressPct = Math.min(100, Math.max(0, Math.round((posTicks / runTicks) * 100)));
    }
    out.push({
      server: server.label || server.url,
      title: formatLiveTitleClient(np),
      rawTitle: np.Name || null,
      season: np.ParentIndexNumber ?? null,
      episode: np.IndexNumber ?? null,
      user: sess.UserName || sess.DeviceName || null,
      client: sess.Client || sess.AppName || null,
      device: sess.DeviceName || null,
      positionTicks: posTicks,
      progressPct,
      isPaused: !!ps.IsPaused,
      playMethod: ps.PlayMethod || null,
      isTranscoding: false,
      sessionId: sess.Id || null,
      source: 'browser-sessions',
    });
  }
  return out;
}

async function fetchBrowserServerSessions(server) {
  const label = server.label || server.url || 'server';
  if (!server?.url || !server?.apiKey) {
    return { live: [], probe: { server: label, ok: false, count: 0, error: 'missing credentials', method: null } };
  }
  const base = server.url.replace(/\/+$/, '');
  const key = encodeURIComponent(server.apiKey);
  const urls = [
    `${base}/Sessions?api_key=${key}&ActiveWithinSeconds=7200`,
    `${base}/emby/Sessions?api_key=${key}&ActiveWithinSeconds=7200`,
    `${base}/Sessions?api_key=${key}`,
    `${base}/emby/Sessions?api_key=${key}`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LIVE_BROWSER_TIMEOUT_MS);
      const r = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json();
      const live = parseBrowserSessions(data, server);
      if (live.length) {
        return {
          live,
          probe: { server: label, ok: true, count: live.length, error: null, method: 'browser-sessions' },
        };
      }
    } catch { /* CORS / network — try next path */ }
  }
  return { live: [], probe: { server: label, ok: false, count: 0, error: 'browser blocked', method: null } };
}

function _availableServersFromStatus(serverStatus) {
  if (!Array.isArray(serverStatus)) return [];
  return serverStatus.filter(s => s && s.status === 'found' && s.label).map(s => s.label);
}

function _resolveBridgePlayback(entry) {
  const pickedServer = entry?.server || entry?.pickedServer || (entry?.bestFile && entry.bestFile.label) || null;
  const availableOn = _availableServersFromStatus(entry?.serverStatus);
  let server = null;
  let serverConfirmed = false;
  if (availableOn.length === 1) {
    server = availableOn[0];
    serverConfirmed = true;
  } else if (availableOn.length > 1) {
    server = null;
    serverConfirmed = false;
  } else if (pickedServer) {
    server = pickedServer;
    serverConfirmed = false;
  }
  return { pickedServer, server, availableOn, serverConfirmed };
}

function inferBridgeLiveFromRecent(recent) {
  const now = Date.now();
  const seen = new Map();
  for (const entry of recent || []) {
    if (!entry?.found || !entry.title) continue;
    const ts = entry.ts ? new Date(entry.ts).getTime() : 0;
    if (!ts) continue;
    const age = now - ts;
    if (age < 0 || age > BRIDGE_LIVE_MAX_AGE_MS) continue;
    const resolved = _resolveBridgePlayback(entry);
    if (!resolved.pickedServer && !resolved.server && !resolved.availableOn.length) continue;
    const key = [entry.title, entry.season ?? '', entry.episode ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.set(key, {
      server: resolved.server,
      pickedServer: resolved.pickedServer,
      availableOn: resolved.availableOn,
      serverConfirmed: resolved.serverConfirmed,
      title: entry.title,
      rawTitle: entry.title,
      season: entry.season ?? null,
      episode: entry.episode ?? null,
      user: null,
      client: 'Stremio',
      source: 'bridge',
      inferredAgeMs: age,
      isPaused: false,
      progressPct: null,
    });
  }
  return [...seen.values()];
}

function mergeLiveSourcesClient(lists) {
  const prefer = ['sessions', 'user-playing', 'browser-sessions', 'bridge'];
  const rank = new Map(prefer.map((s, i) => [s, i]));
  const map = new Map();
  const keyOf = s => [s.server || '', s.title || '', s.user || '', s.source || ''].join('|');
  for (const list of lists) {
    for (const s of list || []) {
      if (!s?.title) continue;
      const key = keyOf(s);
      const prev = map.get(key);
      if (!prev || (rank.get(s.source) ?? 99) < (rank.get(prev.source) ?? 99)) map.set(key, s);
    }
  }
  const out = [...map.values()];
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sessionTitles = new Set(
    out.filter(s => s.source !== 'bridge').map(s => norm(s.title)).filter(Boolean)
  );
  return out.filter(s => s.source !== 'bridge' || !sessionTitles.has(norm(s.title)));
}

// Mirror of lib/bridgeLive.js suppressReachableBridge — drop bridge-inferred rows
// on servers the browser successfully probed (ground truth: if it were playing it
// would be a real session). Rows on unreachable servers stay (legit fallback).
function suppressReachableBridgeClient(live, probes) {
  const reachable = new Set((probes || []).filter(p => p && p.ok).map(p => p.server));
  if (!reachable.size) return (live || []).slice();
  return (live || []).filter(s => {
    if (!s || s.source !== 'bridge') return true;
    const candidates = (Array.isArray(s.availableOn) && s.availableOn.length)
      ? s.availableOn
      : [s.server, s.pickedServer].filter(Boolean);
    if (!candidates.length) return true;
    return !candidates.every(c => reachable.has(c));
  });
}

function formatBridgeServerLabel(s) {
  if (!s) return '';
  if (s.source === 'bridge') return (s.serverConfirmed && s.server) ? s.server : '';
  return s.server || '';
}

function formatLiveMetaLine(s) {
  const parts = [];
  const server = formatBridgeServerLabel(s);
  if (server) parts.push(server);
  const user = s.user || '';
  const client = s.client || s.device || '';
  if (user) parts.push(user);
  if (client) parts.push(client);
  return parts.join(' · ');
}

async function fetchLiveSessionsForServers(servers) {
  if (!servers?.length) return [];
  const chunks = await Promise.all(servers.map(async (s) => {
    try {
      const r = await fetch('/api/server-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId, label: s.label,
          username: s.username || '', password: s.password || '',
        }),
      });
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      if (d?.apiKey) {
        const norm = (s.url || '').replace(/\/+$/, '');
        const block = [...document.querySelectorAll('.server-block')].find(b => {
          const u = b.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
          return u && u === norm;
        });
        if (block) _applyRefreshedApiKey(block, d.apiKey);
      }
      return Array.isArray(d?.live) ? d.live : [];
    } catch {
      return [];
    }
  }));
  return chunks.flat();
}

const _livePlaybackPrev = new Map();
const _bufferingToastKeys = new Set();
const LIVE_PLAYBACK_POLL_MS = 20000;
const DASH_LIVE_POLL_MS = 8000;
const BRIDGE_LIVE_MAX_AGE_MS = 90 * 1000; // keep in sync with lib/bridgeLive.js
const LIVE_BROWSER_TIMEOUT_MS = 4000;
let _dashLiveTimer = null;

function annotateLiveSessions(sessions) {
  const lp = window.MEBLivePlayback;
  if (!lp) return (sessions || []).map(s => ({ ...s, buffering: false }));
  return lp.annotateBuffering(sessions || [], _livePlaybackPrev);
}

function renderBufferingBanner(buffering) {
  const list = buffering || [];
  let el = document.getElementById('buffering-banner');
  if (!list.length) {
    if (el) el.remove();
    document.documentElement.classList.remove('has-buffering-banner');
    return;
  }
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const servers = [...new Set(list.map(s => s.server).filter(Boolean))];
  const summary = servers.length === 1
    ? `Buffering on <strong>${esc(servers[0])}</strong>`
    : `Buffering on <strong>${servers.length} servers</strong> — ${esc(servers.slice(0, 3).join(', '))}${servers.length > 3 ? '…' : ''}`;
  const detail = list.length === 1
    ? `${esc(list[0].title)}${list[0].user ? ` · ${esc(list[0].user)}` : ''}`
    : `${list.length} active stream${list.length === 1 ? '' : 's'} stalled`;
  if (!el) {
    el = document.createElement('div');
    el.id = 'buffering-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="bb-icon" aria-hidden="true">⏳</span>
      <span class="bb-text"><span class="bb-summary"></span><span class="bb-detail"></span></span>
      <button type="button" class="bb-action">View</button>`;
    el.querySelector('.bb-action').addEventListener('click', () => { location.hash = '#/dashboard'; });
    document.body.appendChild(el);
  }
  el.querySelector('.bb-summary').innerHTML = summary;
  el.querySelector('.bb-detail').textContent = detail;
  document.documentElement.classList.add('has-buffering-banner');
}

function updateDashboardBufferBadge(count) {
  const nav = document.querySelector('.nav-item[data-page="dashboard"]');
  if (!nav) return;
  let badge = nav.querySelector('.nav-buffer-badge');
  if (!count) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-buffer-badge';
    badge.title = 'Playback buffering';
    nav.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = 'inline-flex';
}

function notifyNewBuffering(buffering) {
  const lp = window.MEBLivePlayback;
  if (!lp || typeof window.toast !== 'function') return;
  for (const s of buffering) {
    const key = lp.liveSessionKey(s);
    if (_bufferingToastKeys.has(key)) continue;
    _bufferingToastKeys.add(key);
    window.toast(`Buffering on ${s.server || 'server'} — ${s.title || 'playback'}`);
  }
  for (const key of [..._bufferingToastKeys]) {
    if (!buffering.some(s => lp.liveSessionKey(s) === key)) _bufferingToastKeys.delete(key);
  }
}

let _liveBundleInFlight = null;
let _liveBundleCache = { live: [], probes: [], ts: 0 };
let _activityRecentCache = [];
let _dashActivityGen = 0;
let _dashActivityData = null;
let _dashHistFilter = 'all';

function _serverLikelyDown(healthByUrl, url) {
  const rec = healthByUrl?.[_normServerUrl(url)]?.history?.[0];
  return !!(rec && !rec.up && Date.now() - rec.ts < BRIDGE_FRESH_MS);
}

function _liveProbeSkipBrowser(probe) {
  const err = (probe?.error || '').toLowerCase();
  return err.includes('timeout') || err.includes('unreachable') || err.includes('network');
}

function collectServersForLive() {
  const cfg = collectConfig(true);
  if (cfg?.servers?.length) return cfg.servers;
  const state = collectFormState();
  return (state.servers || []).filter(s =>
    s.enabled !== false && s.url && s.apiKey && s.userId && s.label
  );
}

function mergeLiveSessions(lists) {
  const lp = window.MEBLivePlayback;
  const map = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      const k = lp
        ? lp.liveSessionKey(s)
        : [s.server, s.user, s.title, s.client, s.sessionId].join('|');
      if (!map.has(k)) map.set(k, s);
    }
  }
  return [...map.values()];
}

async function fetchLiveBundle(force = false, opts = {}) {
  const ttl = opts.fast ? DASH_LIVE_POLL_MS : LIVE_PLAYBACK_POLL_MS;
  if (!force && _liveBundleCache.ts && Date.now() - _liveBundleCache.ts < ttl) {
    return _liveBundleCache;
  }
  if (_liveBundleInFlight) return _liveBundleInFlight;
  _liveBundleInFlight = (async () => {
    const demoOn = window.MEBDemo && window.MEBDemo.isActive && window.MEBDemo.isActive();
    let live = [];
    let probes = [];
    let recentForBridge = _activityRecentCache || [];

    if (!demoOn && window.currentUser) {
      try {
        const r = await fetch('/api/user/activity?quick=1', { credentials: 'same-origin' });
        if (r.ok) {
          const d = await r.json().catch(() => null);
          if (d) {
            live = Array.isArray(d.live) ? d.live : [];
            probes = Array.isArray(d.liveProbes) ? d.liveProbes : [];
            recentForBridge = Array.isArray(d.recent) ? d.recent : recentForBridge;
            _activityRecentCache = recentForBridge;
          }
        }
      } catch { /* fall through to per-server probe */ }
    }

    await ensureAccountConfigLoaded();
    const servers = collectServersForLive();
    const healthByUrl = servers.length ? await _fetchHealthByUrl() : {};
    if (servers.length) {
      const clientChunks = await Promise.all(servers.map(async (s) => {
        if (_serverLikelyDown(healthByUrl, s.url)) {
          return {
            live: [],
            probe: { server: s.label || s.url, ok: false, count: 0, error: 'skipped (offline)', method: null },
          };
        }
        try {
          const r = await fetch('/api/server-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId, label: s.label,
              username: s.username || '', password: s.password || '',
            }),
          });
          const d = await r.json().catch(() => null);
          if (d?.apiKey) {
            const norm = (s.url || '').replace(/\/+$/, '');
            const block = [...document.querySelectorAll('.server-block')].find(b => {
              const u = b.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
              return u && u === norm;
            });
            if (block) _applyRefreshedApiKey(block, d.apiKey);
          }
          let chunkLive = Array.isArray(d?.live) ? d.live : [];
          let probe = d?.probe || {
            server: s.label || s.url,
            ok: r.ok,
            count: chunkLive.length,
            error: d?.error || (!r.ok ? `HTTP ${r.status}` : null),
            method: d?.probe?.method || null,
          };
          if (!chunkLive.length && !_liveProbeSkipBrowser(probe)) {
            const browser = await fetchBrowserServerSessions(s);
            if (browser.live.length) {
              chunkLive = browser.live;
              probe = browser.probe;
            } else if (!probe.ok && browser.probe?.error === 'browser blocked') {
              probe = { ...probe, browserNote: 'browser blocked' };
            }
          }
          return { live: chunkLive, probe };
        } catch {
          const browser = await fetchBrowserServerSessions(s).catch(() => ({ live: [], probe: null }));
          if (browser.live?.length) return browser;
          return {
            live: [],
            probe: { server: s.label || s.url, ok: false, count: 0, error: 'network error', method: null },
          };
        }
      }));
      const clientLive = clientChunks.flatMap(c => c.live);
      const clientProbes = clientChunks.map(c => c.probe).filter(Boolean);
      live = mergeLiveSourcesClient([live, clientLive]);
      if (!probes.length) probes = clientProbes;
      else {
        const byServer = new Map(probes.map(p => [p.server, p]));
        clientProbes.forEach(p => {
          const prev = byServer.get(p.server);
          if (!prev || (!prev.ok && p.ok) || ((prev.count || 0) === 0 && (p.count || 0) > 0)) {
            byServer.set(p.server, p);
          }
        });
        probes = [...byServer.values()];
      }
    } else if (demoOn) {
      live = await fetchLiveSessionsForServers(collectServersForLive());
    }

    if (!live.length && recentForBridge.length) {
      live = mergeLiveSourcesClient([live, inferBridgeLiveFromRecent(recentForBridge)]);
    }

    // Ground-truth pass: once we've probed servers directly, bridge-inferred rows
    // on reachable servers that aren't real sessions are stale browses — drop them.
    live = suppressReachableBridgeClient(live, probes);

    const annotated = annotateLiveSessions(live);
    _liveBundleCache = { live: annotated, probes, ts: Date.now() };
    window._mebAnnotatedLive = annotated;
    window._mebAnnotatedLiveTs = _liveBundleCache.ts;
    window._mebLiveProbes = probes;
    renderLiveDock(annotated);
    return _liveBundleCache;
  })().finally(() => { _liveBundleInFlight = null; });
  return _liveBundleInFlight;
}
window.fetchLiveBundle = fetchLiveBundle;

function liveEmptyMessage(probes, serverCount) {
  const list = probes || [];
  const failed = list.filter(p => !p.ok);
  const okEmpty = list.filter(p => p.ok && (p.count || 0) === 0);
  if (!list.length) {
    return 'Nothing playing right now on your servers.';
  }
  if (failed.length === list.length) {
    return `Could not read Sessions API on any of your ${serverCount} server${serverCount === 1 ? '' : 's'}. Check API keys on the <a href="#" data-page="servers">Servers</a> page.`;
  }
  if (failed.length) {
    const names = failed.slice(0, 3).map(p => p.server).join(', ');
    return `Nothing playing right now. ${failed.length} server${failed.length === 1 ? '' : 's'} could not be polled${names ? ` (${names}${failed.length > 3 ? '…' : ''})` : ''}.`;
  }
  if (okEmpty.length === list.length) {
    return 'All servers reachable — nothing playing right now.';
  }
  return 'Nothing playing right now on your servers.';
}

function renderLiveDock(live) {
  const list = live || [];
  let dock = document.getElementById('live-dock');
  if (!list.length) {
    if (dock) dock.remove();
    document.documentElement.classList.remove('has-live-dock');
    return;
  }
  const esc = dashActivityEsc;
  const solo = list.length === 1 ? list[0] : null;
  const soloServer = solo ? formatBridgeServerLabel(solo) : '';
  const summary = solo
    ? (soloServer ? `${esc(solo.title)} on ${esc(soloServer)}` : esc(solo.title))
    : `${list.length} streams active`;
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'live-dock';
    dock.setAttribute('role', 'status');
    dock.innerHTML = `<span class="ld-pulse" aria-hidden="true"></span>
      <span class="ld-text"><span class="ld-title"></span><span class="ld-sub"></span></span>
      <button type="button" class="ld-btn">Details</button>`;
    dock.querySelector('.ld-btn').addEventListener('click', () => {
      location.hash = '#/dashboard';
      const target = document.getElementById('dash-activity');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    document.body.appendChild(dock);
  }
  dock.querySelector('.ld-title').textContent = summary;
  const sources = [...new Set(list.map(s => s.source).filter(Boolean))];
  dock.querySelector('.ld-sub').textContent = sources.includes('bridge')
    ? 'Live via bridge + server Sessions'
    : 'Live from your media servers';
  document.documentElement.classList.add('has-live-dock');
}

function dashActivityHasContent(el) {
  return !!(el && el.querySelector('.dash-activity-grid[data-ready="1"]'));
}

function renderDashActivityShell(serverCount) {
  const el = document.getElementById('dash-activity');
  if (!el || dashActivityHasContent(el)) return;
  const n = serverCount || collectServersForLive().length || 0;
  el.innerHTML = `<div class="dash-activity-grid">
    <div class="dash-act-panel dash-act-live">
      <h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3>
      <div class="da-empty da-loading">Checking playback across ${n || 'your'} server${n === 1 ? '' : 's'}…</div>
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

async function pollLivePlaybackNotifications(opts = {}) {
  const onDash = document.getElementById('page-dashboard')?.classList.contains('on');
  const stale = !_liveBundleCache.ts || Date.now() - _liveBundleCache.ts >= DASH_LIVE_POLL_MS;
  const bundle = await fetchLiveBundle(!!opts.force && stale, { fast: onDash });
  const buffering = (bundle.live || []).filter(s => s.buffering);
  renderBufferingBanner(buffering);
  updateDashboardBufferBadge(buffering.length);
  notifyNewBuffering(buffering);
  if (onDash && typeof renderDashActivity === 'function') {
    renderDashActivity({ bundle, refreshLive: true });
  }
  return bundle.live || [];
}

function startDashLivePolling() {
  clearInterval(_dashLiveTimer);
  _dashLiveTimer = setInterval(() => {
    const dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('on')) return;
    pollLivePlaybackNotifications();
  }, DASH_LIVE_POLL_MS);
}

function stopDashLivePolling() {
  clearInterval(_dashLiveTimer);
  _dashLiveTimer = null;
}

let _dashHealthPingTimer = null;

function startDashHealthPolling() {
  stopDashHealthPolling();
  _dashHealthPingTimer = setInterval(() => {
    const dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('on')) return;
    fetch('/api/health/ping-now', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  }, DASH_HEALTH_PING_MS);
}

function stopDashHealthPolling() {
  clearInterval(_dashHealthPingTimer);
  _dashHealthPingTimer = null;
}

try { _libStatsCache = JSON.parse(localStorage.getItem('meb-libstats-cache') || '{}'); } catch { _libStatsCache = {}; }
function _libKey(s){ return [s.url, s.apiKey, s.userId].join('|'); }
function _saveLibCache(){ try { localStorage.setItem('meb-libstats-cache', JSON.stringify(_libStatsCache)); } catch {} }
const LIB_TTL_MS = 60 * 60 * 1000; // 1 hour
const BRIDGE_FRESH_MS = 90 * 1000; // align with 30s health pings (+ buffer)
const DASH_GRAPH_POLL_MS = 8000; // sparklines + health-based ONLINE/OFFLINE
const DASH_CONN_POLL_MS = 30000; // full authenticated connection test
const DASH_HEALTH_PING_MS = 15000; // trigger backend pings while dashboard is open

function _bridgeMsFromHealth(healthByUrl, url) {
  const lat = healthByUrl[_normServerUrl(url)]?.history?.[0];
  if (!lat?.up || lat.ms == null || Date.now() - lat.ts > BRIDGE_FRESH_MS) return null;
  return lat.ms;
}

async function _testServerConnection(s) {
  if (!s.url || !s.apiKey || !s.userId) return { ok: false };
  try {
    const r = await fetch('/api/test-connection', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: s.url, type: s.type || 'emby', apiKey: s.apiKey, userId: s.userId,
        username: s.username || '', password: s.password || '',
      }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data.ok, apiKey: data.apiKey };
  } catch {
    return { ok: false };
  }
}

// ── Steps indicator ──────────────────────────────────────────────────────
function updateSteps() {
  const hasServers = document.querySelectorAll('.server-block').length > 0;
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  const s3 = document.getElementById('step-3');
  if (!s1) return;
  s1.className = hasServers ? 'step done' : 'step active';
  s2.className = hasServers ? 'step active' : 'step';
}

// -- External Catalogs: see catalogs-wizard.js --


function fmtBytes(b) {
  if (!b) return null;
  if (b >= 1e9) return `${(b/1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${(b/1e6).toFixed(0)}MB`;
  return `${Math.round(b/1e3)}KB`;
}

const LOG_PAGE_SIZE = 20;
let logData = [];
let logPage = 0;
let logSearch = '';
let logFilter = 'all';

function normalizeLogEntry(e) {
  const best = (e.bestServer && typeof e.bestServer === 'object') ? e.bestServer
    : (e.bestFile && typeof e.bestFile === 'object') ? e.bestFile
    : (e.bestServer ? { label: String(e.bestServer) } : null);
  return { ...e, bestServer: best, serverStatus: Array.isArray(e.serverStatus) ? e.serverStatus : [] };
}

function logBestLabel(e) {
  const n = normalizeLogEntry(e);
  return n.bestServer?.label || null;
}

function logEntryFound(e) {
  const n = normalizeLogEntry(e);
  if (n.bestServer) return true;
  return n.serverStatus.some(s => s.status === 'found');
}

function formatResCounts(resCounts, resLabels) {
  if (resCounts && Object.keys(resCounts).length) {
    const order = ['4K', '2160p', '1080p', '720p', '480p', 'SD'];
    return Object.entries(resCounts)
      .sort((a, b) => {
        const ai = order.findIndex(o => a[0].toUpperCase().includes(o));
        const bi = order.findIndex(o => b[0].toUpperCase().includes(o));
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      })
      .map(([k, v]) => `${k}×${v}`)
      .join(' · ');
  }
  if (resLabels?.length) return resLabels.join(' · ');
  return '';
}

function aggregateResCounts(serverStatus) {
  const agg = {};
  serverStatus.filter(s => s.status === 'found').forEach(s => {
    if (s.resCounts) Object.entries(s.resCounts).forEach(([k, v]) => { agg[k] = (agg[k] || 0) + v; });
    else if (s.resLabels) s.resLabels.forEach(l => { agg[l] = (agg[l] || 0) + 1; });
  });
  return agg;
}

function getWinReason(entry, winnerSrv) {
  if (!entry.bestServer) return '';
  const found = entry.serverStatus.filter(s => s.status === 'found');
  if (found.length <= 1) return 'Only source available';
  const sizes = found.map(s => s.size || 0).filter(n => n > 0);
  if (!sizes.length) return 'Best match';
  const max = Math.max(...sizes);
  if ((entry.bestServer.size || 0) >= max) {
    const others = found.length - 1;
    return `Largest file · beat ${others} server${others === 1 ? '' : 's'}`;
  }
  if (winnerSrv?.resLabels?.length) return `Best quality match · ${winnerSrv.resLabels[0]}`;
  return 'Best match';
}

function serverStateLabel(status) {
  if (status === 'found') return 'Found';
  if (status === 'not_found') return 'No file';
  if (status === 'timeout') return 'Timeout';
  if (status === 'offline') return 'Offline';
  return status || '—';
}

function serverStateClass(status) {
  if (status === 'found') return 'found';
  if (status === 'not_found') return 'miss';
  if (status === 'timeout') return 'timeout';
  return 'off';
}

function renderLogServers(entry) {
  const winner = entry.bestServer?.label;
  const agg = aggregateResCounts(entry.serverStatus);
  const qualBar = formatResCounts(agg);
  const foundN = entry.serverStatus.filter(s => s.status === 'found').length;
  const summary = qualBar
    ? `<div class="rlog-qual-bar"><span class="rlog-qual-tags">${escHtml(qualBar)}</span><span class="rlog-qual-sub">${foundN} server${foundN === 1 ? '' : 's'} had streams</span></div>`
    : (foundN ? `<div class="rlog-qual-bar"><span class="rlog-qual-sub">${foundN} server${foundN === 1 ? '' : 's'} responded</span></div>` : '');

  if (!entry.serverStatus.length) return '<span class="rlog-none">No server breakdown</span>';

  const lines = entry.serverStatus.map(s => {
    const isWin = winner && s.label === winner && s.status === 'found';
    const res = formatResCounts(s.resCounts, s.resLabels);
    const cnt = s.status === 'found' && s.count ? `${s.count} stream${s.count === 1 ? '' : 's'}` : '—';
    const size = s.status === 'found' && s.size ? fmtBytes(s.size) : '';
    const meta = [size, res].filter(Boolean).join(' · ') || '—';
    return `<div class="rlog-srv-line ${serverStateClass(s.status)}${isWin ? ' is-win' : ''}">
      <span class="rlog-srv-name">${isWin ? '★ ' : ''}${escHtml(s.label)}</span>
      <span class="rlog-srv-state">${serverStateLabel(s.status)}</span>
      <span class="rlog-srv-cnt">${cnt}</span>
      <span class="rlog-srv-res">${escHtml(meta)}</span>
    </div>`;
  }).join('');

  return `<div class="rlog-srv-panel">${summary}<div class="rlog-srv-grid">${lines}</div></div>`;
}

function renderLogWinner(entry) {
  if (!entry.bestServer?.label) return '<span class="rlog-none">No winner</span>';
  const winnerSrv = entry.serverStatus.find(s => s.label === entry.bestServer.label && s.status === 'found');
  const size = entry.bestServer.size ? fmtBytes(entry.bestServer.size) : '';
  const mbps = entry.bestServer.bitrate ? `${(entry.bestServer.bitrate / 1e6).toFixed(1)} Mbps` : '';
  const res = formatResCounts(winnerSrv?.resCounts, winnerSrv?.resLabels);
  const meta = [size, mbps, res].filter(Boolean).join(' · ');
  const why = getWinReason(entry, winnerSrv);
  return `<div class="rlog-winner">
    <div class="rlog-winner-badge">Winner</div>
    <div class="rlog-winner-srv">${escHtml(entry.bestServer.label)}</div>
    ${meta ? `<div class="rlog-winner-meta">${escHtml(meta)}</div>` : ''}
    ${why ? `<div class="rlog-winner-why">${escHtml(why)}</div>` : ''}
  </div>`;
}

function computeLogStats(data) {
  if (!data.length) return { total: 0, foundPct: null, avgMs: null, topServer: '—' };
  const found = data.filter(logEntryFound).length;
  const msArr = data.filter(e => e.ms != null).map(e => e.ms);
  const avgMs = msArr.length ? Math.round(msArr.reduce((a, b) => a + b, 0) / msArr.length) : null;
  const srvCounts = {};
  data.forEach(e => {
    const n = normalizeLogEntry(e);
    const lbl = n.bestServer?.label || n.serverStatus.find(s => s.status === 'found')?.label;
    if (lbl) srvCounts[lbl] = (srvCounts[lbl] || 0) + 1;
  });
  const top = Object.entries(srvCounts).sort((a, b) => b[1] - a[1])[0];
  return { total: data.length, foundPct: Math.round(found / data.length * 100), avgMs, topServer: top ? top[0] : '—' };
}

function updateLogStats(data) {
  const s = computeLogStats(data);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('rlog-st-total', s.total);
  set('rlog-st-found', s.foundPct != null ? s.foundPct + '%' : '—');
  set('rlog-st-avg', s.avgMs != null ? (s.avgMs < 1000 ? s.avgMs + 'ms' : (s.avgMs / 1000).toFixed(1) + 's') : '—');
  set('rlog-st-server', s.topServer);
  const srvEl = document.getElementById('rlog-st-server');
  if (srvEl) srvEl.classList.toggle('is-long', String(s.topServer || '').length > 10);
}

function filterLogData() {
  const term = logSearch.toLowerCase();
  return logData.filter(e => {
    const found = logEntryFound(e);
    if (logFilter === 'found' && !found) return false;
    if (logFilter === 'miss' && found) return false;
    if (!term) return true;
    const n = normalizeLogEntry(e);
    const hay = [
      n.contentName, n.imdbId,
      n.bestServer?.label,
      ...n.serverStatus.map(s => s.label),
      formatResCounts(aggregateResCounts(n.serverStatus)),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(term);
  });
}

function msClass(ms) {
  if (ms == null) return '';
  if (ms < 1500) return 'fast';
  if (ms < 4000) return 'ok';
  return 'slow';
}

function renderLogPage() {
  const wrap = document.getElementById('log-table-wrap');
  if (!wrap) return;
  updateLogStats(logData);
  const filtered = filterLogData();

  if (!logData.length) {
    wrap.innerHTML = '<div class="rlog-empty">No requests logged yet. Start a stream in Stremio to see activity here.</div>';
    return;
  }
  if (!filtered.length) {
    wrap.innerHTML = '<div class="rlog-empty">No entries match your search or filter.</div>';
    return;
  }

  const totalPages = Math.ceil(filtered.length / LOG_PAGE_SIZE);
  if (logPage >= totalPages) logPage = totalPages - 1;
  const slice = filtered.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);

  const rows = slice.map(raw => {
    const e = normalizeLogEntry(raw);
    const t = new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const d = new Date(e.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const ep = e.type === 'series'
      ? `<span class="rlog-ep">S${String(e.season||0).padStart(2,'0')}E${String(e.episode||0).padStart(2,'0')}</span>` : '';
    const typeBadge = e.type ? `<span class="rlog-type">${escHtml(e.type)}</span>` : '';
    const title = e.contentName
      ? `<span class="rlog-title-t">${escHtml(e.contentName)}</span>${ep}`
      : `<span class="rlog-imdb">${escHtml(e.imdbId || '—')}</span>${ep}`;
    const ms = e.ms == null ? '—' : (e.ms < 1000 ? `${e.ms}ms` : `${(e.ms/1000).toFixed(1)}s`);
    const msCls = msClass(e.ms);
    const ok = logEntryFound(e);

    return `<article class="rlog-row${ok ? '' : ' rlog-row-miss'}">
      <div class="rlog-row-time"><span class="rlog-date">${d}</span><span class="rlog-clock">${t}</span></div>
      <div class="rlog-row-title-col"><div class="rlog-row-title">${typeBadge}${title}</div></div>
      <div class="rlog-row-servers">${renderLogServers(e)}</div>
      <div class="rlog-row-winner">${renderLogWinner(e)}</div>
      <div class="rlog-row-search">
        <span class="rlog-ms ${msCls}">${ms}</span>
        <span class="rlog-found ${ok ? 'ok' : 'fail'}">${ok ? 'found' : 'miss'}</span>
      </div>
    </article>`;
  }).join('');

  let pageButtons = '';
  const maxBtns = 7;
  let start = Math.max(0, logPage - Math.floor(maxBtns / 2));
  let end = Math.min(totalPages, start + maxBtns);
  if (end - start < maxBtns) start = Math.max(0, end - maxBtns);
  for (let i = start; i < end; i++) {
    pageButtons += `<button class="rlog-page-btn${i === logPage ? ' active' : ''}" onclick="goLogPage(${i})">${i + 1}</button>`;
  }

  wrap.innerHTML = `<div class="rlog-head"><span>When</span><span>Title</span><span>Server results</span><span>Winner</span><span>Search</span></div>
    <div class="rlog-rows">${rows}</div>
    <div class="rlog-pagination">
      <span class="rlog-page-info">${logPage * LOG_PAGE_SIZE + 1}–${Math.min((logPage + 1) * LOG_PAGE_SIZE, filtered.length)} of ${filtered.length}${filtered.length !== logData.length ? ` (${logData.length} total)` : ''}</span>
      <div class="rlog-page-btns">
        <button class="rlog-page-btn" onclick="goLogPage(${logPage - 1})" ${logPage === 0 ? 'disabled' : ''}>‹</button>
        ${pageButtons}
        <button class="rlog-page-btn" onclick="goLogPage(${logPage + 1})" ${logPage >= totalPages - 1 ? 'disabled' : ''}>›</button>
      </div>
    </div>`;
}

function goLogPage(p) {
  const totalPages = Math.ceil(filterLogData().length / LOG_PAGE_SIZE);
  logPage = Math.max(0, Math.min(p, totalPages - 1));
  renderLogPage();
}

function wireLogFilters() {
  const search = document.getElementById('rlog-search');
  const filter = document.getElementById('rlog-filter');
  if (search && !search._w) {
    search._w = 1;
    search.addEventListener('input', () => { logSearch = search.value; logPage = 0; renderLogPage(); });
  }
  if (filter && !filter._w) {
    filter._w = 1;
    filter.addEventListener('change', () => { logFilter = filter.value; logPage = 0; renderLogPage(); });
  }
}

async function refreshLog() {
  try {
    const resp = await fetch('/api/request-log', { credentials: 'same-origin' });
    if (!resp.ok) { logData = []; renderLogPage(); return; }
    const data = await resp.json();
    const badge = document.getElementById('log-count-badge');
    if (badge) badge.textContent = data.length ? `${data.length} entries · stream resolution history` : 'Stream resolution history';
    logData = data;
    wireLogFilters();
    renderLogPage();
  } catch {}
}

async function clearLog() {
  if (!confirm('Clear request history?')) return;
  await fetch('/api/clear-request-log', { method: 'POST', credentials: 'same-origin' });
  logData = []; logPage = 0;
  refreshLog();
}

refreshLog();
let logInterval = setInterval(refreshLog, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(logInterval);
    logInterval = null;
    _stopServersAutoRefresh();
  } else {
    refreshLog();
    logInterval = setInterval(refreshLog, 30000);
    if (_isServersPageActive()) {
      renderServersPage({ failedOnly: true });
      _startServersAutoRefresh();
    }
  }
});

// ── Auto-generate server name ─────────────────────────────────────────────
async function autoNameServer(id) {
  const block = document.getElementById(`server-${id}`);
  if (!block) return;
  const labelEl = block.querySelector('.f-label');
  const urlEl = block.querySelector('.f-url');
  const typeEl = block.querySelector('.f-type');
  if (!urlEl || !labelEl) return;
  const url = (urlEl.value || '').trim().replace(/\/+$/, '');
  if (!url || labelEl.value.trim()) return;
  try {
    const resp = await fetch('/api/test-connection', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: typeEl?.value || 'emby', apiKey: '', userId: '' }),
    });
    const data = await resp.json();
    if (data.message) {
      const match = data.message.match(/Connected — (.+?)(?:\s+v[\d.]+)?$/);
      if (match && match[1]) {
        labelEl.value = match[1];
        if (block.classList.contains('collapsed')) updateSummary(id);
        autoSave();
      }
    }
  } catch {}
}

// ── Config encoding ───────────────────────────────────────────────────────
function encodeConfig(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Server block builder ──────────────────────────────────────────────────
function buildServerBlock(id) {
  const div = document.createElement('div');
  div.className = 'server-block server-card';
  div.id = `server-${id}`;
  const fields = `
    <div class="server-block-header">
      <div class="server-header-left">
        <label class="toggle-switch" title="Enable / disable this server">
          <input type="checkbox" class="f-enabled" checked onchange="updateToggle(${id})" />
          <span class="toggle-slider"></span>
        </label>
        <span class="server-number">Server <span class="server-num-label"></span></span>
        <span class="server-status-dot" id="status-dot-${id}"></span>
        <button class="btn-collapse" onclick="toggleCollapse(${id})" title="Collapse / expand">&#9660;</button>
      </div>
      <div class="server-header-right">
        <button class="btn-reorder btn-up" onclick="moveServer(${id}, -1)" title="Move up">&#9650;</button>
        <button class="btn-reorder btn-down" onclick="moveServer(${id}, 1)" title="Move down">&#9660;</button>
        <button class="btn-remove" onclick="removeServer(${id})">Remove</button>
      </div>
    </div>
    <div class="server-summary">
      <span class="sum-name"></span><span class="sum-sep">·</span><span class="sum-type"></span><span class="sum-sep">·</span><span class="sum-url"></span>
    </div>
    <div class="server-body">
      <div class="field-row triple">
        <div class="field-group">
          <label>Display Name</label>
          <input type="text" class="f-label" placeholder="e.g. Eagle" />
        </div>
        <div class="field-group" style="max-width:5rem">
          <label>Emoji</label>
          <input type="text" class="f-emoji" placeholder="&#128421;" maxlength="4" style="text-align:center;font-size:1.05rem" />
        </div>
        <div class="field-group">
          <label>Server Type</label>
          <select class="f-type" onchange="updateBlockStyle(${id})">
            <option value="emby">Emby</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
        </div>
      </div>
      <div class="field-row full">
        <div class="field-group">
          <label>Server URL</label>
          <input type="url" class="f-url" placeholder="http://192.168.1.100:8096" onblur="autoNameServer(${id})" oninput="autoSave()" />
        </div>
      </div>
      <div class="field-row full">
        <div class="field-group">
          <label>Thumbnail URL <span class="field-hint">optional — shown next to streams</span></label>
          <input type="url" class="f-thumbnail" placeholder="https://i.imgur.com/yourlogo.png" />
        </div>
      </div>
      <div class="cred-section">
        <div class="cred-title">Sign in to auto-fetch credentials</div>
        <div class="cred-inputs">
          <div class="field-group">
            <label>Username</label>
            <input type="text" class="f-username" placeholder="admin" autocomplete="off" oninput="updateCredWarning(${id})" />
          </div>
          <div class="field-group">
            <label>Password</label>
            <input type="password" class="f-password" placeholder="••••••••" autocomplete="off" oninput="updateCredWarning(${id});autoSave()" />
          </div>
        </div>
        <button class="btn-fetch" onclick="fetchCredentials(${id})">Fetch API Key &amp; User ID</button>
        <div class="cred-status" id="cred-status-${id}"></div>
      </div>
      <div class="divider">— or enter manually —</div>
      <div class="field-row">
        <div class="field-group">
          <label>API Key</label>
          <input type="text" class="f-apikey" placeholder="Auto-filled above" autocomplete="off" oninput="updateCredWarning(${id})" />
        </div>
        <div class="field-group">
          <label>User ID</label>
          <input type="text" class="f-userid" placeholder="Auto-filled above" autocomplete="off" />
        </div>
      </div>
      <div class="cred-warning" id="cred-warning-${id}" style="display:none"></div>
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
      <div class="field-group">
        <label>Stream priority</label>
        <select class="f-priority" onchange="autoSave()">
          <option value="5">5 — Default</option>
          <option value="1">1 — Highest</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="6">6</option>
          <option value="7">7</option>
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10 — Lowest</option>
        </select>
        <div class="field-hint">Lower number = preferred when sorting streams. Offline servers sink automatically.</div>
      </div>
      <div class="server-actions-row">
        <button class="btn-test" onclick="testConnection(${id})">Test Connection</button>
        <button class="btn-stats" onclick="loadLibraryStats(${id})">Library Stats</button>
      </div>
      <div class="test-status" id="test-status-${id}"></div>
      <div class="stats-display" id="stats-${id}"></div>
    </div>
  `;
  div.innerHTML = `
    <div class="srv-entry" role="button" tabindex="0" onclick="toggleManage(${id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleManage(${id})}">
      <div class="srv-rail" aria-hidden="true"></div>
      <span class="srv-idx" data-bind="index">—</span>
      <div class="srv-type-icon" data-bind="logo">${EMBY_LOGO}</div>
      <div class="srv-info">
        <span class="srv-name" data-bind="name">New server</span>
        <span class="srv-host" data-bind="host">not configured</span>
      </div>
      <div class="srv-ping-col">
        <span class="srv-ping-row" title="Stream Hub addon → your server"><small>Bridge</small><em data-bind="ping-bridge">—</em></span>
        <span class="srv-ping-row srv-ping-you" title="Your browser → your server (click Test)"><small>You</small><em data-bind="ping-you">—</em><button type="button" class="srv-you-test" onclick="event.stopPropagation();testYouPing(${id})" title="Test from your browser">Test</button></span>
      </div>
      <div class="srv-end">
        <span class="srv-status unknown" data-bind="badge"><span class="srv-status-dot"></span><span data-bind="badge-txt">Checking</span></span>
        <button type="button" class="srv-reconnect" onclick="event.stopPropagation();reconnectServer(${id})" title="Fix connection"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg></button>
        <span class="srv-expand" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></span>
      </div>
    </div>
    <div class="srv-drawer" id="edit-${id}">${fields}</div>
  `;
  return div;
}

// ── Server card (OMEGA) helpers ───────────────────────────────────────────
function toggleManage(id) {
  const c = document.getElementById('server-' + id);
  if (c) c.classList.toggle('open');
}

// Open a server's drawer and focus the sign-in field (used by "Reconnect").
function openManage(id) {
  const c = document.getElementById('server-' + id);
  if (!c) return;
  c.classList.add('open');
  const u = c.querySelector('.f-username') || c.querySelector('.f-url');
  if (u) u.focus();
  c.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _srvPingClass(ms) {
  if (ms == null) return '';
  if (ms < 200) return 'fast';
  if (ms < 600) return 'ok';
  return 'slow';
}

function _updateServersEmptyState() {
  const wrap = document.getElementById('servers-container');
  const empty = document.getElementById('srv-empty');
  const head = document.querySelector('#page-servers .srv-registry-head');
  if (!wrap || !empty) return;
  const count = wrap.querySelectorAll('.server-block').length;
  empty.style.display = count ? 'none' : 'flex';
  wrap.style.display = count ? '' : 'none';
  if (head) head.style.display = count ? '' : 'none';
}

const _reauthInflight = new Map();

function _applyRefreshedApiKey(block, apiKey) {
  if (!apiKey) return;
  const keyEl = block.querySelector('.f-apikey');
  if (keyEl && keyEl.value.trim() !== apiKey) {
    keyEl.value = apiKey;
    autoSave();
    if (typeof window.generateLinks === 'function') {
      try { window.generateLinks({ silent: true }); } catch {}
    }
  }
}

async function _reauthServerCredentials(block) {
  const sid = block?.id;
  if (!sid) return { ok: false, error: 'Server block missing' };
  if (_reauthInflight.has(sid)) return _reauthInflight.get(sid);
  const task = (async () => {
    const url = block.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
    const username = block.querySelector('.f-username')?.value.trim();
    const password = block.querySelector('.f-password')?.value;
    if (!url || !username || !password) {
      return { ok: false, error: 'Enter username and password to auto-renew tokens' };
    }
    try {
      const resp = await fetch('/api/fetch-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.apiKey || !data.userId) {
        return { ok: false, error: data.error || 'Login rejected — check username/password' };
      }
      block.querySelector('.f-apikey').value = data.apiKey;
      block.querySelector('.f-userid').value = data.userId;
      updateCredWarning(block.id.replace('server-', ''));
      autoSave();
      scheduleAccountConfigSync();
      if (typeof window.generateLinks === 'function') {
        try { window.generateLinks({ silent: true }); } catch {}
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not reach auth endpoint' };
    }
  })().finally(() => _reauthInflight.delete(sid));
  _reauthInflight.set(sid, task);
  return task;
}

async function reconnectServer(id) {
  const block = document.getElementById('server-' + id);
  if (!block) return;
  const username = block.querySelector('.f-username')?.value.trim();
  const password = block.querySelector('.f-password')?.value;
  if (!username || !password) {
    openManage(id);
    return;
  }
  const badgeTxt = block.querySelector('[data-bind=badge-txt]');
  const badge = block.querySelector('[data-bind=badge]');
  if (badge) badge.className = 'srv-status checking';
  if (badgeTxt) badgeTxt.textContent = 'Checking…';
  block.classList.add('reauthing');
  const result = await _reauthServerCredentials(block);
  block.classList.remove('reauthing');
  if (result.ok) {
    await refreshServerCard(block);
    await renderServersPage();
    if (typeof window.toast === 'function') window.toast('Reconnected — credentials refreshed');
  } else {
    if (badge) badge.className = 'srv-status down';
    if (badgeTxt) badgeTxt.textContent = 'Offline';
    if (typeof window.toast === 'function') window.toast(result.error || 'Re-auth failed — re-enter password');
    openManage(id);
  }
}
window.reconnectServer = reconnectServer;

let _addonRegionLabel = null;

async function _ensureAddonRegionLabel() {
  if (_addonRegionLabel) return _addonRegionLabel;
  try {
    const info = await fetch('/api/server-info').then(r => r.json());
    _addonRegionLabel = info.region
      ? info.region.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : 'Addon server';
  } catch {
    _addonRegionLabel = 'Addon server';
  }
  return _addonRegionLabel;
}

function _updateServersHeaderStats(up, total, fastestBridge) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('srv-count', total);
  set('srv-up', up);
  set('srv-fastest', fastestBridge != null ? fastestBridge + 'ms' : '—');
  const sub = document.getElementById('srv-sub');
  if (sub) {
    const region = _addonRegionLabel ? ` · bridge from ${_addonRegionLabel}` : '';
    sub.textContent = total
      ? `${up} of ${total} online${region} · click a row to edit`
      : 'Add Emby or Jellyfin endpoints to bridge into Stremio.';
  }
}

function _srvSetPingEm(em, ms) {
  if (!em) return;
  if (ms == null || ms === undefined) {
    em.textContent = '—';
    em.className = '';
  } else {
    em.textContent = ms + 'ms';
    em.className = _srvPingClass(ms);
  }
}

function _srvSetBadge(badge, cls) {
  if (!badge) return;
  badge.className = 'srv-status ' + cls;
  badge.classList.remove('srv-status-pop');
  void badge.offsetWidth;
  badge.classList.add('srv-status-pop');
}

async function refreshServerCard(block, opts = {}) {
  const retry = opts.retry !== false;
  const get = sel => block.querySelector(sel)?.value.trim() || '';
  const label = get('.f-label'), url = get('.f-url').replace(/\/+$/, '');
  const type = block.querySelector('.f-type')?.value || 'emby';
  let apiKey = get('.f-apikey'), userId = get('.f-userid');
  const username = get('.f-username'), password = get('.f-password');
  const nameEl = block.querySelector('[data-bind=name]');
  const hostEl = block.querySelector('[data-bind=host]');
  const logoEl = block.querySelector('[data-bind=logo]');
  const badge = block.querySelector('[data-bind=badge]');
  const badgeTxt = block.querySelector('[data-bind=badge-txt]');
  const idxEl = block.querySelector('[data-bind=index]');
  if (logoEl) logoEl.innerHTML = type === 'jellyfin' ? JELLYFIN_LOGO : EMBY_LOGO;
  block.classList.remove('type-emby', 'type-jellyfin');
  block.classList.add('type-' + type);
  if (nameEl) nameEl.textContent = label || 'New server';
  if (hostEl) hostEl.textContent = url ? url.replace(/^https?:\/\//, '') : 'not configured';
  if (idxEl) {
    const cards = [...document.querySelectorAll('#servers-container .server-block')];
    const n = cards.indexOf(block) + 1;
    idxEl.textContent = n > 0 ? String(n) : '';
  }
  const setState = (cls, txt) => {
    _srvSetBadge(badge, cls);
    if (badgeTxt) badgeTxt.textContent = txt;
    block.classList.toggle('ok', cls === 'up');
    block.classList.toggle('bad', cls === 'down');
    block.classList.toggle('checking', cls === 'checking');
  };
  if (!url || !apiKey || !userId) { setState('unknown', 'Not set'); return null; }
  setState('checking', 'Checking…');
  try {
    const r = await fetch('/api/test-connection', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId, username, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (data.apiKey) {
      _applyRefreshedApiKey(block, data.apiKey);
      apiKey = data.apiKey;
    }
    if (r.ok && data.ok) {
      setState('up', 'Online');
      return { up: true };
    }
    if ((r.status === 401 || r.status === 403) && retry && username && password) {
      setState('checking', 'Checking…');
      const refreshed = await _reauthServerCredentials(block);
      if (refreshed.ok) return refreshServerCard(block, { retry: false });
    }
    setState('down', 'Offline');
    return { up: false };
  } catch {
    setState('down', 'Offline');
    return { up: false };
  }
}

let _serversRefreshTimer = null;
let _serversFailedRetryTimer = null;

function _isServersPageActive() {
  const page = document.getElementById('page-servers');
  return !!(page && page.classList.contains('on'));
}

function _stopServersAutoRefresh() {
  clearInterval(_serversRefreshTimer);
  clearInterval(_serversFailedRetryTimer);
  _serversRefreshTimer = null;
  _serversFailedRetryTimer = null;
}

function _recomputeServersHeaderStats(blocks) {
  let up = 0, fastestBridge = null;
  for (const block of blocks) {
    if (!block.classList.contains('ok')) continue;
    up++;
    const pingTxt = block.querySelector('[data-bind=ping-bridge]')?.textContent || '';
    const ms = parseInt(pingTxt, 10);
    if (!isNaN(ms) && (fastestBridge === null || ms < fastestBridge)) fastestBridge = ms;
  }
  _updateServersHeaderStats(up, blocks.length, fastestBridge);
}

async function _refreshServersPingMetrics(blocks, opts = {}) {
  const healthByUrl = opts.healthByUrl || await _fetchHealthByUrl();
  const rows = blocks.map(block => ({
    block,
    url: block.querySelector('.f-url')?.value.trim().replace(/\/+$/, ''),
    label: block.querySelector('.f-label')?.value.trim() || 'Server',
  })).filter(r => r.url);

  const needsLivePing = [];
  for (const row of rows) {
    const bridgeEl = row.block.querySelector('[data-bind=ping-bridge]');
    if (!row.block.classList.contains('ok')) {
      _srvSetPingEm(bridgeEl, null);
    } else {
      const seeded = _bridgeMsFromHealth(healthByUrl, row.url);
      if (seeded != null) _srvSetPingEm(bridgeEl, seeded);
      else {
        _srvSetPingEm(bridgeEl, null);
        needsLivePing.push(row);
      }
    }
    const youEl = row.block.querySelector('[data-bind=ping-you]');
    if (youEl) { youEl.textContent = '—'; youEl.className = ''; }
    const youBtn = row.block.querySelector('.srv-you-test');
    if (youBtn) { youBtn.disabled = false; youBtn.textContent = 'Test'; }
  }
  if (!needsLivePing.length) return;

  try {
    const resp = await fetch('/api/ping-servers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: needsLivePing.map(r => ({ url: r.url, label: r.label })) }),
    });
    const data = resp.ok ? await resp.json().catch(() => ({})) : {};
    (data.results || []).forEach((r, i) => {
      const row = needsLivePing[i];
      if (!row || !r.up) return;
      _srvSetPingEm(row.block.querySelector('[data-bind=ping-bridge]'), r.ms);
    });
  } catch {
    needsLivePing.forEach(r => _srvSetPingEm(r.block.querySelector('[data-bind=ping-bridge]'), null));
  }
}

async function testYouPing(id) {
  const block = document.getElementById('server-' + id);
  if (!block) return;
  const url = block.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
  const youEl = block.querySelector('[data-bind=ping-you]');
  const btn = block.querySelector('.srv-you-test');
  if (!url || !youEl) return;
  if (!block.classList.contains('ok')) {
    youEl.textContent = '—';
    youEl.className = '';
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  youEl.textContent = '…';
  youEl.className = 'ping-pending';
  const ms = await browserPing(url);
  if (btn) { btn.disabled = false; btn.textContent = 'Test'; }
  if (ms == null) {
    youEl.textContent = 'N/A';
    youEl.className = 'ping-na';
  } else {
    _srvSetPingEm(youEl, ms);
  }
}
window.testYouPing = testYouPing;

function _startServersAutoRefresh() {
  _stopServersAutoRefresh();
  _serversFailedRetryTimer = setInterval(() => {
    if (_isServersPageActive()) renderServersPage({ failedOnly: true });
  }, 30000);
  _serversRefreshTimer = setInterval(() => {
    if (_isServersPageActive()) renderServersPage({ full: true });
  }, 120000);
}

async function renderServersPage(opts = {}) {
  await ensureAccountConfigLoaded();
  _updateServersEmptyState();
  const blocks = [...document.querySelectorAll('#servers-container .server-card')];
  const toRefresh = opts.failedOnly
    ? blocks.filter(b => b.classList.contains('bad'))
    : blocks;
  const failedFirst = [...toRefresh].sort((a, b) => {
    const aBad = a.classList.contains('bad') ? 0 : 1;
    const bBad = b.classList.contains('bad') ? 0 : 1;
    return aBad - bBad;
  });
  await Promise.all(failedFirst.map(block => refreshServerCard(block)));
  await _ensureAddonRegionLabel();
  const healthByUrl = await _fetchHealthByUrl();
  await _refreshServersPingMetrics(blocks, { healthByUrl });
  _recomputeServersHeaderStats(blocks);
  const healthServers = blocks.map(b => ({
    url: b.querySelector('.f-url')?.value.trim().replace(/\/+$/, ''),
    label: b.querySelector('.f-label')?.value.trim(),
    type: b.querySelector('.f-type')?.value || 'emby',
  })).filter(s => s.url);
  _registerHealthServers(healthServers);
}

function renderOnboarding() {
  const el = document.getElementById('onboard');
  if (el) el.style.display = 'none';
}

function updateMediaSourceStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  set('ms-stat-mode', { normal: 'Normal', split: 'Split', timeout: 'Fast' }[mode] || mode);
  const sortVal = document.getElementById('sort-order')?.value || 'size';
  set('ms-stat-sort', { size: 'Size', audio: 'Audio', bitrate: 'Bitrate' }[sortVal] || sortVal);
  const preset = document.getElementById('label-preset')?.value || 'standard';
  set('ms-stat-label', { standard: 'Standard', compact: 'Compact', detailed: 'Detailed', cinema: 'Cinema', minimal: 'Minimal', custom: 'Custom' }[preset] || preset);
}

function updateInstallStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const url = document.getElementById('acct-url')?.value?.trim();
  set('inst-stat-link', url ? 'Ready' : 'Pending');
  let count = 0;
  try {
    const cfg = collectConfig(true);
    count = cfg?.servers?.length || 0;
  } catch {}
  if (!count) count = document.querySelectorAll('.server-block').length;
  set('inst-stat-servers', count);
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  set('inst-stat-mode', { normal: 'Normal', split: 'Split', timeout: 'Fast' }[mode] || mode);
}
window.updateInstallStats = updateInstallStats;

function _refreshMediaPreview() {
  if (typeof updateLabelPreview === 'function') updateLabelPreview();
  const sumOn = document.getElementById('show-summary')?.checked;
  const pvWrap = document.getElementById('pv-summary-wrap');
  if (pvWrap) pvWrap.style.display = sumOn ? '' : 'none';
  if (sumOn && typeof updateSummaryPreview === 'function') updateSummaryPreview();
}

// ── Page-show hook (router calls this when a page is shown) ────────────────
window.onPageShow = function(name) {
  if (name !== 'servers') _stopServersAutoRefresh();
  if (name === 'servers') { renderServersPage(); _startServersAutoRefresh(); }
  if (name === 'streaming' || name === 'appearance') {
    updateMediaSourceStats();
    _refreshMediaPreview();
  }
  if (name === 'install') updateInstallStats();
  if (name === 'dashboard') {
    renderDashActivityShell();
    startDashLivePolling();
    startDashHealthPolling();
    renderDashActivity({ refreshHistory: true });
    (async () => {
      await ensureAccountConfigLoaded();
      renderDashboard();
      fetch('/api/health/ping-now', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      refreshDashCardHealth();
      refreshDashCardStatus({ full: true });
      pollLivePlaybackNotifications({ force: true });
      renderOnboarding();
      replayDashTileAnimations();
    })();
  } else {
    stopDashLivePolling();
    stopDashHealthPolling();
    _dashActivityGen++;
  }
  if (name === 'health' && typeof window.startHealth === 'function') window.startHealth();
  if (name === 'log' && typeof refreshLog === 'function') refreshLog();
  if (name === 'catalogs' && window.CatalogsWizard) window.CatalogsWizard.onPageShow(name);
  if (window.Controls) Controls.syncAll();
};

function dashActivityEsc(x) {
  return (typeof escHtml === 'function') ? escHtml(x) : String(x == null ? '' : x);
}
function dashActivityWhen(t) {
  if (!t) return '';
  const d = Date.now() - new Date(t).getTime();
  const h = Math.floor(d / 3600000);
  return h < 1 ? 'just now' : h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
}

// Mirror of titlesMatch + recentMatchesLive in lib/activityEnrich.js. Used so the
// Watched-history "▶ now" tag is computed against the SAME live set the Live panel
// renders (bundle.live — already suppressed + real-session aware), instead of the
// looser server-side bridge self-match. The two panels then always agree.
function dashNormTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function dashTitlesMatch(a, b) {
  const x = dashNormTitle(a), y = dashNormTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  const xWords = x.split(' ').filter(w => w.length > 2);
  const yWords = new Set(y.split(' ').filter(w => w.length > 2));
  if (!xWords.length || !yWords.size) return false;
  const overlap = xWords.filter(w => yWords.has(w)).length;
  return overlap >= Math.min(2, Math.ceil(xWords.length * 0.6));
}
function dashRecentMatchesLive(entry, liveList) {
  if (!entry || !entry.title || !Array.isArray(liveList)) return false;
  const entryHasSE = entry.season != null && entry.episode != null;
  for (const s of liveList) {
    if (!s) continue;
    if (entryHasSE && s.season != null && s.episode != null) {
      if (Number(s.season) !== Number(entry.season) || Number(s.episode) !== Number(entry.episode)) continue;
    }
    const candidates = [s.title, s.rawTitle, s.seriesName].filter(Boolean);
    if (candidates.some(c => dashTitlesMatch(entry.title, c))) return true;
  }
  return false;
}

function dashHistKindLabel(kind) {
  if (kind === 'resume') return 'In progress';
  if (kind === 'played') return 'Watched';
  return 'Stremio play';
}

function dashHistSourceBadge(entry) {
  const sources = entry.sources || [entry.source || 'bridge'];
  const hasBridge = sources.includes('bridge');
  const hasServer = sources.includes('server');
  if (hasBridge && hasServer) return '<span class="da-src-badge da-src-both">Stremio + Server</span>';
  if (hasServer) {
    const t = (entry.serverType || 'emby').toLowerCase();
    const cls = t === 'jellyfin' ? 'da-src-jellyfin' : 'da-src-emby';
    const label = t === 'jellyfin' ? 'Jellyfin' : 'Emby';
    return `<span class="da-src-badge ${cls}">${label}</span>`;
  }
  return '<span class="da-src-badge da-src-stremio">Stremio</span>';
}

function dashHistIcon(entry) {
  const isEp = entry.season != null || entry.episode != null || entry.type === 'series' || entry.itemType === 'Episode';
  return isEp ? '📺' : '🎬';
}

function dashHistMatchesFilter(entry, filter) {
  if (filter === 'all') return true;
  const sources = entry.sources || [entry.source || 'bridge'];
  if (filter === 'bridge') return sources.includes('bridge');
  if (filter === 'server') return sources.includes('server');
  return true;
}

function renderDashHistoryRows(recent, live, filter) {
  const esc = dashActivityEsc;
  const when = dashActivityWhen;
  const rows = (recent || []).filter(e => dashHistMatchesFilter(e, filter));
  if (!rows.length) {
    const emptyMsg = filter === 'all'
      ? 'No recent activity yet — plays in Stremio or your Emby/Jellyfin apps appear here.'
      : filter === 'bridge'
        ? 'No Stremio plays logged yet.'
        : 'No native server watch history returned — try playing something in Emby or Jellyfin.';
    return `<div class="da-empty da-hist-empty">${emptyMsg}</div>`;
  }
  return rows.map(e => {
    const isLive = dashRecentMatchesLive(e, live);
    const showProgress = e.kind === 'resume' && e.progressPct != null && e.progressPct < 98;
    const pct = showProgress ? Math.min(100, Math.max(1, Math.round(e.progressPct))) : null;
    const kindCls = e.kind === 'resume' ? 'da-hist-item-resume' : (e.kind === 'played' ? 'da-hist-item-played' : 'da-hist-item-lookup');
    const subParts = [];
    if (e.server) subParts.push(esc(e.server));
    subParts.push(esc(dashHistKindLabel(e.kind)));
    if (e.lookupCount > 1) subParts.push(`${e.lookupCount} lookups`);
    else if (pct != null && !showProgress) subParts.push('Completed');
    else if (pct != null) subParts.push(`${pct}% watched`);
    return `<div class="da-hist-item ${kindCls}${isLive ? ' da-hist-item-live' : ''}">
      <div class="da-hist-icon" aria-hidden="true">${dashHistIcon(e)}</div>
      <div class="da-hist-body">
        <div class="da-hist-title-row">
          <span class="da-hist-title" title="${esc(e.title || '')}">${esc(e.title || '—')}</span>
          ${dashHistSourceBadge(e)}
        </div>
        <div class="da-hist-sub">${subParts.join(' · ')}</div>
        ${showProgress ? `<div class="da-hist-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="da-hist-progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="da-hist-meta">
        ${isLive ? '<span class="da-hist-now">▶ now</span>' : ''}
        <span class="da-hist-when">${when(e.ts)}</span>
      </div>
    </div>`;
  }).join('');
}

function dashHistStats(recent) {
  const list = recent || [];
  const bridge = list.filter(e => (e.sources || [e.source]).includes('bridge')).length;
  const server = list.filter(e => (e.sources || [e.source]).includes('server')).length;
  const resume = list.filter(e => e.kind === 'resume').length;
  return { total: list.length, bridge, server, resume };
}

function paintDashActivityPanels(el, a, bundle, localServers) {
  const esc = dashActivityEsc;
  const when = dashActivityWhen;
  const serverCount = localServers.length || a.serverCount || 0;
  const live = bundle.live || [];
  const probes = bundle.probes || a.liveProbes || [];

  const liveRows = window.MEBLiveUI
    ? window.MEBLiveUI.renderLiveRows(live, { emptyHtml: '' })
    : '';

  const emptyMsg = live.length ? '' : liveEmptyMessage(probes, serverCount);
  const recent = a.recent || [];
  const stats = dashHistStats(recent);
  const histRows = renderDashHistoryRows(recent, live, _dashHistFilter);

  el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
    <div class="dash-act-panel dash-act-live">
      <h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming <span class="dash-act-count">${live.length}</span></h3>
      <p class="dash-act-hint">Sessions, browser, and bridge stream lookups · ${serverCount} server${serverCount === 1 ? '' : 's'} · refreshes every ${Math.round(DASH_LIVE_POLL_MS / 1000)}s on this page</p>
      ${renderLiveProbeStrip(probes)}
      <div class="da-list">${liveRows || `<div class="da-empty">${emptyMsg}</div>`}</div>
    </div>
    <div class="dash-act-panel dash-act-history">
      <div class="da-hist-head">
        <h3 class="block-title dash-act-title">Recent activity</h3>
        <div class="da-hist-filters" role="tablist" aria-label="Activity source filter">
          <button type="button" class="da-hist-filter${_dashHistFilter === 'all' ? ' on' : ''}" data-hist-filter="all" role="tab">All <span class="da-hist-filter-n">${stats.total}</span></button>
          <button type="button" class="da-hist-filter${_dashHistFilter === 'bridge' ? ' on' : ''}" data-hist-filter="bridge" role="tab">Stremio <span class="da-hist-filter-n">${stats.bridge}</span></button>
          <button type="button" class="da-hist-filter${_dashHistFilter === 'server' ? ' on' : ''}" data-hist-filter="server" role="tab">Servers <span class="da-hist-filter-n">${stats.server}</span></button>
        </div>
      </div>
      <p class="dash-act-hint">Stremio addon plays <strong>and</strong> native Emby/Jellyfin watch history · <strong>▶ now</strong> syncs with Live</p>
      <div class="da-hist-stats">
        <span class="da-hist-stat"><strong>${stats.total}</strong> titles</span>
        ${stats.resume ? `<span class="da-hist-stat da-hist-stat-resume"><strong>${stats.resume}</strong> in progress</span>` : ''}
      </div>
      <div class="da-hist-list">${histRows}</div>
    </div>
  </div>`;
  el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
  el.querySelectorAll('[data-hist-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _dashHistFilter = btn.dataset.histFilter || 'all';
      paintDashActivityPanels(el, a, bundle, localServers);
    });
  });
}

async function renderDashActivity(opts = {}) {
  const gen = ++_dashActivityGen;
  const el = document.getElementById('dash-activity');
  if (!el) return;

  await ensureAccountConfigLoaded();
  if (gen !== _dashActivityGen) return;

  const localServers = collectServersForLive();
  if (!dashActivityHasContent(el)) renderDashActivityShell(localServers.length);
  if (gen !== _dashActivityGen) return;

  let a = opts.activity || _dashActivityData;
  if (!a || opts.refreshHistory) {
    let resp;
    try {
      resp = await fetch('/api/user/activity?quick=1', { credentials: 'same-origin' });
    } catch {
      if (!dashActivityHasContent(el)) {
        el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
          <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Could not load activity — check your connection.</div></div>
          <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Could not load history.</div></div>
        </div>`;
      }
      return;
    }
    if (gen !== _dashActivityGen) return;

    if (resp.status === 401) {
      el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
        <div class="dash-act-panel"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Sign in to see live activity from your servers.</div></div>
        <div class="dash-act-panel"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Sign in to see your personal watch history.</div></div>
      </div>`;
      return;
    }

    const fresh = resp.ok ? await resp.json().catch(() => null) : null;
    if (!fresh) {
      if (!dashActivityHasContent(el)) {
        el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
          <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Activity unavailable right now.</div></div>
          <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">History unavailable right now.</div></div>
        </div>`;
      }
      return;
    }
    a = fresh;
    _dashActivityData = fresh;
  }
  if (gen !== _dashActivityGen) return;

  _activityRecentCache = Array.isArray(a.recent) ? a.recent : [];
  const hasServers = localServers.length > 0 || !!a.hasServers;

  if (!hasServers) {
    el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
      <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3><div class="da-empty">Add servers on the <a href="#" data-page="servers">Servers</a> page to see live activity from your Emby/Jellyfin instances.</div></div>
      <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Your personal watch history appears here once you have servers configured.</div></div>
    </div>`;
    el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
    return;
  }

  let bundle = opts.bundle;
  if (!bundle?.ts) {
    if (_liveBundleCache.ts) bundle = _liveBundleCache;
    else bundle = await fetchLiveBundle(false, { fast: true });
  }
  if (gen !== _dashActivityGen) return;

  paintDashActivityPanels(el, a, bundle, localServers);
}

function replayDashTileAnimations() {
  document.querySelectorAll('#page-dashboard .dash-tiles .tile').forEach(tile => {
    tile.style.animation = 'none';
    tile.offsetHeight;
    tile.style.animation = '';
  });
}

// Real-time: live playback + buffering notifications (all pages when signed in).
setInterval(() => { pollLivePlaybackNotifications(); }, LIVE_PLAYBACK_POLL_MS);
setTimeout(() => { pollLivePlaybackNotifications({ force: true }); }, 400);

// Dashboard health sparklines + fast health-based status while that page is open.
setInterval(() => {
  const dash = document.getElementById('page-dashboard');
  if (!dash || !dash.classList.contains('on')) return;
  refreshDashCardHealth();
  refreshDashCardStatus();
}, DASH_GRAPH_POLL_MS);

// Full authenticated connection test (heavier) on a slower cadence.
setInterval(() => {
  const dash = document.getElementById('page-dashboard');
  if (!dash || !dash.classList.contains('on')) return;
  refreshDashCardStatus({ full: true });
}, DASH_CONN_POLL_MS);

const EMBY_LOGO = '<img class="brandimg" src="/img/emby.png" alt="Emby" decoding="async">';
const JELLYFIN_LOGO = '<img class="brandimg" src="/img/jellyfin.png" alt="Jellyfin" decoding="async">';

function openServerManage(index) {
  location.hash = '#/servers';
  setTimeout(() => {
    const cards = document.querySelectorAll('#servers-container .server-card');
    const card = cards[index];
    if (!card) return;
    card.classList.add('open');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}

async function renderDashboard(force = false) {
  if (_dashboardInFlight) return;
  _dashboardInFlight = true;
  const wrap = document.getElementById('dash-cards');
  try {
    if (wrap && !wrap.children.length) {
      wrap.innerHTML = '<div class="dash-loading">Loading your servers…</div>';
    }
    await ensureAccountConfigLoaded();
    const now = Date.now();
    const cfg = collectConfig(true) || { servers: [] };
    const servers = cfg.servers || [];
    _registerHealthServers(servers);
    const healthByUrl = await _fetchHealthByUrl();
    const catCount = (window.collectExternalCatalogs ? window.collectExternalCatalogs() : []).length;
    const catEl = document.getElementById('tile-catalogs');
    if (catEl) catEl.textContent = catCount;
    if (!wrap) return;
    wrap.innerHTML = '';
    let upCount = 0, movieTotal = 0, showTotal = 0, fastest = null;
    const dashMeta = [];
    const PALETTE = [
      ['linear-gradient(135deg,#fb923c,#f472b6)','rgba(244,114,182,.5)'],
      ['linear-gradient(135deg,#818cf8,#22d3ee)','rgba(34,211,238,.5)'],
      ['linear-gradient(135deg,#34d399,#22d3ee)','rgba(52,211,153,.5)'],
      ['linear-gradient(135deg,#f59e0b,#fb7185)','rgba(245,158,11,.5)'],
      ['linear-gradient(135deg,#a78bfa,#f472b6)','rgba(167,139,250,.5)'],
    ];
    servers.forEach((s, idx) => {
      const [bar, glow] = PALETTE[idx % PALETTE.length];
      const isJelly = (s.type === 'jellyfin');
      const brandSvg = isJelly ? JELLYFIN_LOGO : EMBY_LOGO;
      const brandName = isJelly ? 'Jellyfin' : 'Emby';
      const badgeBg = isJelly ? 'linear-gradient(135deg,#aa5cc3,#00a4dc)' : 'linear-gradient(135deg,#52b54b,#2f8f3e)';
      const card = document.createElement('div');
      card.className = 'gcard';
      card.dataset.serverUrl = s.url || '';
      const healthHtml = _dashHealthPanel(healthByUrl[_normServerUrl(s.url)]?.history || []);
      card.style.setProperty('--bar', bar);
      card.style.setProperty('--accentglow', glow);
      card.style.setProperty('--badgebg', badgeBg);
      card.innerHTML = `
        <div class="gcard-top"></div>
        <div class="gcard-pad">
          <div class="gcard-head">
            <div class="gbrand" style="--accentglow:${isJelly ? 'rgba(122,70,200,.7)' : 'rgba(82,181,75,.7)'}">${brandSvg}</div>
            <div style="flex:1;min-width:0">
              <div class="gcard-nm">${escHtml(s.label)}</div>
              <div class="gcard-host">${escHtml((s.url||'').replace(/^https?:\/\//,''))}</div>
            </div>
            <div class="gstatus"><span class="gpill loading" data-pill title="Bridge connection status">…</span><span class="gbridge-now" data-bridge-ms title="Bridge latency now (addon → server)"></span></div>
          </div>
          <div class="gtype" style="display:none">${brandName}</div>
          <div class="gchips">
            <div class="gchip"><div class="cn" data-st="movies">—</div><div class="ct">Movies</div></div>
            <div class="gchip"><div class="cn" data-st="shows">—</div><div class="ct">Shows</div></div>
            <div class="gchip"><div class="cn" data-st="episodes">—</div><div class="ct">Episodes</div></div>
          </div>
          <div class="gcard-health">${healthHtml}</div>
        </div>`;
      wrap.appendChild(card);
      const setStats = (st) => {
        card.querySelector('[data-st=movies]').textContent   = (st.movies||0).toLocaleString();
        card.querySelector('[data-st=shows]').textContent    = (st.shows||0).toLocaleString();
        card.querySelector('[data-st=episodes]').textContent = (st.episodes||0).toLocaleString();
      };
      const setStatus = (online, bridgeMs) => _applyDashCardStatus(card, online, bridgeMs);
      dashMeta.push({ s, setStatus, setStats });
    });
    const pingQueue = [];
    await Promise.all(dashMeta.map(async (meta) => {
      const { s, setStatus, setStats } = meta;
      let bridgeMs = _bridgeMsFromHealth(healthByUrl, s.url);
      const healthSt = _statusFromHealth(healthByUrl, s.url);
      if (healthSt && !healthSt.online) {
        setStatus(false, null);
        return;
      }
      const conn = await _testServerConnection(s);
      const online = conn.ok;
      if (online) {
        upCount++;
        if (bridgeMs != null && (fastest === null || bridgeMs < fastest)) fastest = bridgeMs;
        if (bridgeMs == null) pingQueue.push(meta);
      }
      setStatus(online, bridgeMs);
      if (!online) return;
      const k = _libKey(s);
      const cached = _libStatsCache[k];
      if (!force && cached && (now - cached.ts < LIB_TTL_MS)) {
        setStats(cached);
        movieTotal += (cached.movies||0);
        showTotal += (cached.shows||0);
        return;
      }
      try {
        const r = await fetch('/api/library-stats', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId,
            username: s.username || '', password: s.password || '',
          }),
        });
        if (r.ok) {
          const st = await r.json();
          setStats(st);
          movieTotal += (st.movies||0);
          showTotal += (st.shows||0);
          _libStatsCache[k] = { movies: st.movies||0, shows: st.shows||0, episodes: st.episodes||0, ts: now };
          _saveLibCache();
        }
      } catch { /* library counts stay — */ }
    }));
    if (pingQueue.length) {
      try {
        const resp = await fetch('/api/ping-servers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servers: pingQueue.map(m => ({ url: m.s.url, label: m.s.label })) }),
        });
        const data = resp.ok ? await resp.json().catch(() => ({})) : {};
        (data.results || []).forEach((r, i) => {
          const meta = pingQueue[i];
          if (!meta || !r.up || r.ms == null) return;
          meta.setStatus(true, r.ms);
          if (fastest === null || r.ms < fastest) fastest = r.ms;
        });
      } catch { /* bridge ms stays blank */ }
    }
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setTxt('tile-servers', upCount);
    setTxt('tile-movies', movieTotal.toLocaleString());
    setTxt('tile-shows', showTotal.toLocaleString());
    const pingEl = document.getElementById('tile-ping');
    if (pingEl) {
      pingEl.textContent = fastest != null ? fastest + 'ms' : '—';
      pingEl.title = fastest != null
        ? `Fastest bridge path right now · ${fastest}ms (addon → server)`
        : 'No bridge latency data yet';
    }
    const totalMo = servers.reduce((a, s) => a + monthlyCost(s.cost, s.costPeriod), 0);
    setTxt('tile-cost', '$' + Math.round(totalMo) + (totalMo > 0 ? '/mo' : ''));
    setTxt('tile-cost-l', 'Server costs · $' + Math.round(totalMo * 12) + '/yr');
    setTxt('dash-status', servers.length
      ? `Everything's loaded. ${upCount}/${servers.length} servers reachable.`
      : 'No servers yet — add one on the Servers page.');
    document.querySelectorAll('#page-dashboard .dash-tiles .tile .n').forEach(n => {
      n.classList.remove('tile-num-pop');
      n.offsetHeight;
      n.classList.add('tile-num-pop');
    });
  } finally { _dashboardInFlight = false; }
}

// ── Server collapse ───────────────────────────────────────────────────────
function updateSummary(id) {
  const block = document.getElementById(`server-${id}`);
  const name = block.querySelector('.f-label')?.value.trim() || 'Unnamed';
  const type = block.querySelector('.f-type')?.value || 'emby';
  const url = block.querySelector('.f-url')?.value.trim() || '';
  const urlShort = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  block.querySelector('.sum-name').textContent = name;
  block.querySelector('.sum-type').textContent = type === 'jellyfin' ? 'Jellyfin' : 'Emby';
  block.querySelector('.sum-url').textContent = urlShort;
}

function toggleCollapse(id) {
  const block = document.getElementById(`server-${id}`);
  const collapsed = block.classList.toggle('collapsed');
  block.querySelector('.btn-collapse').textContent = collapsed ? '\u25B6' : '\u25BC';
  if (collapsed) updateSummary(id);
  autoSave();
}

function updateBlockStyle(id) {
  const block = document.getElementById(`server-${id}`);
  const type = block.querySelector('.f-type').value;
  block.classList.remove('type-emby', 'type-jellyfin');
  block.classList.add(`type-${type}`);
  const logoEl = block.querySelector('[data-bind=logo]');
  if (logoEl) logoEl.innerHTML = type === 'jellyfin' ? JELLYFIN_LOGO : EMBY_LOGO;
  if (block.classList.contains('collapsed')) updateSummary(id);
}

function updateToggle(id) {
  const block = document.getElementById(`server-${id}`);
  block.classList.toggle('disabled', !block.querySelector('.f-enabled').checked);
}

function moveServer(id, dir) {
  const block = document.getElementById(`server-${id}`);
  const container = document.getElementById('servers-container');
  const blocks = [...container.querySelectorAll('.server-block')];
  const idx = blocks.indexOf(block);
  const target = blocks[idx + dir];
  if (!target) return;
  if (dir === -1) container.insertBefore(block, target);
  else container.insertBefore(target, block);
  renumberBlocks();
  autoSave();
}

function renumberBlocks() {
  const blocks = document.querySelectorAll('.server-block');
  blocks.forEach((b, i) => {
    b.querySelector('.server-num-label').textContent = i + 1;
    b.querySelector('.btn-up').disabled = i === 0;
    b.querySelector('.btn-down').disabled = i === blocks.length - 1;
  });
  document.getElementById('btn-add').disabled = blocks.length >= 10;
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.style.display = blocks.length > 1 ? '' : 'none';
  });
  updateSteps();
}

function addServer(data = null) {
  const container = document.getElementById('servers-container');
  if (container.querySelectorAll('.server-block').length >= 10) return;
  const id = nextId++;
  const block = buildServerBlock(id);
  container.appendChild(block);
  if (data) {
    block.querySelector('.f-label').value = data.label || '';
    block.querySelector('.f-url').value = data.url || '';
    block.querySelector('.f-apikey').value = data.apiKey || '';
    block.querySelector('.f-userid').value = data.userId || '';
    block.querySelector('.f-username').value = data.username || '';
    block.querySelector('.f-password').value = data.password || '';
    block.querySelector('.f-thumbnail').value = data.thumbnail || '';
    if (block.querySelector('.f-emoji')) block.querySelector('.f-emoji').value = data.emoji || '';
    if (block.querySelector('.f-cost')) block.querySelector('.f-cost').value = (data.cost != null ? data.cost : '');
    if (block.querySelector('.f-cost-period')) block.querySelector('.f-cost-period').value = data.costPeriod || 'none';
    if (block.querySelector('.f-priority')) block.querySelector('.f-priority').value = String(data.priority != null ? data.priority : 5);
    if (data.type) {
      block.querySelector('.f-type').value = data.type;
      updateBlockStyle(id);
    }
  }
  renumberBlocks();
  updateCredWarning(id);
  refreshServerCard(block).then(() => renderServersPage());
  _updateServersEmptyState();
  if (!data) {
    block.classList.add('open');          // new manual add → open the drawer to fill in
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const f = block.querySelector('.f-label'); if (f) f.focus();
  }
}

function removeServer(id) {
  const el = document.getElementById(`server-${id}`);
  if (el) el.remove();
  _updateServersEmptyState();
  renderServersPage();
  renumberBlocks();
  autoSave();
}

// ── Collect config ────────────────────────────────────────────────────────
function collectConfig(silent = false) {
  const blocks = document.querySelectorAll('.server-block');
  if (blocks.length === 0) {
    if (!silent) showError('Add at least one server.');
    return null;
  }
  const servers = [];
  for (const block of blocks) {
    if (!block.querySelector('.f-enabled').checked) continue;
    const label = block.querySelector('.f-label').value.trim();
    const type = block.querySelector('.f-type').value;
    const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
    const apiKey = block.querySelector('.f-apikey').value.trim();
    const userId = block.querySelector('.f-userid').value.trim();
    const username = block.querySelector('.f-username').value.trim();
    const password = block.querySelector('.f-password').value;
    if (!label || !url || !apiKey || !userId) {
      if (!silent) showError('All fields (Name, URL, API Key, User ID) must be filled for every enabled server.');
      return null;
    }
    const thumbnail = block.querySelector('.f-thumbnail')?.value.trim() || '';
    const emoji = block.querySelector('.f-emoji')?.value.trim() || '';
    const entry = { label, type, url, apiKey, userId };
    if (thumbnail) entry.thumbnail = thumbnail;
    if (emoji) entry.emoji = emoji;
    if (username && password) { entry.username = username; entry.password = password; }
    const costRaw = block.querySelector('.f-cost')?.value.trim() || '';
    const costPeriod = block.querySelector('.f-cost-period')?.value || 'none';
    const cost = costRaw === '' ? NaN : Number(costRaw);
    if (!Number.isNaN(cost) && cost > 0 && costPeriod !== 'none') { entry.cost = cost; entry.costPeriod = costPeriod; }
    const pri = parseInt(block.querySelector('.f-priority')?.value || '5', 10);
    if (pri >= 1 && pri <= 10 && pri !== 5) entry.priority = pri;
    servers.push(entry);
  }
  if (servers.length === 0) {
    if (!silent) showError('At least one server must be enabled.');
    return null;
  }
  return { servers };
}

function populateFromConfig(config) {
  document.getElementById('servers-container').innerHTML = '';
  nextId = 0;
  for (const server of (config.servers || [])) addServer(server);
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function safeJson(resp) {
  try { return await resp.json(); }
  catch { return { error: `Server returned non-JSON (HTTP ${resp.status}).` }; }
}
function showError(msg) { const e = document.getElementById('global-error'); e.textContent = msg; e.style.display = 'block'; }
function hideError() { document.getElementById('global-error').style.display = 'none'; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function monthlyCost(cost, period) {
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return 0;
  if (period === 'monthly')   return c;
  if (period === 'quarterly') return c / 3;
  if (period === 'yearly')    return c / 12;
  return 0;
}
window.monthlyCost = monthlyCost;

// ── Profile ───────────────────────────────────────────────────────────────
function setProfileButtons(disabled) {
  document.querySelectorAll('.btn-profile').forEach(b => b.disabled = disabled);
}

async function saveProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter a profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter a password to protect your profile.'; statusEl.className = 'profile-status error'; return; }
  const config = collectConfig();
  if (!config) return;
  setProfileButtons(true);
  statusEl.textContent = 'Saving...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, config }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = `Done — ${data.message}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

async function loadProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter your profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter your password.'; statusEl.className = 'profile-status error'; return; }
  setProfileButtons(true);
  statusEl.textContent = 'Loading...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    populateFromConfig(data.config);
    const ago = data.updatedAt ? ` (saved ${new Date(data.updatedAt).toLocaleDateString()})` : '';
    statusEl.textContent = `Profile loaded${ago}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

// ── Import / Export ───────────────────────────────────────────────────────
function exportConfig() {
  const state = collectFormState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'stream-hub-config.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const state = JSON.parse(e.target.result);
      localStorage.setItem(lsKey(), JSON.stringify(state));
      location.reload();
    } catch { alert('Invalid config file.'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ── Saved-login warning ──
function updateCredWarning(id) {
  const block = document.getElementById(`server-${id}`);
  if (!block) return;
  const el = document.getElementById(`cred-warning-${id}`);
  if (!el) return;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const username = block.querySelector('.f-username').value.trim();
  const password = block.querySelector('.f-password').value;
  if (apiKey && !(username && password)) {
    el.innerHTML = '⚠️ No login saved — this API key will expire and the addon cannot auto-renew it. '
      + 'Enter your <b>Username</b> + <b>Password</b> above and click “Fetch API Key & User ID” so tokens refresh automatically.';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// ── Credential fetch ──────────────────────────────────────────────────────
async function fetchCredentials(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const username = block.querySelector('.f-username').value.trim();
  const password = block.querySelector('.f-password').value;
  const statusEl = document.getElementById(`cred-status-${id}`);
  const btn = block.querySelector('.btn-fetch');
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'cred-status error'; return; }
  if (!username) { statusEl.textContent = 'Enter your username.'; statusEl.className = 'cred-status error'; return; }
  btn.disabled = true; btn.textContent = 'Fetching...';
  statusEl.textContent = ''; statusEl.className = 'cred-status';
  try {
    const resp = await fetch('/api/fetch-credentials', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    block.querySelector('.f-apikey').value = data.apiKey;
    block.querySelector('.f-userid').value = data.userId;
    updateCredWarning(id);
    statusEl.textContent = 'Credentials fetched!'; statusEl.className = 'cred-status success';
    autoSave();
    refreshServerCard(block).then(() => renderServersPage());
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'cred-status error';
  } finally { btn.disabled = false; btn.textContent = 'Fetch API Key & User ID'; }
}

// ── Test connection ───────────────────────────────────────────────────────
async function testConnection(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statusEl = document.getElementById(`test-status-${id}`);
  const btn = block.querySelector('.btn-test');
  const dot = document.getElementById(`status-dot-${id}`);
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'test-status error'; return; }
  if (!apiKey || !userId) { statusEl.textContent = 'Enter API Key and User ID first.'; statusEl.className = 'test-status error'; return; }
  btn.disabled = true; btn.textContent = 'Testing...';
  statusEl.textContent = ''; statusEl.className = 'test-status';
  try {
    const username = block.querySelector('.f-username')?.value.trim() || '';
    const password = block.querySelector('.f-password')?.value || '';
    const resp = await fetch('/api/test-connection', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId, username, password }) });
    const data = await safeJson(resp);
    if (data.apiKey) _applyRefreshedApiKey(block, data.apiKey);
    if (data.ok) {
      statusEl.textContent = data.message; statusEl.className = 'test-status success';
      if (dot) dot.className = 'server-status-dot online';
    } else {
      statusEl.textContent = data.error; statusEl.className = 'test-status error';
      if (dot) dot.className = 'server-status-dot offline';
    }
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'test-status error';
    if (dot) dot.className = 'server-status-dot offline';
  } finally { btn.disabled = false; btn.textContent = 'Test Connection'; }
}

// ── Library stats ─────────────────────────────────────────────────────────
async function loadLibraryStats(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statsEl = document.getElementById(`stats-${id}`);
  const btn = block.querySelector('.btn-stats');
  if (!url) { statsEl.textContent = 'Enter Server URL first.'; statsEl.className = 'stats-display error'; return; }
  if (!apiKey || !userId) { statsEl.textContent = 'Enter API Key + User ID first.'; statsEl.className = 'stats-display error'; return; }
  btn.disabled = true; btn.textContent = 'Loading...';
  statsEl.textContent = ''; statsEl.className = 'stats-display';
  try {
    const username = block.querySelector('.f-username')?.value.trim() || '';
    const password = block.querySelector('.f-password')?.value || '';
    const resp = await fetch('/api/library-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, apiKey, userId, username, password }) });
    const data = await safeJson(resp);
    if (data.apiKey) _applyRefreshedApiKey(block, data.apiKey);
    if (data.error) { statsEl.textContent = data.error; statsEl.className = 'stats-display error'; }
    else {
      statsEl.className = 'stats-display';
      statsEl.innerHTML = `
        <span class="stats-badge"><span>Movies:</span><span>${data.movies.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Shows:</span><span>${data.shows.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Episodes:</span><span>${data.episodes.toLocaleString()}</span></span>`;
    }
  } catch (err) {
    statsEl.textContent = err.message; statsEl.className = 'stats-display error';
  } finally { btn.disabled = false; btn.textContent = 'Library Stats'; }
}

// ── Label preview — trimmed to 5 presets ─────────────────────────────────
function updateLabelPreview() {
  const preset = document.getElementById('label-preset').value;
  const previewEl = document.getElementById('label-preview');
  const previews = {
    standard: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nTrueHD 7.1\nMKV · 85.2Mbps · 58.32 GB' },
    compact:  { name: 'Server · 4K · DV · HEVC 10bit', desc: 'TrueHD 7.1 · 85.2Mbps · 58.32 GB' },
    detailed: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nENG TrueHD 7.1 · FRE DD+ 5.1\nSubs: EN · FR · ES\n3840x2160 · 85.2Mbps · 58.32 GB' },
    cinema:   { name: 'Server · 4K · DV · REMUX', desc: 'HEVC 10bit\nTrueHD 7.1\nSubs: EN · FR · ES\n58.32 GB' },
    minimal:  { name: 'Server · 4K', desc: '58.32 GB' },
    custom:   { name: 'Server Â· custom fields', desc: 'fields selected in Custom section below' },
  };
  const p = previews[preset] || previews.standard;
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Reflect the "Badges & extras" choices live in the preview.
  const v = id => document.getElementById(id)?.value;
  const qb = v('quality-badge'), fl = v('flag-emoji'), br = v('bitrate-bar'), ss = v('subs-style');
  let name = p.name;
  if (qb === 'emoji') name = '💎 ' + name;
  else if (qb === 'tags') name = '[REMUX][4K][HDR] ' + name;
  // For custom preset keep its own descriptive text; otherwise compose desc from the badges.
  let descSource = p.desc;
  if (preset !== 'custom') {
    const parts = [];
    if (fl === '') parts.push('ENG');
    else if (fl === 'flag') parts.push('🇬🇧');
    else if (fl === 'both') parts.push('🇬🇧 ENG');
    if (br === '') parts.push('85.2 Mbps');
    else if (br === 'blocks') parts.push('▰▰▰▱');
    else if (br === 'segments') parts.push('▰▰▱▱');
    if (ss === 'full') parts.push('Subs: EN · FR · ES');
    else if (ss === 'count') parts.push('Subs ×3');
    else if (ss === 'icons') parts.push('Subs 🇬🇧 🇫🇷 🇪🇸');
    parts.push('58.32 GB');
    descSource = parts.join(' · ');
  }
  const descHtml = esc(descSource).split('\n')
    .map(l => `<div style="color:var(--text-muted);font-size:0.72rem;line-height:1.55">${l}</div>`)
    .join('');
  previewEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.1rem 0">
      <div style="flex-shrink:0;width:26px;height:26px;background:var(--bg-elevated);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text-muted);margin-top:0.1rem">&#9654;</div>
      <div style="min-width:0">
        <div style="color:#d0c8ff;font-weight:600;font-size:0.8rem;line-height:1.4;margin-bottom:0.1rem">${esc(name)}</div>
        ${descHtml}
      </div>
    </div>`;
  updateMediaSourceStats();
  autoSave();
}

function toggleCustomPreset() {
  var preset = document.getElementById("label-preset").value;
  var panel = document.getElementById("custom-preset-panel");
  if (panel) panel.style.display = preset === "custom" ? "block" : "none";
}

// ── Summary preview — trimmed to 4 styles ────────────────────────────────
function toggleSummaryStyle() {
  const show = document.getElementById('show-summary').checked;
  const opts = document.getElementById('summary-options');
  if (opts) opts.style.display = show ? 'flex' : 'none';
  const pvWrap = document.getElementById('pv-summary-wrap');   // hide the preview's summary section when off
  if (pvWrap) pvWrap.style.display = show ? '' : 'none';
  if (show) updateSummaryPreview();
  autoSave();
}

// toggleCatalogOptions, refreshKeyPills — catalogs-wizard.js

const PREVIEW_SERVERS = [
  { label: 'Cloud Emby', emoji: '', type: 'emby', status: 'found', count: 5, resLabels: ['4K','1080p'], resCounts: {'4K':2,'1080p':3}, pingMs: 12 },
  { label: 'Home Jellyfin', emoji: '', type: 'jellyfin', status: 'found', count: 2, resLabels: ['1080p'], resCounts: {'1080p':2}, pingMs: 28 },
  { label: 'Backup NAS', emoji: '', type: 'emby', status: 'not_found', count: 0, resLabels: [], resCounts: {}, pingMs: null },
];

function updateSummaryPreview() {
  const el = document.getElementById('summary-preview');
  if (!el) return;
  const style = document.getElementById('summary-style')?.value || 'compact';
  const servers = PREVIEW_SERVERS;
  const found = servers.filter(s => s.status === 'found');
  const total = found.reduce((n, s) => n + s.count, 0);
  const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '...' : str;
  const eLabel = (s, maxLen) => {
    const prefix = s.emoji ? s.emoji + ' ' : '';
    return prefix + trunc(s.label, maxLen - prefix.length);
  };

  let name, lines;
  if (style === 'detailed') {
    name = `${total} streams · ${found.length} found`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} — ${s.count}${res}`; } return `- ${l} — none`; });
  } else if (style === 'minimal') {
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?` (${s.resLabels[0]})`:''; return `${l}: ${s.count}${res}`; } return `${l}: —`; });
  } else if (style === 'bar') {
    name = `Results · ${total} streams`;
    const maxC = Math.max(...found.map(s=>s.count),1);
    lines = servers.map(s => { const l = eLabel(s,10); if (s.status==='found') { const f=Math.max(1,Math.round((s.count/maxC)*4)); return `${l} ${'█'.repeat(f)}${'░'.repeat(4-f)} ${s.count}`; } return `${l} ░░░░ x`; });
  } else {
    // compact (default)
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} · ${s.count}${res}`; } return `- ${l}`; });
  }

  const linesHtml = lines.map(l =>
    `<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;white-space:pre;font-family:monospace">${escHtml(l)}</div>`
  ).join('');

  el.innerHTML = `
    <div style="font-size:0.62rem;color:var(--text-muted);letter-spacing:0.07em;text-transform:uppercase;margin-bottom:0.45rem;font-weight:600">Preview</div>
    <div style="display:flex;gap:0;align-items:stretch;background:var(--bg-base);border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)">
      <div style="flex:0 0 38%;padding:0.5rem 0.6rem;border-right:1px solid var(--border);display:flex;align-items:center">
        <div style="font-size:0.76rem;font-weight:700;color:#d0c8ff;line-height:1.4">${escHtml(name)}</div>
      </div>
      <div style="flex:1;padding:0.45rem 0.6rem;display:flex;flex-direction:column;justify-content:center">${linesHtml}</div>
    </div>`;
}

// ── Performance mode ──────────────────────────────────────────────────────
function onModeChange() {
  const mode = document.querySelector('input[name="perf-mode"]:checked').value;
  document.getElementById('timeout-row').classList.toggle('visible', mode === 'timeout');
  updateMediaSourceStats();
  updateInstallStats();
}

function onShowPingChange() {
  const enabled = document.getElementById('show-ping').checked;
  const pd = document.getElementById('ping-detail');
  const item = document.getElementById('ping-detail-item');
  if (pd) {
    pd.disabled = !enabled;
    if (!enabled) pd.checked = false;
  }
  if (item) item.style.opacity = enabled ? '1' : '0.4';
  if (window.Controls) Controls.syncAll();  // reflect ping-detail enabled/disabled on its switch tile
  autoSave();
}

// ─── Audio ranking card ──────────────────────────────────────────────────────
let AUDIO_FORMATS = [];
let AUDIO_PRESETS = [];
const AUDIO_CAT_LABEL = { object: 'Object-Based', lossless: 'Lossless', lossy: 'Lossy', other: 'Other' };

// Set a seg-backed hidden-canonical <select> programmatically.
function setSegSelect(id, v) {
  const sel = document.getElementById(id);
  if (sel) sel.value = v;
  if (window.Controls) Controls.syncAll();
}

function setAudioRankToggle(v) { setSegSelect('audio-rank', v); updateRankingUX(); }
function setSurroundPriorityToggle(v) { setSegSelect('surround-priority', v); updateRankingUX(); }

const _TIEBREAKER_LABELS = { size: 'largest file', audio: 'best legacy audio', bitrate: 'highest bitrate' };

function updateRankingUX() {
  const audioOn = document.getElementById('audio-rank')?.value === 'on';
  const sort = document.getElementById('sort-order')?.value || 'size';
  const mode = document.getElementById('audio-rank-mode')?.value || 'audioFirst';
  const surroundOn = document.getElementById('surround-priority')?.value === 'on';

  const sortLabel = document.getElementById('sort-order-label');
  const sortHint = document.getElementById('sort-order-hint');
  const sortField = document.getElementById('sort-order-field');
  const sortSeg = document.getElementById('sort-order-seg');
  const flow = document.getElementById('ranking-flow-hint');
  const modeHint = document.getElementById('audio-rank-mode-hint');
  const surroundField = document.getElementById('surround-priority-field');
  const surroundHint = document.getElementById('surround-priority-hint');
  const surroundSel = document.getElementById('surround-priority');

  if (sortLabel) sortLabel.textContent = audioOn ? 'Tiebreaker' : 'Sort by';
  if (sortSeg) {
    sortSeg.querySelectorAll('[data-val]').forEach(btn => {
      btn.classList.toggle('rec', audioOn && btn.getAttribute('data-val') === 'size');
    });
  }
  const sortClash = audioOn && sort === 'audio';
  if (sortField) sortField.classList.toggle('clash', sortClash);
  if (sortHint) {
    sortHint.textContent = audioOn
      ? (sortClash
        ? 'Sort Audio overlaps with Audio ranking below — use Size as tiebreaker instead.'
        : `Breaks ties after audio is equal — ${_TIEBREAKER_LABELS[sort] || sort}.`)
      : 'Primary sort when audio ranking is off.';
  }

  if (modeHint) {
    const modeHints = {
      audioFirst: 'Best audio format wins, then tiebreaker above.',
      resFirst: '4K beats 1080p first, then audio format, then tiebreaker.',
      tiebreak: 'Sort/tiebreaker above decides; audio only breaks exact ties.',
    };
    modeHint.textContent = audioOn ? (modeHints[mode] || modeHints.audioFirst) : 'Turn on Audio ranking to use this.';
  }

  if (surroundField && surroundSel) {
    surroundField.classList.toggle('locked', !audioOn);
    if (!audioOn && surroundOn) setSurroundPriorityToggle('off');
  }
  if (surroundHint) {
    surroundHint.textContent = audioOn
      ? (surroundOn
        ? 'On: 5.1/7.1 default track beats stereo (helps Stremio CPM on Shield/TV).'
        : 'Off: format list alone decides — fine if you never see stereo FLAC issues.')
      : 'Requires Audio ranking — picks multichannel default tracks over stereo.';
  }

  if (flow) {
    flow.classList.remove('warn');
    if (!audioOn) {
      flow.textContent = sort === 'audio'
        ? '★ Winner: best per-track audio, then largest file.'
        : `★ Winner: ${_TIEBREAKER_LABELS[sort] || sort} — audio ranking is off.`;
    } else {
      const tie = _TIEBREAKER_LABELS[sort] || sort;
      const steps = [];
      if (surroundOn) steps.push('surround channels');
      if (mode === 'resFirst') steps.push('resolution', 'audio format', tie);
      else if (mode === 'tiebreak') steps.push(tie, 'audio format');
      else steps.push('audio format', tie);
      flow.textContent = `★ Winner: ${steps.join(' → ')}.`;
      if (sortClash) {
        flow.textContent += ' Sort Audio + Audio ranking may double-sort — switch tiebreaker to Size.';
        flow.classList.add('warn');
      }
    }
  }
  if (window.Controls) Controls.syncAll();
}

function wireRankingUX() {
  ['sort-order', 'audio-rank', 'audio-rank-mode', 'surround-priority'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._rankUx) {
      el._rankUx = 1;
      el.addEventListener('change', updateRankingUX);
    }
  });
  updateRankingUX();
}

async function initAudioCard() {
  try {
    const r = await fetch('/api/audio-formats');
    const data = await r.json();
    AUDIO_FORMATS = data.formats || [];
    AUDIO_PRESETS = data.presets || [];
  } catch { AUDIO_FORMATS = []; AUDIO_PRESETS = []; }
  renderAudioPresetChips();
  renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
}

function applyPresetStreamSettings(settings) {
  if (!settings) return;
  if (settings.surroundPriority) setSurroundPriorityToggle('on');
  if (settings.autoSelect === true) {
    const el = document.getElementById('auto-select');
    if (el) el.checked = true;
  } else if (settings.autoSelect === false) {
    const el = document.getElementById('auto-select');
    if (el) el.checked = false;
  }
  if (window.Controls) Controls.syncAll();
}

function tokenMeta(token) { return AUDIO_FORMATS.find(f => f.token === token) || null; }

function renderAudioRankList(orderTokens, disabledTokens) {
  const ol = document.getElementById('audio-rank-list');
  if (!ol) return;
  const disabled = new Set(disabledTokens || []);
  ol.innerHTML = '';
  let lastCat = null;
  (orderTokens || []).forEach(token => {
    const meta = tokenMeta(token);
    if (!meta) return;
    if (meta.cat !== lastCat) {
      const cat = document.createElement('li');
      cat.className = 'arl-cat';
      cat.textContent = AUDIO_CAT_LABEL[meta.cat] || '';
      ol.appendChild(cat);
      lastCat = meta.cat;
    }
    const li = document.createElement('li');
    li.className = 'audio-rank-row' + (disabled.has(token) ? ' disabled-fmt' : '');
    li.draggable = true;
    li.dataset.token = token;
    li.innerHTML =
      '<span class="arl-handle">⠿</span>' +
      '<span class="arl-label"></span>' +
      '<span class="arl-chans"></span>' +
      '<label style="margin-left:8px;display:inline-flex;align-items:center;gap:4px;font-size:.7rem"><input type="checkbox" class="arl-disable"> disable</label>';
    li.querySelector('.arl-label').textContent = meta.label;
    li.querySelector('.arl-chans').textContent = meta.chans;
    if (disabled.has(token)) li.querySelector('.arl-disable').checked = true;
    ol.appendChild(li);
  });
  wireAudioDrag(ol);
  ol.querySelectorAll('.arl-disable').forEach(cb => cb.addEventListener('change', e => {
    e.target.closest('.audio-rank-row').classList.toggle('disabled-fmt', e.target.checked);
  }));
}

function wireAudioDrag(ol) {
  let dragEl = null;
  ol.querySelectorAll('.audio-rank-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragEl = null; autoSave(); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      ol.insertBefore(dragEl, after ? row.nextSibling : row);
    });
    row.addEventListener('drop', e => { e.preventDefault(); autoSave(); });
  });
}

const _SOURCE_DEVICE_IDS = new Set(['shield', 'appletv', 'chromecast', 'firestick', 'browser', 'phone']);
const _PASSTHROUGH_SINK_IDS = new Set(['soundbar', 'sonos']);
const _PLAYBACK_CHAIN_IDS = new Set([..._SOURCE_DEVICE_IDS, ..._PASSTHROUGH_SINK_IDS, 'tv']);
const _EARC_FRIENDLY_ORDER = ['atmos','truehd','ddplus','dd','aac','other'];
const _SONOS_FRIENDLY_ORDER = ['atmos','truehd','ddplus','dts','dd','aac','other'];

function renderAudioPresetChips() {
  const comboWrap = document.getElementById('audio-combo-chips');
  const deviceWrap = document.getElementById('audio-preset-chips');
  if (!deviceWrap) return;
  if (comboWrap) {
    comboWrap.innerHTML = '';
    AUDIO_PRESETS.filter(p => p.kind === 'combo').forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-combo';
      chip.dataset.combo = p.id;
      chip.textContent = p.label;
      chip.title = p.note || 'One-tap playback chain';
      chip.addEventListener('click', () => applyComboPreset(p.id));
      comboWrap.appendChild(chip);
    });
  }
  deviceWrap.innerHTML = '';
  AUDIO_PRESETS.filter(p => p.supports).forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.preset = p.id;
    chip.textContent = p.label;
    if (p.note) chip.title = p.note;
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      clearComboHighlight();
      applyAudioPresets();
    });
    deviceWrap.appendChild(chip);
  });
}

function resolveSupportedFormatsClient(deviceIds) {
  const presets = deviceIds.map(id => AUDIO_PRESETS.find(p => p.id === id)).filter(p => p && p.supports);
  if (!presets.length) return [];
  const allIds = AUDIO_FORMATS.map(f => f.id);
  if (deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id))) {
    return allIds.filter(fmt => presets.every(p => p.supports.includes(fmt)));
  }
  const sources = deviceIds.filter(id => _SOURCE_DEVICE_IDS.has(id));
  if (sources.length > 0 && deviceIds.includes('tv') && sources.length === deviceIds.length - 1) {
    const sourcePresets = sources.map(id => AUDIO_PRESETS.find(p => p.id === id)).filter(p => p && p.supports);
    const best = sourcePresets.reduce((a, b) => (a.supports.length >= b.supports.length ? a : b));
    return allIds.filter(fmt => best.supports.includes(fmt));
  }
  return allIds.filter(fmt => presets.every(p => p.supports.includes(fmt)));
}

function resolveDisableActionClient(deviceIds) {
  if (deviceIds.length <= 1) return 'hide';
  const hasPassthroughSink = deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id));
  const sourceCount = deviceIds.filter(id => _SOURCE_DEVICE_IDS.has(id)).length;
  if (hasPassthroughSink) return 'hide';
  if (deviceIds.includes('tv') && sourceCount >= 1 && deviceIds.length === sourceCount + 1) return 'hide';
  if (sourceCount > 1) return 'bottom';
  return 'hide';
}

function buildChainHintClient(deviceIds, disabledIds) {
  if (!deviceIds.length) return '';
  const labels = deviceIds.map(id => (AUDIO_PRESETS.find(p => p.id === id) || {}).label || id);
  const chain = labels.join(' → ');
  if (!disabledIds.length) return `${chain}: all formats supported`;
  const names = disabledIds.map(id => (AUDIO_FORMATS.find(f => f.id === id) || {}).label || id).join(', ');
  return `${chain}: hides ${names}`;
}

function updateAudioChainHint(deviceIds, disabledIds) {
  const el = document.getElementById('audio-chain-hint');
  if (!el) return;
  el.textContent = deviceIds.length ? buildChainHintClient(deviceIds, disabledIds) : '';
}

function clearComboHighlight() {
  document.querySelectorAll('#audio-combo-chips .chip.on').forEach(c => c.classList.remove('on'));
}

function setDevicePresetChips(deviceIds) {
  document.querySelectorAll('#audio-preset-chips .chip').forEach(c => {
    c.classList.toggle('on', deviceIds.includes(c.dataset.preset));
  });
}

function selectedPresetIds() {
  return [...document.querySelectorAll('#audio-preset-chips .chip.on')].map(c => c.dataset.preset);
}

function resolvePresetClient(selectedIds) {
  const deviceIds = [];
  for (const id of selectedIds || []) {
    const p = AUDIO_PRESETS.find(x => x.id === id);
    if (!p) continue;
    if (p.kind === 'combo' && p.combo) p.combo.forEach(d => { if (!deviceIds.includes(d)) deviceIds.push(d); });
    else if (p.supports && !deviceIds.includes(id)) deviceIds.push(id);
  }
  if (deviceIds.length === 0) return null;
  const allIds = AUDIO_FORMATS.map(f => f.id);
  const supportedAll = resolveSupportedFormatsClient(deviceIds);
  const disabledIds = allIds.filter(fmt => !supportedAll.includes(fmt));
  let orderIds = [...supportedAll, ...disabledIds];

  let surroundPriority = false;
  let autoSelect;
  let suggestedOrder = null;
  for (const id of selectedIds || []) {
    const p = AUDIO_PRESETS.find(x => x.id === id);
    if (!p?.settings) continue;
    if (p.settings.surroundPriority) surroundPriority = true;
    if (p.settings.autoSelect !== undefined) autoSelect = p.settings.autoSelect;
    if (p.settings.suggestedOrder) suggestedOrder = p.settings.suggestedOrder;
  }
  const hasSource = deviceIds.some(id => _SOURCE_DEVICE_IDS.has(id));
  const hasPassthroughSink = deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id));
  const hasShield = deviceIds.includes('shield');
  const hasAppleTv = deviceIds.includes('appletv');
  const hasSoundbar = deviceIds.includes('soundbar');
  const hasSonos = deviceIds.includes('sonos');
  if (hasShield || hasAppleTv) surroundPriority = true;
  if (hasSource && hasSonos) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _SONOS_FRIENDLY_ORDER;
  } else if (hasSource && hasPassthroughSink) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _EARC_FRIENDLY_ORDER;
  } else if ((hasShield || hasAppleTv) && hasSoundbar) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _EARC_FRIENDLY_ORDER;
  }
  if (suggestedOrder) {
    const supportedSet = new Set(supportedAll);
    orderIds = [...suggestedOrder.filter(id => supportedSet.has(id)), ...disabledIds];
  }

  const toToken = id => (AUDIO_FORMATS.find(f => f.id === id) || {}).token;
  return {
    orderTokens: orderIds.map(toToken),
    disabledTokens: disabledIds.map(toToken),
    action: resolveDisableActionClient(deviceIds),
    deviceIds,
    settings: { surroundPriority, autoSelect, suggestedOrder },
  };
}

function applyComboPreset(comboId) {
  const combo = AUDIO_PRESETS.find(p => p.id === comboId);
  if (!combo || !combo.combo) return;
  document.querySelectorAll('#audio-combo-chips .chip').forEach(c => {
    c.classList.toggle('on', c.dataset.combo === comboId);
  });
  setDevicePresetChips(combo.combo);
  applyAudioPresets([comboId, ...combo.combo]);
}

// Mirror of server resolvePreset for instant UI feedback.
function applyAudioPresets(extraIds) {
  const ids = [...new Set([...(extraIds || []), ...selectedPresetIds()])];
  if (ids.length === 0) {
    renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
    updateAudioChainHint([], []);
    autoSave();
    return;
  }
  const resolved = resolvePresetClient(ids);
  if (!resolved) {
    renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
    updateAudioChainHint([], []);
    autoSave();
    return;
  }
  renderAudioRankList(resolved.orderTokens, resolved.disabledTokens);
  const disabledIds = AUDIO_FORMATS.filter(f => resolved.disabledTokens.includes(f.token)).map(f => f.id);
  updateAudioChainHint(resolved.deviceIds, disabledIds);
  setAudioRankToggle('on');
  const actionEl = document.getElementById('audio-disable-action');
  if (actionEl) actionEl.value = resolved.action;
  applyPresetStreamSettings(resolved.settings);
  autoSave();
}

// ── Generate links ────────────────────────────────────────────────────────
const LEGACY_INSTALL_WARN = 'Legacy encoded install URLs embed your config (including API keys) in the link. Use your personal /u/:token manifest instead.';

async function ensureTokenManifestUrl(config) {
  const save = await fetch('/api/user/config', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!save.ok) {
    const err = await save.json().catch(() => ({}));
    throw new Error(err.error || 'Could not save config to your account');
  }
  let cur = await fetch('/api/user/manifest', { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({}));
  if (!cur.url) {
    cur = await fetch('/api/user/manifest', { method: 'POST', credentials: 'same-origin' }).then(r => r.json()).catch(() => ({}));
  }
  if (!cur.url) throw new Error('Could not create your manifest link');
  return cur.url;
}

async function renderTokenInstallUI(config, mode) {
  const section = document.getElementById('result-section');
  if (!section) return;
  const auth = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
  const loggedIn = !!(auth && auth.enabled && auth.user);

  if (!loggedIn) {
    section.innerHTML = `<h2>Sign in to install</h2>
      <p class="install-note">Create an account or log in, then return here. Your install link will be a private <code>/u/&lt;token&gt;/manifest.json</code> URL — API keys stay encrypted on the server.</p>
      <p class="install-note legacy-warn">${escHtml(LEGACY_INSTALL_WARN)}</p>`;
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  try {
    const manifestUrl = await ensureTokenManifestUrl(config);
    const urlEl = document.getElementById('acct-url');
    if (urlEl) urlEl.value = manifestUrl;
    if (typeof updateInstallStats === 'function') updateInstallStats();
    const deepLink = manifestUrl.replace(/^https?:\/\//i, 'stremio://');
    section.innerHTML = `<h2>Ready to install${mode === 'timeout' ? ' — Fast Timeout' : ''}</h2>
      <p class="install-note">Use the Manifest URL above — it updates when you change settings. Keys never leave the server.</p>
      <div class="url-row"><input type="text" readonly value="${escHtml(manifestUrl)}" /><button class="btn-copy" data-url="${escHtml(manifestUrl)}" onclick="copySpecific(this)">Copy</button></div>
      <a class="btn-install" href="${escHtml(deepLink)}">Install in Stremio</a>
      <p class="install-note legacy-warn">${escHtml(LEGACY_INSTALL_WARN)}</p>`;
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    section.innerHTML = `<h2>Install link unavailable</h2><p class="install-note">${escHtml(err.message || 'Try again after saving your servers.')}</p>`;
    section.style.display = 'block';
  }
}

function renderLegacySplitInstall(rows) {
  const section = document.getElementById('result-section');
  if (!section) return;
  let html = '<h2>Split mode — legacy install only</h2>';
  html += `<p class="install-note legacy-warn">${escHtml(LEGACY_INSTALL_WARN)} Split mode still uses per-server encoded URLs until token-based split is supported.</p>`;
  html += '<p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 1rem;line-height:1.5">Each server is a separate addon. Prefer Normal mode with your personal manifest link when possible.</p>';
  rows.forEach((row, i) => {
    if (i > 0) html += '<hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">';
    html += `<div>
      <div style="font-size:0.7rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem">${escHtml(row.label)}</div>
      <div class="url-row"><input type="text" readonly value="${escHtml(row.manifestUrl)}" /><button class="btn-copy" data-url="${escHtml(row.manifestUrl)}" onclick="copySpecific(this)">Copy</button></div>
      <a class="btn-install" href="${escHtml(row.deepLink)}">Install "${escHtml(row.label)}" in Stremio</a>
    </div>`;
  });
  section.innerHTML = html;
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function generateLinks(opts = {}) {
  const silent = opts.silent === true;   // silent: rebuild config + meb-last-config for account auto-sync, no prompts/render/scroll
  hideError();
  const config = collectConfig(silent);
  if (!config) return;
  const noAuto = config.servers.filter(s => s.apiKey && !(s.username && s.password));
  if (noAuto.length && !silent) {
    const names = noAuto.map(s => s.label).join(', ');
    const verb = noAuto.length > 1 ? ' have' : ' has';
    const msg = `Heads up: ${names}${verb} an API key but no saved login.

Emby/Jellyfin tokens expire, and without a Username + Password the addon cannot auto-renew them — catalogs will go dead until you paste a fresh key by hand.

Tip: enter your Username + Password and click “Fetch API Key & User ID” so tokens refresh automatically.

Continue anyway?`;
    if (!confirm(msg)) return;
  }

  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const sortOrder = document.getElementById('sort-order').value;
  const excludeRes = [...document.querySelectorAll('.res-cb:checked')].map(cb => cb.value);
  const recommend = document.getElementById('show-recommend').checked;
  const showPing = document.getElementById('show-ping').checked;
  const pingDetail = document.getElementById('ping-detail').checked;
  const audioLang = document.getElementById('audio-lang').value;
  const prefCodec = document.getElementById('pref-codec').value;
  const codecMode = document.getElementById('codec-mode').value;
  const audioRank = document.getElementById('audio-rank').value === 'on';
  const audioOrder = [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token);
  const audioDisabled = [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')].map(cb => cb.closest('.audio-rank-row').dataset.token);
  const audioRankMode = document.getElementById('audio-rank-mode').value;
  const audioDisableAction = document.getElementById('audio-disable-action').value;
  const audioOrderChanged = audioOrder.length > 0 && audioOrder.join(',') !== AUDIO_FORMATS.map(f => f.token).join(',');
  const surroundPriority = document.getElementById('surround-priority')?.value === 'on';
  const maxBitrate = document.getElementById('max-bitrate').value;
  const autoSelect = document.getElementById('auto-select').checked;
  const labelPreset = document.getElementById('label-preset').value;
  const showSummary = document.getElementById('show-summary').checked;
  const summaryStyle = document.getElementById('summary-style').value;
  const qualityBadge = document.getElementById('quality-badge').value;
  const flagEmoji = document.getElementById('flag-emoji').value;
  const bitrateBar = document.getElementById('bitrate-bar').value;
  const subsStyle = document.getElementById('subs-style').value;
  const showCatalog = document.getElementById('show-catalog').checked;
  const catalogContent = document.getElementById('catalog-content').value;
  const rpdbKey         = document.getElementById('rpdb-key').value.trim();
  const traktClientId   = document.getElementById('trakt-client-id')?.value.trim() || '';
  const mdblistApiKey   = document.getElementById('mdblist-api-key')?.value.trim() || '';
  const tmdbApiKey      = document.getElementById('tmdb-api-key')?.value.trim() || '';
  const externalCatalogs = window.collectExternalCatalogs ? window.collectExternalCatalogs() : [];
  const { protocol, host } = window.location;
  const section = document.getElementById('result-section');

  if (!silent) {
    const s3 = document.getElementById('step-3');
    if (s3) { s3.className = 'step active'; }
    const s2 = document.getElementById('step-2');
    if (s2) s2.className = 'step done';
  }

  if (mode === 'split') {
    const rows = config.servers.map(server => {
      const sc = { servers: [server] };
      if (sortOrder !== 'size') sc.sortOrder = sortOrder;
      if (excludeRes.length > 0) sc.excludeRes = excludeRes;
      if (recommend) sc.recommend = true;
      if (showPing) sc.ping = true;
      if (pingDetail) sc.pingDetail = true;
      if (audioLang !== 'any') sc.audioLang = audioLang;
      if (maxBitrate) sc.maxBitrate = parseInt(maxBitrate, 10);
      if (prefCodec !== 'any') { sc.prefCodec = prefCodec; sc.codecMode = codecMode; }
      if (audioRank) sc.audioRank = true;
      if (audioRank && audioRankMode !== 'audioFirst') sc.audioRankMode = audioRankMode;
      if (audioOrderChanged) sc.audioOrder = audioOrder;
      if (audioDisabled.length) sc.audioDisabled = audioDisabled;
      if (audioDisabled.length && audioDisableAction !== 'hide') sc.audioDisableAction = audioDisableAction;
    if (surroundPriority) sc.surroundPriority = true;
    if (document.getElementById('failover-hide-down')?.checked) sc.failoverHideDown = true;
    if (labelPreset !== 'standard') sc.labelPreset = labelPreset;
      if (autoSelect) sc.autoSelect = true;
      if (showSummary) { sc.showSummary = true; if (summaryStyle !== 'compact') sc.summaryStyle = summaryStyle; }
      if (qualityBadge) sc.qualityBadge = qualityBadge;
      if (flagEmoji) sc.flagEmoji = flagEmoji;
      if (bitrateBar) sc.bitrateBar = bitrateBar;
      if (subsStyle !== 'full') sc.subsStyle = subsStyle;
      if (!showCatalog) sc.showCatalog = false;
      if (catalogContent !== 'recent') sc.catalogContent = catalogContent;
      const libraryRows = ['recent','resume','nextup','favorites'].filter(function(k){
        var el = document.getElementById('libchk-' + k); return el && el.checked;
      });
      sc.libraryRows = libraryRows;
      if (rpdbKey) sc.rpdbKey = rpdbKey;
      if (traktClientId) sc.traktClientId = traktClientId;
      if (tmdbApiKey) sc.tmdbApiKey = tmdbApiKey;
      if (externalCatalogs.length) { sc.externalCatalogs = externalCatalogs; if (mdblistApiKey) sc.mdblistApiKey = mdblistApiKey; }
      var _clVal = document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "";
      if (_clVal) sc.catalogLang = _clVal;
      const _ndVal = document.getElementById("no-dupes")?.checked;
      if (_ndVal) sc.noDupes = true;
      if (labelPreset === "custom") {
        sc.customNameFields = Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;});
        sc.customDescFields = Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;});
      }
      const encoded = encodeConfig(sc);
      return { label: server.label, manifestUrl: `${protocol}//${host}/${encoded}/manifest.json`, deepLink: `stremio://${host}/${encoded}/manifest.json` };
    });

    if (!silent) renderLegacySplitInstall(rows);
  } else {
    if (mode === 'timeout') config.timeout = parseInt(document.getElementById('timeout-value').value, 10);
    if (sortOrder !== 'size') config.sortOrder = sortOrder;
    if (excludeRes.length > 0) config.excludeRes = excludeRes;
    if (recommend) config.recommend = true;
    if (showPing) config.ping = true;
    if (pingDetail) config.pingDetail = true;
    if (audioLang !== 'any') config.audioLang = audioLang;
    if (maxBitrate) config.maxBitrate = parseInt(maxBitrate, 10);
    if (prefCodec !== 'any') { config.prefCodec = prefCodec; config.codecMode = codecMode; }
    if (audioRank) config.audioRank = true;
    if (audioRank && audioRankMode !== 'audioFirst') config.audioRankMode = audioRankMode;
    if (audioOrderChanged) config.audioOrder = audioOrder;
    if (audioDisabled.length) config.audioDisabled = audioDisabled;
    if (audioDisabled.length && audioDisableAction !== 'hide') config.audioDisableAction = audioDisableAction;
    if (surroundPriority) config.surroundPriority = true;
    if (document.getElementById('failover-hide-down')?.checked) config.failoverHideDown = true;
    if (labelPreset !== 'standard') config.labelPreset = labelPreset;
    if (autoSelect) config.autoSelect = true;
    if (showSummary) { config.showSummary = true; if (summaryStyle !== 'compact') config.summaryStyle = summaryStyle; }
    if (qualityBadge) config.qualityBadge = qualityBadge;
    if (flagEmoji) config.flagEmoji = flagEmoji;
    if (bitrateBar) config.bitrateBar = bitrateBar;
    if (subsStyle !== 'full') config.subsStyle = subsStyle;
    if (!showCatalog) config.showCatalog = false;
    if (catalogContent !== 'recent') config.catalogContent = catalogContent;
    const libraryRows2 = ['recent','resume','nextup','favorites'].filter(function(k){
      var el = document.getElementById('libchk-' + k); return el && el.checked;
    });
    config.libraryRows = libraryRows2;
    if (rpdbKey) config.rpdbKey = rpdbKey;
    if (traktClientId) config.traktClientId = traktClientId;
    if (tmdbApiKey) config.tmdbApiKey = tmdbApiKey;
    if (mdblistApiKey) config.mdblistApiKey = mdblistApiKey;   // save unconditionally (was gated behind externalCatalogs)
    if (externalCatalogs.length) config.externalCatalogs = externalCatalogs;
    var _clVal = document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "";
    if (_clVal) config.catalogLang = _clVal;
    const _ndVal2 = document.getElementById("no-dupes")?.checked;
    if (_ndVal2) config.noDupes = true;
    if (labelPreset === "custom") {
      config.customNameFields = Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;});
      config.customDescFields = Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;});
    }
    config.streamProfile = STREAM_PROFILE_VERSION;

    if (!silent) await renderTokenInstallUI(config, mode);
  }

  try {
    if (mode !== 'split') {
      const encoded = encodeConfig(config);
      localStorage.setItem(lsLastKey(), encoded);
    }
  } catch {}

  try {
    const healthServers = (config.servers || []).map(s => ({ url: s.url, label: s.label, type: s.type || 'emby' }));
    fetch('/api/health/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ servers: healthServers }) }).catch(() => {});
  } catch {}
}

// ── Copy ──────────────────────────────────────────────────────────────────
function copySpecific(btn) {
  const url = btn.dataset.url;
  function onSuccess() {
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onSuccess).catch(() => { fallbackCopy(url); onSuccess(); });
  } else { fallbackCopy(url); onSuccess(); }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
}

// ── Ping Test ─────────────────────────────────────────────────────────────
async function browserPing(url) {
  const t0 = Date.now();
  try {
    await fetch(`${url}/System/Ping`, { mode: 'no-cors', cache: 'no-store' });
    return Date.now() - t0;
  } catch { return null; }
}

async function runPingTest() {
  const resultsEl = document.getElementById('ping-results');
  const config = collectConfig(true);
  if (!config) {
    resultsEl.innerHTML = '<div style="color:var(--text-secondary);font-size:0.78rem;padding:0.2rem 0">Add and fill in at least one server first.</div>';
    return;
  }
  const origin = document.getElementById('ping-origin').value;
  const servers = config.servers;
  resultsEl.innerHTML = servers.map(s =>
    `<div class="ping-row"><span class="ping-label">${escHtml(s.label)}</span><span class="ping-value" style="color:var(--text-muted)">testing...</span></div>`
  ).join('');

  if (origin === 'browser') {
    await Promise.all(servers.map(async (s, i) => {
      const ms = await browserPing(s.url);
      const valEl = resultsEl.querySelectorAll('.ping-row')[i]?.querySelector('.ping-value');
      if (!valEl) return;
      if (ms === null) { valEl.textContent = 'timeout'; valEl.className = 'ping-value timeout'; }
      else { const cls = ms < 100 ? 'fast' : ms < 300 ? 'ok' : 'slow'; valEl.textContent = `${ms} ms`; valEl.className = `ping-value ${cls}`; }
    }));
  } else {
    try {
      const resp = await fetch('/api/ping-servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: servers.map(s => ({ url: s.url, label: s.label })) }),
      });
      const data = await resp.json();
      data.results.forEach((r, i) => {
        const valEl = resultsEl.querySelectorAll('.ping-row')[i]?.querySelector('.ping-value');
        if (!valEl) return;
        if (r.ms === null) { valEl.textContent = 'timeout'; valEl.className = 'ping-value timeout'; }
        else { const cls = r.ms < 100 ? 'fast' : r.ms < 300 ? 'ok' : 'slow'; valEl.textContent = `${r.ms} ms`; valEl.className = `ping-value ${cls}`; }
      });
    } catch {
      resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem;padding:0.2rem 0">Could not reach addon server.</div>';
    }
  }
}

// ── Auto-save ─────────────────────────────────────────────────────────────
let saveTimer = null;

function collectFormState() {
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const state = {
    streamProfile: STREAM_PROFILE_VERSION,
    mode,
    timeoutValue: document.getElementById('timeout-value')?.value,
    sortOrder: document.getElementById('sort-order')?.value,
    excludeRes: [...document.querySelectorAll('.res-cb:checked')].map(cb => cb.value),
    recommend: document.getElementById('show-recommend')?.checked,
    showPing: document.getElementById('show-ping')?.checked,
    pingDetail: document.getElementById('ping-detail')?.checked,
    audioLang: document.getElementById('audio-lang')?.value,
    prefCodec: document.getElementById('pref-codec')?.value,
    codecMode: document.getElementById('codec-mode')?.value,
    audioRank: document.getElementById('audio-rank')?.value === 'on',
    audioOrder: [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token),
    audioDisabled: [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')].map(cb => cb.closest('.audio-rank-row').dataset.token),
    audioRankMode: document.getElementById('audio-rank-mode')?.value,
    audioDisableAction: document.getElementById('audio-disable-action')?.value,
    surroundPriority: document.getElementById('surround-priority')?.value === 'on',
    audioPresets: [...document.querySelectorAll('#audio-preset-chips .chip.on')].map(c => c.dataset.preset),
    maxBitrate: document.getElementById('max-bitrate')?.value,
    autoSelect: document.getElementById('auto-select')?.checked,
    labelPreset: document.getElementById('label-preset')?.value,
    pingOrigin: document.getElementById('ping-origin')?.value,
    showSummary: document.getElementById('show-summary')?.checked,
    summaryStyle: document.getElementById('summary-style')?.value,
    qualityBadge: document.getElementById('quality-badge')?.value || '',
    flagEmoji: document.getElementById('flag-emoji')?.value || '',
    bitrateBar: document.getElementById('bitrate-bar')?.value || '',
    subsStyle: document.getElementById('subs-style')?.value || 'full',
    showCatalog: document.getElementById('show-catalog')?.checked ?? true,
    catalogContent: document.getElementById('catalog-content')?.value || 'recent',
    libraryRows: ['recent','resume','nextup','favorites'].filter(function(k){
      var el = document.getElementById('libchk-' + k); return el && el.checked;
    }),
    rpdbKey: document.getElementById('rpdb-key')?.value.trim() || '',
    traktClientId:    document.getElementById('trakt-client-id')?.value.trim() || '',
    mdblistApiKey:    document.getElementById('mdblist-api-key')?.value.trim() || '',
    tmdbApiKey:       document.getElementById('tmdb-api-key')?.value.trim() || '',
    externalCatalogs: window.collectExternalCatalogs ? window.collectExternalCatalogs() : [],
    catalogLang: document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "",
    noDupes: document.getElementById("no-dupes")?.checked ?? false,
    failoverHideDown: document.getElementById('failover-hide-down')?.checked ?? false,
    customNameFields: Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;}),
    customDescFields: Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;}),
    servers: [],
  };
  document.querySelectorAll('.server-block').forEach(block => {
    state.servers.push({
      label: block.querySelector('.f-label')?.value || '',
      type: block.querySelector('.f-type')?.value || 'emby',
      url: block.querySelector('.f-url')?.value || '',
      apiKey: block.querySelector('.f-apikey')?.value || '',
      userId: block.querySelector('.f-userid')?.value || '',
      username: block.querySelector('.f-username')?.value || '',
      password: block.querySelector('.f-password')?.value || '',
      thumbnail: block.querySelector('.f-thumbnail')?.value || '',
      emoji: block.querySelector('.f-emoji')?.value || '',
      enabled: block.querySelector('.f-enabled')?.checked ?? true,
      collapsed: block.classList.contains('collapsed'),
      cost: block.querySelector('.f-cost')?.value !== '' ? Number(block.querySelector('.f-cost')?.value) : undefined,
      costPeriod: block.querySelector('.f-cost-period')?.value || 'none',
      priority: parseInt(block.querySelector('.f-priority')?.value || '5', 10),
    });
  });
  return state;
}

function saveToLocalStorage() {
  try {
    const newState = collectFormState();
    // Preserve traktClientId/mdblistApiKey if input is currently empty but we have a saved value
    const existing = JSON.parse(localStorage.getItem(lsKey()) || '{}');
    if (!newState.traktClientId && existing.traktClientId) newState.traktClientId = existing.traktClientId;
    if (!newState.mdblistApiKey && existing.mdblistApiKey) newState.mdblistApiKey = existing.mdblistApiKey;
    if (!newState.tmdbApiKey && existing.tmdbApiKey) newState.tmdbApiKey = existing.tmdbApiKey;
    if (!newState.streamProfile && existing.streamProfile) newState.streamProfile = existing.streamProfile;
    localStorage.setItem(lsKey(), JSON.stringify(newState));
  } catch {}
  const ind = document.getElementById('autosave-indicator');
  if (ind) { ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(() => ind.classList.remove('visible'), 1800); }
}

const _AUTOSAVE_IGNORE = '#rlog-search,.rlog-search,#tkt-search,.tkt-search,#adm-search,#bill-code,#cmdk-input,.cmdk-input,[data-no-autosave]';
function autoSave(e) {
  if (e && e.target && e.target.closest && e.target.closest(_AUTOSAVE_IGNORE)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToLocalStorage();
    scheduleAccountConfigSync();
  }, 600);
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return false;
    const state = JSON.parse(raw);
    const profileUpgraded = upgradeStreamProfileState(state);
    // Fallback: recover traktClientId/mdblistApiKey/externalCatalogs from last generated config if missing
    try {
      const lastRaw = localStorage.getItem(lsLastKey());
      if (lastRaw) {
        const last = JSON.parse(atob(lastRaw.replace(/-/g,'+').replace(/_/g,'/')));
        if (!state.traktClientId && last.traktClientId) state.traktClientId = last.traktClientId;
        if (!state.mdblistApiKey && last.mdblistApiKey) state.mdblistApiKey = last.mdblistApiKey;
        if (!state.tmdbApiKey && last.tmdbApiKey) state.tmdbApiKey = last.tmdbApiKey;
        if ((!state.externalCatalogs || !state.externalCatalogs.length) && last.externalCatalogs && last.externalCatalogs.length)
          state.externalCatalogs = last.externalCatalogs;
      }
    } catch(e) {}

    if (state.servers && state.servers.length > 0) {
      document.getElementById('servers-container').innerHTML = '';
      nextId = 0;
      state.servers.forEach(s => {
        const id = nextId;
        addServer(s);
        const block = document.getElementById(`server-${id}`);
        if (!block) return;
        if (s.enabled === false) {
          block.querySelector('.f-enabled').checked = false;
          block.classList.add('disabled');
        }
        if (s.collapsed) {
          block.classList.add('collapsed');
          block.querySelector('.btn-collapse').textContent = '\u25B6';
          updateSummary(id);
        }
      });
    }

    if (state.mode) {
      const radio = document.querySelector(`input[name="perf-mode"][value="${state.mode}"]`);
      if (radio) { radio.checked = true; onModeChange(); }
    }

    const restored = { ...STREMIO_STREAM_DEFAULTS, ...state };
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = v; };
    setVal('timeout-value', restored.timeoutValue);
    setVal('sort-order', restored.sortOrder);
    setVal('audio-lang', restored.audioLang);
    setVal('pref-codec', restored.prefCodec);
    setVal('codec-mode', restored.codecMode);
    setAudioRankToggle(restored.audioRank ? 'on' : 'off');
    setVal('audio-rank-mode', restored.audioRankMode || 'audioFirst');
    setVal('audio-disable-action', restored.audioDisableAction || 'hide');
    setSurroundPriorityToggle(restored.surroundPriority ? 'on' : 'off');
    const _audioOrder = (restored.audioOrder && restored.audioOrder.length) ? restored.audioOrder : AUDIO_FORMATS.map(f => f.token);
    renderAudioRankList(_audioOrder, restored.audioDisabled || []);
    (restored.audioPresets || []).forEach(id => {
      const chip = document.querySelector('#audio-preset-chips .chip[data-preset="' + id + '"]');
      if (chip) chip.classList.add('on');
    });
    setVal('max-bitrate', restored.maxBitrate);
    setVal('label-preset', restored.labelPreset || 'compact');
    setVal('ping-origin', restored.pingOrigin);
    setChk('show-recommend', restored.recommend);
    setChk('failover-hide-down', restored.failoverHideDown);
    setChk('show-ping', restored.showPing);
    setChk('ping-detail', restored.pingDetail);
    setChk('auto-select', restored.autoSelect);
    setChk('show-summary', restored.showSummary);
    setVal('summary-style', restored.summaryStyle || 'compact');
    if (restored.showSummary) {
      const opts = document.getElementById('summary-options');
      if (opts) opts.style.display = 'flex';
      updateSummaryPreview();
    }
    setVal('quality-badge', state.qualityBadge);
    setVal('flag-emoji', state.flagEmoji);
    setVal('bitrate-bar', state.bitrateBar);
    setVal('subs-style', state.subsStyle);
    if (state.showCatalog === false) {
      setChk('show-catalog', false);
      if (window.toggleCatalogOptions) window.toggleCatalogOptions();
    }
    setVal('catalog-content', state.catalogContent);
    var savedRows = Array.isArray(state.libraryRows) ? state.libraryRows
                   : (state.catalogContent ? [state.catalogContent] : ['recent']);
    ['recent','resume','nextup','favorites'].forEach(function(k){
      var el = document.getElementById('libchk-' + k); if (el) el.checked = savedRows.indexOf(k) !== -1;
    });
    if (window.CatalogsWizard && window.CatalogsWizard.syncLibChips) window.CatalogsWizard.syncLibChips();
    if (window.Controls) Controls.syncAll();
    setVal('rpdb-key', state.rpdbKey);
    if (state.traktClientId) setVal('trakt-client-id', state.traktClientId);
    if (state.mdblistApiKey) setVal('mdblist-api-key', state.mdblistApiKey);
    if (state.tmdbApiKey) setVal('tmdb-api-key', state.tmdbApiKey);
    if (window.refreshKeyPills) window.refreshKeyPills();
    if (Array.isArray(state.externalCatalogs) && state.externalCatalogs.length) {
      const catList = document.getElementById('catalog-list');
      if (catList && window.addExternalCatalog) { catList.innerHTML = ''; window.nextCatId = 0; state.externalCatalogs.forEach(function(cat){ window.addExternalCatalog(cat, { autoTest: false }); }); }
    }

    if (state.catalogLang) setVal("catalog-lang", state.catalogLang);
    if (state.noDupes) { const cb = document.getElementById("no-dupes"); if (cb) cb.checked = true; }
    if (Array.isArray(state.customNameFields) && state.customNameFields.length) {
      document.querySelectorAll(".cn-field").forEach(function(cb){ cb.checked = state.customNameFields.indexOf(cb.value) >= 0; });
    }
    if (Array.isArray(state.customDescFields) && state.customDescFields.length) {
      document.querySelectorAll(".cd-field").forEach(function(cb){ cb.checked = state.customDescFields.indexOf(cb.value) >= 0; });
    }
    toggleCustomPreset();
    if (Array.isArray(state.excludeRes)) _applyExcludeRes(state.excludeRes);

    if (window.Controls) Controls.syncAll();
    updateRankingUX();
    if (profileUpgraded) {
      try { localStorage.setItem(lsKey(), JSON.stringify(state)); } catch {}
    }
    return true;
  } catch { return false; }
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('servers-container')) return; // shell not ready / page absent
  try {
    const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (me.ok) {
      const auth = await me.json().catch(() => null);
      if (auth?.user?.username) setActiveUsername(auth.user.username);
    }
  } catch { /* */ }
  await initAudioCard();   // populate AUDIO_FORMATS/PRESETS + render card before restore reads them
  if (!restoreFromLocalStorage()) addServer();
  await ensureAccountConfigLoaded();
  try {
    const ls = JSON.parse(localStorage.getItem(lsKey()) || '{}');
    if (ls.streamProfile === STREAM_PROFILE_VERSION && typeof generateLinks === 'function') {
      generateLinks({ silent: true }).catch(() => {});
    }
  } catch {}
  _updateServersEmptyState();
  if (_isServersPageActive()) {
    await renderServersPage({ full: true });
    _startServersAutoRefresh();
  }
  // TEMP scaffold: these page-init calls belong to Catalogs/Appearance/Streaming
  // pages not yet migrated; their target DOM is absent now, so guard each call.
  // Later tasks move them to fire on their page's onPageShow.
  [updateLabelPreview, toggleCustomPreset, onShowPingChange]
    .forEach(fn => { try { fn(); } catch (_) {} });
  if (window.toggleCatalogOptions) try { window.toggleCatalogOptions(); } catch {}
  document.addEventListener('input', autoSave);
  document.addEventListener('change', autoSave);
  const qi = document.getElementById('quick-install');
  if (qi) qi.addEventListener('click', () => { location.hash = '#/install'; generateLinks(); });
  if (window.Controls) Controls.bindAll();
  wireRankingUX();
});
