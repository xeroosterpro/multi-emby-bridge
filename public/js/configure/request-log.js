// configure/request-log.js
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
    // Hydrate badge count instantly from session cache for returning users (speeds perceived load on log page).
    // We always do the real fetch below so data is never stale or missing.
    try {
      const cached = sessionStorage.getItem('meb_log_count_cache');
      if (cached) {
        const badge = document.getElementById('log-count-badge');
        if (badge && !badge.textContent.trim().includes('entries')) {
          badge.textContent = `${cached} entries (recent)`;
        }
      }
    } catch {}

    const resp = await fetch('/api/request-log', { credentials: 'same-origin' });
    if (!resp.ok) { logData = []; renderLogPage(); return; }
    const data = await resp.json();
    const badge = document.getElementById('log-count-badge');
    if (badge) badge.textContent = data.length ? `${data.length} entries · stream resolution history` : 'Stream resolution history';
    try { if (data && data.length) sessionStorage.setItem('meb_log_count_cache', String(data.length)); } catch {}
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

let logInterval = null;

// Defer the very first request-log fetch a little so it doesn't contend with the critical
// first-paint data (auth, user config, home services, etc.). We still always fetch the full
// data (no missing history) — just not in the initial waterfall burst.
// The visibility handler below already pauses/resumes intelligently.
setTimeout(() => {
  refreshLog();
  if (!logInterval) logInterval = setInterval(refreshLog, 30000);
}, 80);

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


window.refreshLog = refreshLog;
window.clearLog = clearLog;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(logInterval);
    logInterval = null;
    if (typeof _stopServersAutoRefresh === 'function') _stopServersAutoRefresh();
  } else {
    refreshLog();
    logInterval = setInterval(refreshLog, 30000);
    if (typeof _isServersPageActive === 'function' && _isServersPageActive()) {
      if (typeof renderServersPage === 'function') renderServersPage({ failedOnly: true });
      if (typeof _startServersAutoRefresh === 'function') _startServersAutoRefresh();
    }
  }
});
