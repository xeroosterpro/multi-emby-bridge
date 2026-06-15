// configure/debug.js — outbound API traffic (Debug tab only)
let _dbgTimer = null;

const _CAT_LABELS = {
  stream: 'Stremio playback',
  health: 'Configure UI checks',
  auth: 'Token renewal',
  session: 'Live sessions (off)',
  activity: 'Watch history (off)',
  other: 'Other',
};

function _isDebugActive() {
  const sec = document.getElementById('page-debug');
  return !!(sec && sec.classList.contains('on'));
}

function _fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _catClass(cat, essential) {
  if (cat === 'stream' || essential) return 'dbg-cat-stream';
  if (cat === 'activity' || cat === 'session') return 'dbg-cat-noise';
  return 'dbg-cat-opt';
}

function _sourceBadge(source, cached) {
  const src = source || (cached ? 'cache-L1' : 'live');
  const isCache = String(src).startsWith('cache');
  const cls = isCache ? 'cached' : 'live';
  return `<span class="dbg-badge ${cls}">${escHtml(src)}</span>`;
}

function _renderIdentity(id) {
  const el = document.getElementById('dbg-identity');
  if (!el) return;
  if (!id) {
    el.innerHTML = '<p class="dbg-empty">No identity data.</p>';
    return;
  }
  const lines = (id.sampleHeaders || []).map(h => escHtml(h)).join('<br>');
  el.innerHTML = `<div class="dbg-identity-box">
    <div><strong>Device ID</strong> <code>${escHtml(id.deviceId || '—')}</code></div>
    <div><strong>Client</strong> ${escHtml(id.client || '—')} · v${escHtml(id.clientVersion || '—')}</div>
    <div class="dbg-identity-headers">${lines}</div>
  </div>`;
}

function _renderCacheTiers(tiers) {
  const el = document.getElementById('dbg-cache-tiers');
  if (!el) return;
  if (!tiers) {
    el.innerHTML = '<p class="dbg-empty">No cache data.</p>';
    return;
  }
  const labels = {
    L1: 'HTTP responses',
    L2: 'Title lookups',
    L3: 'Stream lists',
    manifest: 'Manifest',
  };
  el.innerHTML = Object.entries(tiers).map(([k, v]) => {
    const ttlMin = v.ttlMs ? Math.round(v.ttlMs / 60000) : 60;
    return `<div class="dbg-cat-card dbg-cat-stream">
      <div class="dbg-cat-name">${escHtml(labels[k] || k)}</div>
      <div class="dbg-cat-stats">${v.hits || 0} hits · ${v.size || 0} stored · ${ttlMin}m TTL</div>
    </div>`;
  }).join('');
}

function _renderPacing(p) {
  const el = document.getElementById('dbg-pacing');
  if (!el) return;
  if (!p) {
    el.innerHTML = '<p class="dbg-empty">No pacing data.</p>';
    return;
  }
  el.innerHTML = `<div class="dbg-pacing-grid">
    <div class="dbg-pacing-stat"><span class="dbg-pacing-n">${p.scheduled || 0}</span><span class="dbg-pacing-l">Scheduled</span></div>
    <div class="dbg-pacing-stat"><span class="dbg-pacing-n">${p.coalesced || 0}</span><span class="dbg-pacing-l">Coalesced</span></div>
    <div class="dbg-pacing-stat"><span class="dbg-pacing-n">${p.dropped || 0}</span><span class="dbg-pacing-l">Dropped</span></div>
    <div class="dbg-pacing-stat"><span class="dbg-pacing-n">${p.avgDelayMs || 0}ms</span><span class="dbg-pacing-l">Avg delay</span></div>
    <div class="dbg-pacing-stat"><span class="dbg-pacing-n">${p.paceMs || 300}ms</span><span class="dbg-pacing-l">Min gap</span></div>
  </div>`;
}

