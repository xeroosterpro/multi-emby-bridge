// configure/install.js
// ── Generate links ────────────────────────────────────────────────────────
const LEGACY_INSTALL_WARN = 'Legacy encoded install URLs embed your config (including API keys) in the link. Use your personal /u/:token manifest instead.';

function minimalManifestConfig() {
  const cfg = buildStreamConfig(true);
  if (cfg) return cfg;
  return { servers: [], streamProfile: typeof STREAM_PROFILE_VERSION !== 'undefined' ? STREAM_PROFILE_VERSION : 3 };
}

async function ensureTokenManifestUrl(config) {
  const payload = config || minimalManifestConfig();
  if (hasCompleteServers(payload.servers)) {
    const save = await fetch('/api/user/config', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!save.ok) {
      const err = await save.json().catch(() => ({}));
      throw new Error(err.error || 'Could not save config to your account');
    }
    invalidateAccountConfigCache();
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
    const serverCount = (config?.servers || []).length;
    const serverWarn = serverCount === 0
      ? '<p class="install-note" style="color:var(--warning,#e6a700)">No servers configured yet — Stremio will install, but streams will be empty until you add servers on the Servers tab and revisit Install.</p>'
      : '';
    section.innerHTML = `<h2>Ready to install${mode === 'timeout' ? ' — Fast Timeout' : ''}</h2>
      ${serverWarn}
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

function buildStreamConfig(silent = false) {
  const config = collectConfig(silent);
  if (!config) return null;
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const sortOrder = document.getElementById('sort-order')?.value || 'size';
  const excludeRes = [...document.querySelectorAll('.res-cb:checked')].map(cb => cb.value);
  const recommend = document.getElementById('show-recommend')?.checked;
  const showPing = document.getElementById('show-ping')?.checked;
  const pingDetail = document.getElementById('ping-detail')?.checked;
  const audioLang = document.getElementById('audio-lang')?.value || 'any';
  const prefCodec = document.getElementById('pref-codec')?.value || 'any';
  const codecMode = document.getElementById('codec-mode')?.value || 'prefer';
  const audioRank = document.getElementById('audio-rank')?.value === 'on';
  const audioOrder = [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token);
  const audioDisabled = [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')].map(cb => cb.closest('.audio-rank-row').dataset.token);
  const audioRankMode = document.getElementById('audio-rank-mode')?.value || 'audioFirst';
  const audioDisableAction = document.getElementById('audio-disable-action')?.value || 'hide';
  const audioOrderChanged = audioOrder.length > 0 && audioOrder.join(',') !== AUDIO_FORMATS.map(f => f.token).join(',');
  const surroundPriority = document.getElementById('surround-priority')?.value === 'on';
  const maxBitrate = document.getElementById('max-bitrate')?.value || '';
  const autoSelect = document.getElementById('auto-select')?.checked;
  const labelPreset = document.getElementById('label-preset')?.value || 'standard';
  const showSummary = document.getElementById('show-summary')?.checked;
  const summaryStyle = document.getElementById('summary-style')?.value || 'compact';
  const qualityBadge = document.getElementById('quality-badge')?.value || '';
  const flagEmoji = document.getElementById('flag-emoji')?.value || '';
  const bitrateBar = document.getElementById('bitrate-bar')?.value || '';
  const subsStyle = document.getElementById('subs-style')?.value || 'full';

  if (mode === 'timeout') config.timeout = parseInt(document.getElementById('timeout-value')?.value || '5000', 10);
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
  config.showCatalog = false;
  if (labelPreset === 'custom') {
    config.customNameFields = Array.from(document.querySelectorAll('.cn-field:checked')).map(cb => cb.value);
    config.customDescFields = Array.from(document.querySelectorAll('.cd-field:checked')).map(cb => cb.value);
  }
  config.streamProfile = STREAM_PROFILE_VERSION;
  return config;
}

function buildSplitServerConfig(server) {
  const config = buildStreamConfig(true);
  if (!config) return null;
  const sc = { servers: [server] };
  const copyKeys = [
    'sortOrder', 'excludeRes', 'recommend', 'ping', 'pingDetail', 'audioLang', 'maxBitrate',
    'prefCodec', 'codecMode', 'audioRank', 'audioRankMode', 'audioOrder', 'audioDisabled',
    'audioDisableAction', 'surroundPriority', 'failoverHideDown', 'labelPreset', 'autoSelect',
    'showSummary', 'summaryStyle', 'qualityBadge', 'flagEmoji', 'bitrateBar', 'subsStyle',
    'showCatalog', 'customNameFields', 'customDescFields', 'timeout', 'streamProfile',
  ];
  copyKeys.forEach(k => { if (config[k] !== undefined) sc[k] = config[k]; });
  return sc;
}

async function generateLinks(opts = {}) {
  const silent = opts.silent === true;
  hideError();
  const config = buildStreamConfig(silent);
  if (!config) return;
  const noAuto = config.servers.filter(s => s.apiKey && !(s.username && s.password));
  if (noAuto.length && !silent) {
    const names = noAuto.map(s => s.label).join(', ');
    const verb = noAuto.length > 1 ? ' have' : ' has';
    const msg = `Heads up: ${names}${verb} an API key but no saved login.

Emby/Jellyfin tokens expire, and without a Username + Password the addon cannot auto-renew them — streams will stop working until you paste a fresh key by hand.

Tip: enter your Username + Password and click “Fetch API Key & User ID” so tokens refresh automatically.

Continue anyway?`;
    if (!confirm(msg)) return;
  }

  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const { protocol, host } = window.location;

  if (mode === 'split') {
    const rows = config.servers.map(server => {
      const sc = buildSplitServerConfig(server);
      const encoded = encodeConfig(sc);
      return { label: server.label, manifestUrl: `${protocol}//${host}/${encoded}/manifest.json`, deepLink: `stremio://${host}/${encoded}/manifest.json` };
    });
    if (!silent) renderLegacySplitInstall(rows);
  } else if (!silent) {
    await renderTokenInstallUI(config, mode);
  }

  try {
    if (mode !== 'split') {
      localStorage.setItem(lsLastKey(), encodeConfig(config));
    }
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
  try {
    const auth = await getAuth();
    if (auth?.enabled && auth?.user) {
      const config = buildStreamConfig(true) || minimalManifestConfig();
      const url = await ensureTokenManifestUrl(config);
      const urlEl = document.getElementById('acct-url');
      if (urlEl) urlEl.value = url;
      try { await generateLinks({ silent: true }); } catch {}
    }
  } catch (err) {
    const section = document.getElementById('result-section');
    if (section) {
      section.innerHTML = `<h2>Install link unavailable</h2><p class="install-note">${escHtml(err.message || 'Sign in and try again.')}</p>`;
      section.style.display = 'block';
    }
  }
  updateInstallStats();
}

window.buildStreamConfig = buildStreamConfig;
window.generateLinks = generateLinks;
window.copySpecific = copySpecific;
window.runPingTest = runPingTest;
window.updateInstallStats = updateInstallStats;
window.loadInstallPage = loadInstallPage;
