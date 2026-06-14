// configure/account-bootstrap.js — auth, account config sync, server cred merge
function invalidateAccountConfigCache() {
  _accountConfigPromise = null;
  _accountServersCache = null;
}

function _useAccountCredsForApi() {
  return !!(window.currentUser && window.accountsEnabled);
}

function _serverApiBody(server) {
  const body = {
    url: server.url,
    type: server.type || 'emby',
    label: server.label || '',
  };
  if (server.apiKey) body.apiKey = server.apiKey;
  if (server.userId) body.userId = server.userId;
  if (server.username) body.username = server.username;
  if (server.password) body.password = server.password;
  return body;
}
function _mergeAccountCredsIntoServers(servers) {
  if (!_useAccountCredsForApi() || !_accountServersCache?.length) return servers || [];
  const byLabel = new Map((_accountServersCache || []).map(s =>
    [String(s.label || '').trim().toLowerCase(), s]
  ));
  const byUrl = new Map((_accountServersCache || []).map(s => [_normServerUrl(s.url), s]));
  return (servers || []).map(s => {
    const acc = byLabel.get(String(s.label || '').trim().toLowerCase())
      || byUrl.get(_normServerUrl(s.url));
    if (!acc) return s;
    return {
      ...acc,
      ...s,
      label: s.label || acc.label,
      url: s.url || acc.url,
      apiKey: s.apiKey || acc.apiKey,
      userId: s.userId || acc.userId,
      username: s.username || acc.username,
      password: s.password || acc.password,
      type: s.type || acc.type,
    };
  });
}

function _collectDashboardServers() {
  const accountByUrl = new Map((_accountServersCache || []).map(s => [_normServerUrl(s.url), s]));
  const accountByLabel = new Map((_accountServersCache || []).map(s =>
    [String(s.label || '').trim().toLowerCase(), s]
  ));
  const blocks = document.querySelectorAll('.server-block');
  const servers = [];
  for (const block of blocks) {
    if (!block.querySelector('.f-enabled')?.checked) continue;
    const label = block.querySelector('.f-label')?.value.trim();
    const type = block.querySelector('.f-type')?.value || 'emby';
    const url = block.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
    if (!label || !url) continue;
    const acc = accountByUrl.get(_normServerUrl(url))
      || accountByLabel.get(String(label || '').trim().toLowerCase());
    const apiKey = block.querySelector('.f-apikey')?.value.trim() || acc?.apiKey || '';
    const userId = block.querySelector('.f-userid')?.value.trim() || acc?.userId || '';
    const username = block.querySelector('.f-username')?.value.trim() || acc?.username || '';
    const password = block.querySelector('.f-password')?.value || acc?.password || '';
    if (!_useAccountCredsForApi() && (!apiKey || !userId)) continue;
    const entry = { label, type, url, apiKey, userId };
    if (username && password) { entry.username = username; entry.password = password; }
    const thumbnail = block.querySelector('.f-thumbnail')?.value.trim() || '';
    const emoji = block.querySelector('.f-emoji')?.value.trim() || '';
    if (thumbnail) entry.thumbnail = thumbnail;
    if (emoji) entry.emoji = emoji;
    const costRaw = block.querySelector('.f-cost')?.value.trim() || '';
    const costPeriod = block.querySelector('.f-cost-period')?.value || 'none';
    const cost = costRaw === '' ? NaN : Number(costRaw);
    if (!Number.isNaN(cost) && cost > 0 && costPeriod !== 'none') { entry.cost = cost; entry.costPeriod = costPeriod; }
    const pri = parseInt(block.querySelector('.f-priority')?.value || '5', 10);
    if (pri >= 1 && pri <= 10 && pri !== 5) entry.priority = pri;
    servers.push(entry);
  }
  if (!servers.length && _useAccountCredsForApi() && _accountServersCache?.length) {
    return _accountServersCache
      .filter(s => s.enabled !== false && s.url && s.label && (s.apiKey || s.userId))
      .map(s => ({ ...s, url: String(s.url).replace(/\/+$/, '') }));
  }
  return servers;
}

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
    const merged = { ...s };
    const loc = localByUrl.get(_normServerUrl(s.url));
    if (!loc) return merged;
    if (loc.apiKey && !merged.apiKey) merged.apiKey = loc.apiKey;
    if (loc.userId && !merged.userId) merged.userId = loc.userId;
    if (loc.username && loc.password && (!merged.username || !merged.password)) {
      merged.username = loc.username;
      merged.password = loc.password;
    }
    return merged;
  });
}