function _renderCategories(cats) {
  const el = document.getElementById('dbg-categories');
  if (!el) return;
  if (!cats || !cats.length) {
    el.innerHTML = '<p class="dbg-empty">No calls recorded yet.</p>';
    return;
  }
  el.innerHTML = cats.map(c => {
    const label = _CAT_LABELS[c.category] || c.category;
    const cls = _catClass(c.category, c.category === 'stream');
    return `<div class="dbg-cat-card ${cls}">
      <div class="dbg-cat-name">${escHtml(label)}</div>
      <div class="dbg-cat-stats">${c.count || 0} total · ${c.cached || 0} cached · ${c.network || 0} live${c.errors ? ` · ${c.errors} err` : ''}</div>
    </div>`;
  }).join('');
}

function _renderDebug(data) {
  const serversEl = document.getElementById('dbg-servers');
  const callsEl = document.getElementById('dbg-calls');
  const uaEl = document.getElementById('dbg-ua');
  if (!serversEl || !callsEl) return;

  _renderIdentity(data.clientIdentity);
  _renderCacheTiers(data.cacheTiers);
  _renderPacing(data.pacing);
  _renderCategories(data.byCategory || []);

  const rows = data.byServer || [];
  if (!rows.length) {
    serversEl.innerHTML = '<p class="dbg-empty">No outbound calls yet — test a server or play a stream.</p>';
  } else {
    serversEl.innerHTML = `<table class="dbg-table"><thead><tr>
      <th>Server</th><th>Total</th><th>Cached</th><th>Network</th><th>Errors</th>
    </tr></thead><tbody>${rows.map(r => `<tr>
      <td>${escHtml(r.label || r.host)}</td>
      <td>${r.total || 0}</td>
      <td>${r.cached || 0}</td>
      <td>${r.network || 0}</td>
      <td>${r.errors || 0}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  const calls = data.calls || [];
  if (!calls.length) {
    callsEl.innerHTML = '<p class="dbg-empty">Waiting for API calls…</p>';
  } else {
    callsEl.innerHTML = `<table class="dbg-table dbg-table-calls"><thead><tr>
      <th>Time</th><th>Purpose</th><th>Server</th><th>Path</th><th>Source</th><th>Status</th><th>ms</th>
    </tr></thead><tbody>${calls.map(c => `<tr class="${c.ok ? '' : 'dbg-err'}">
      <td>${escHtml(_fmtTime(c.ts))}</td>
      <td><span class="dbg-cat-badge ${_catClass(c.category, c.essential)}">${escHtml(c.purpose || '—')}</span></td>
      <td>${escHtml(c.label || c.host)}</td>
      <td class="dbg-path" title="${escHtml(c.query || '')}">${escHtml(c.path)}</td>
      <td>${_sourceBadge(c.source, c.cached)}</td>
      <td>${c.status != null ? c.status : '—'}</td>
      <td>${c.ms != null ? c.ms : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  if (uaEl) {
    const ttlMin = data.cacheTtlMs ? Math.round(data.cacheTtlMs / 60000) : 60;
    const origin = window.location.origin || '';
    uaEl.innerHTML = `Shield emulation active · All caches ${ttlMin}m TTL · <a href="${escHtml(origin)}/configure">${escHtml(origin.replace(/^https?:\/\//, ''))}</a>`;
  }
}

async function refreshDebugTraffic() {
  if (!_isDebugActive()) return;
  try {
    const resp = await fetch('/api/debug/traffic', { credentials: 'same-origin' });
    if (!resp.ok) return;
    _renderDebug(await resp.json());
  } catch { /* silent */ }
}

function _startDebugPoll() {
  _stopDebugPoll();
  refreshDebugTraffic();
  _dbgTimer = setInterval(refreshDebugTraffic, 3000);
}

function _stopDebugPoll() {
  if (_dbgTimer) { clearInterval(_dbgTimer); _dbgTimer = null; }
}

async function clearDebugTraffic() {
  if (!confirm('Clear API traffic log?')) return;
  try {
    await fetch('/api/debug/traffic/clear', { method: 'POST', credentials: 'same-origin' });
    await refreshDebugTraffic();
  } catch { /* silent */ }
}

window.refreshDebugTraffic = refreshDebugTraffic;
window.clearDebugTraffic = clearDebugTraffic;
window._startDebugPoll = _startDebugPoll;
window._stopDebugPoll = _stopDebugPoll;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) _stopDebugPoll();
  else if (_isDebugActive()) _startDebugPoll();
});