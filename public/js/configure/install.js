// configure/install.js
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
  invalidateAccountConfigCache();
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



function updateInstallStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const url = document.getElementById('acct-url')?.value?.trim();
  set('inst-stat-link', url ? 'Ready' : 'Pending');
  let count = 0;
  try {
    const cfg = collectConfig(true);
    count = cfg?.servers?.length || 0;
  } catch {}
  set('inst-stat-servers', count);
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  set('inst-stat-mode', { normal: 'Normal', split: 'Split', timeout: 'Fast' }[mode] || mode);
  const hasUrl = !!url;
  ['acct-install', 'acct-copy'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.authLocked === '1') return;
    btn.disabled = !hasUrl;
  });
}

async function loadInstallPage() {
  await ensureAccountConfigLoaded();
  const config = collectConfig(true);
  if (config) {
    try { await generateLinks({ silent: true }); } catch {}
  }
  try {
    const auth = await getAuth();
    if (auth?.enabled && auth?.user) {
      const urlEl = document.getElementById('acct-url');
      let url = urlEl?.value?.trim() || '';
      if (!url) {
        const cur = await fetch('/api/user/manifest', { credentials: 'same-origin' })
          .then(r => r.json()).catch(() => ({}));
        url = cur.url || '';
      }
      if (!url && config) {
        try { url = await ensureTokenManifestUrl(config); } catch {}
      }
      if (url && urlEl) urlEl.value = url;
    }
  } catch {}
  updateInstallStats();
}

window.generateLinks = generateLinks;
window.copySpecific = copySpecific;
window.runPingTest = runPingTest;
window.updateInstallStats = updateInstallStats;
window.loadInstallPage = loadInstallPage;