function _accountCredsDifferFromDom(accountServers) {
  const byUrl = new Map((accountServers || []).map(s => [_normServerUrl(s.url), s]));
  return [...document.querySelectorAll('.server-block')].some(block => {
    const acc = byUrl.get(_normServerUrl(block.querySelector('.f-url')?.value.trim()));
    if (!acc?.apiKey) return false;
    const domKey = block.querySelector('.f-apikey')?.value.trim() || '';
    const domId = block.querySelector('.f-userid')?.value.trim() || '';
    return domKey !== acc.apiKey || (acc.userId && domId !== acc.userId);
  });
}

function _applyCredsToDomBlocks(servers, opts = {}) {
  const forceAccount = opts.forceAccount === true;
  const byUrl = new Map((servers || []).map(s => [_normServerUrl(s.url), s]));
  let dirty = false;
  document.querySelectorAll('.server-block').forEach(block => {
    const url = block.querySelector('.f-url')?.value.trim();
    const acc = byUrl.get(_normServerUrl(url));
    if (!acc) return;
    const keyEl = block.querySelector('.f-apikey');
    const idEl = block.querySelector('.f-userid');
    const uEl = block.querySelector('.f-username');
    const pEl = block.querySelector('.f-password');
    if (keyEl && acc.apiKey && (forceAccount || !keyEl.value.trim()) && keyEl.value.trim() !== acc.apiKey) {
      keyEl.value = acc.apiKey;
      dirty = true;
    }
    if (idEl && acc.userId && (forceAccount || !idEl.value.trim()) && idEl.value.trim() !== acc.userId) {
      idEl.value = acc.userId;
      dirty = true;
    }
    if (uEl && acc.username && !uEl.value.trim()) uEl.value = acc.username;
    if (pEl && acc.password && !pEl.value) pEl.value = acc.password;
  });
  if (dirty) saveToLocalStorage();
}

let _accountSyncTimer = null;

// ─── Shared auth + early bootstrap (dedupes repeated /api/auth/me and common calls) ──
// All modules should prefer window.MEB_getAuth() over direct fetch for /api/auth/me.
// This + parallel initial fetches dramatically reduces the burst of duplicate roundtrips
// on first load while still fetching everything fresh (no data loss).
let _authPromise = null;
function getAuth() {
  if (!_authPromise) {
    _authPromise = fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json().catch(() => ({ user: null, enabled: false })) : ({ user: null, enabled: false }))
      .then(d => {
        window.currentUser = d?.user || null;
        window.accountsEnabled = !!d?.enabled;
        return d;
      })
      .catch(() => {
        window.currentUser = null;
        window.accountsEnabled = false;
        return { user: null, enabled: false };
      });
  }
  return _authPromise;
}

// Kick off a few common non-critical fetches in parallel early (they resolve when needed).
// Modules can await these or do their own (still safe).
const _bootAuth = getAuth();
const _bootSite = fetch('/api/site-config', { credentials: 'same-origin' }).then(r => r.ok ? r.json().catch(() => null) : null).catch(() => null);
const _bootServerInfo = fetch('/api/server-info', { credentials: 'same-origin' }).then(r => r.ok ? r.json().catch(() => null) : null).catch(() => null);

function scheduleAccountConfigSync() {
  clearTimeout(_accountSyncTimer);
  _accountSyncTimer = setTimeout(async () => {
    try {
      const auth = await getAuth();
      if (!auth?.enabled || !auth?.user) return;
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
      invalidateAccountConfigCache();
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
      const auth = await getAuth();
      if (!auth?.enabled || !auth?.user) return null;
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
      const credsDrift = _accountCredsDifferFromDom(accountServers);
      if (!hadLocal || !domHasEnabledServers() || accountServers.length > domServers.length || profileUpgraded || credsDrift) {
        populateFromConfig(cfg);
        applyManifestSettings(cfg);
        saveToLocalStorage();
        if (profileUpgraded && typeof generateLinks === 'function') {
          try { await generateLinks({ silent: true }); } catch {}
        }
      } else {
        _applyCredsToDomBlocks(accountServers, { forceAccount: true });
      }
      _accountServersCache = accountServers;
      return cfg;
    } catch {
      return null;
    }
  })();
  return _accountConfigPromise;
}

function _normServerUrl(u) { return (u || '').replace(/\/+$/, '').toLowerCase(); }

window.MEB_getAuth = getAuth;
window.scheduleAccountConfigSync = scheduleAccountConfigSync;
window.invalidateAccountConfigCache = invalidateAccountConfigCache;
