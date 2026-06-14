// configure/servers-page.js (logos in state.js)

function updateSteps() {
  const hasServers = document.querySelectorAll('.server-block').length > 0;
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  const s3 = document.getElementById('step-3');
  if (!s1) return;
  s1.className = hasServers ? 'step done' : 'step active';
  s2.className = hasServers ? 'step active' : 'step';
}
window.updateSteps = updateSteps;

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
  if (!opts.force && !_isServersPageActive()) return;
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
    apiKey: b.querySelector('.f-apikey')?.value.trim(),
    userId: b.querySelector('.f-userid')?.value.trim(),
  })).filter(s => s.url && s.label && s.apiKey && s.userId);
  await _registerHealthServers(healthServers);
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

function addServer(data = null, opts = {}) {
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
  if (!opts.skipRefresh) {
    refreshServerCard(block).then(() => renderServersPage());
  }
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
