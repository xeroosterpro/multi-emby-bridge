// configure/debug.js — outbound API traffic (Debug tab only)
let _dbgTimer = null;

function _isDebugActive() {
  const sec = document.getElementById('page-debug');
  return !!(sec && sec.classList.contains('on'));
}

function _fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function _renderDebug(data) {
  const serversEl = document.getElementById('dbg-servers');
  const callsEl = document.getElementById('dbg-calls');
  const uaEl = document.getElementById('dbg-ua');
  if (!serversEl || !callsEl) return;

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
      <th>Time</th><th>Server</th><th>Path</th><th>Source</th><th>Status</th><th>ms</th>
    </tr></thead><tbody>${calls.map(c => `<tr class="${c.ok ? '' : 'dbg-err'}">
      <td>${escHtml(_fmtTime(c.ts))}</td>
      <td>${escHtml(c.label || c.host)}</td>
      <td class="dbg-path">${escHtml(c.path)}</td>
      <td><span class="dbg-badge ${c.cached ? 'cached' : 'live'}">${c.cached ? 'cache' : 'live'}</span></td>
      <td>${c.status != null ? c.status : '—'}</td>
      <td>${c.ms != null ? c.ms : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
  }

  if (uaEl) {
    const ttl = data.cacheTtlMs ? Math.round(data.cacheTtlMs / 1000) : 45;
    uaEl.textContent = `UA: ${data.ua || '—'} · cache TTL ${ttl}s`;
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