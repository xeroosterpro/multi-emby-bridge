// ─── Admin Data Center UI v3 ─────────────────────────────────────────────────
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const CHART_COLORS = [
    { key: 'total', label: 'Total', color: 'var(--accent)' },
    { key: 'found', label: 'Found', color: '#22c55e' },
    { key: 'failed', label: 'Failed', color: '#ef4444' },
    { key: 'ok', label: 'OK', color: '#22c55e' },
    { key: 'fail', label: 'Fail', color: '#ef4444' },
    { key: 'checks', label: 'Checks', color: '#60a5fa' },
    { key: 'up_checks', label: 'Up', color: '#22c55e' },
  ];

  function esc(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    return { status: r.status, body: await r.json().catch(() => null) };
  }

  let _tab = 'overview';
  let _pollTimer = null;
  let _liveTimer = null;
  let _statusTimer = null;
  let _cache = {};
  let _meta = null;
  let _activityRange = '7d';
  let _serverFilter = { q: '', status: 'all', type: 'all', sort: 'label', dedupe: false };
  let _detailSubTab = 'system';

  function fmtUptime(ms) {
    if (ms == null) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch { return '—'; }
  }

  function fmtMoney(n, cur) {
    if (n == null) return '—';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n); }
    catch { return '$' + n; }
  }

  function chartLegend(keys) {
    return `<div class="adc-legend">${keys.map(k => {
      const c = CHART_COLORS.find(x => x.key === k) || { label: k, color: 'var(--accent)' };
      return `<span class="adc-legend-item"><i style="background:${c.color}"></i>${esc(c.label)}</span>`;
    }).join('')}</div>`;
  }

  function renderAreaChart(el, series, keys, opts) {
    if (!el) return;
    if (!series?.length) { el.innerHTML = '<div class="adc-empty">No data yet</div>'; return; }
    const W = opts?.width || 600, H = opts?.height || 140, p = 16;
    const max = Math.max(1, ...series.map(s => Math.max(...keys.map(k => s[k] || 0))));
    const step = (W - p * 2) / Math.max(1, series.length - 1);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="adc-chart" preserveAspectRatio="none">`;
    keys.forEach((key, ki) => {
      const color = (CHART_COLORS.find(c => c.key === key) || {}).color || ['var(--accent)', '#60a5fa', '#f59e0b'][ki % 3];
      const coords = series.map((s, i) => {
        const v = s[key] || 0;
        const x = p + i * step;
        const y = H - p - (v / max) * (H - p * 2);
        return { x, y };
      });
      if (opts?.filled && ki === 0) {
        const area = coords.map(c => `${c.x},${c.y}`).join(' ');
        const base = `${coords[coords.length - 1].x},${H - p} ${coords.map(c => `${c.x},${c.y}`).join(' ')} ${coords[0].x},${H - p}`;
        svg += `<defs><linearGradient id="adcFill${ki}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient></defs>`;
        svg += `<polygon points="${base}" fill="url(#adcFill${ki})"/>`;
      }
      const line = coords.map(c => `${c.x},${c.y}`).join(' ');
      svg += `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`;
    });
    svg += '</svg>';
    el.innerHTML = chartLegend(keys) + svg;
  }

  function renderSpark(el, vals, color, opts) {
    if (!el || !vals?.length) return;
    const pts = vals.filter(v => v != null);
    if (pts.length < 2) { el.innerHTML = ''; return; }
    const W = opts?.width || 200, H = opts?.height || 48, p = 4;
    const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
    const coords = pts.map((v, i) => ({
      x: p + (i / (pts.length - 1)) * (W - p * 2),
      y: p + (1 - (v - mn) / rng) * (H - p * 2),
    }));
    const line = coords.map(c => `${c.x},${c.y}`).join(' ');
    const fill = `${coords[coords.length - 1].x},${H} ${line} ${coords[0].x},${H}`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="adc-spark">
      <polygon points="${fill}" fill="${color}" opacity="0.12"/>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  function renderDonut(el, segments) {
    if (!el) return;
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    let offset = 0;
    const stops = segments.map(seg => {
      const pct = (seg.value / total) * 100;
      const start = offset;
      offset += pct;
      return `${seg.color} ${start}% ${offset}%`;
    }).join(', ');
    el.innerHTML = `
      <div class="adc-donut" style="background:conic-gradient(${stops})">
        <div class="adc-donut-in">
          <div class="adc-donut-n">${esc(total)}</div>
          <div class="adc-donut-l">total</div>
        </div>
      </div>
      <div class="adc-donut-legend">${segments.map(s =>
        `<span><i style="background:${s.color}"></i>${esc(s.label)} <strong>${s.value}</strong></span>`
      ).join('')}</div>`;
  }

  function setGauge(el, val, label) {
    if (!el) return;
    const v = Math.min(100, Math.max(0, Number(val) || 0));
    el.style.setProperty('--v', v);
    const gv = el.querySelector('.gv');
    const gl = el.querySelector('.gl');
    if (gv) gv.textContent = Math.round(v) + '%';
    if (gl && label) gl.textContent = label;
  }

  function setKpis(data) {
    const el = $('#adc-kpis');
    if (!el || !data) return;
    const biz = data.business || {};
    const tiles = [
      { l: 'Servers', n: `${data.upCount ?? '—'}/${data.serverCount ?? '—'} up`, tone: data.downCount ? 'warn' : 'ok' },
      { l: 'Users', n: biz.users?.active ?? data.platform?.users ?? '—' },
      { l: 'Active 24h', n: biz.activeUsers24h ?? '—' },
      { l: 'Revenue 30d', n: fmtMoney(biz.revenue?.monthly, biz.revenue?.currency) },
      { l: 'Requests 24h', n: data.platform?.requests24h },
      { l: 'Success %', n: data.platform?.successRate != null ? data.platform.successRate + '%' : '—', tone: data.platform?.successRate < 80 ? 'warn' : '' },
      { l: 'Avg ms', n: data.platform?.avgResponseMs },
      { l: 'Re-auth 24h', n: `${data.tokenEvents?.ok24h || 0} ok / ${data.tokenEvents?.fail24h || 0} fail`, tone: data.tokenEvents?.fail24h ? 'bad' : '' },
      { l: 'Down now', n: data.downCount, tone: data.downCount ? 'bad' : 'ok' },
      { l: 'Open tickets', n: biz.tickets?.open ?? 0, tone: biz.tickets?.open ? 'warn' : '' },
      { l: 'Renewals 7d', n: biz.upcomingRenewals ?? 0 },
      { l: 'Token cache', n: data.tokenCacheCount },
    ];
    el.innerHTML = tiles.map(t =>
      `<div class="adc-kpi${t.tone ? ' adc-kpi-' + t.tone : ''}">
        <div class="adc-kpi-n">${esc(t.n ?? '—')}</div>
        <div class="adc-kpi-l">${esc(t.l)}</div>
      </div>`
    ).join('');
  }

  function renderMetaBar(meta, badges) {
    const el = $('#adc-meta-bar');
    if (!el) return;
    const m = meta || _meta || {};
    const b = badges || {};
    const dbOk = m.database;
    const probing = m.refreshInFlight;
    el.innerHTML = `
      <div class="adc-meta-chip ${dbOk ? 'adc-meta-ok' : 'adc-meta-warn'}">
        <span class="adc-meta-k">Database</span><span>${dbOk ? 'connected' : 'offline'}</span>
      </div>
      <div class="adc-meta-chip">
        <span class="adc-meta-k">Last probe</span><span>${m.lastSnapshotAt ? fmtDate(m.lastSnapshotAt) : 'pending'}</span>
      </div>
      <div class="adc-meta-chip">
        <span class="adc-meta-k">Snapshots</span><span>${m.rowCounts?.snapshots ?? '—'}</span>
      </div>
      <div class="adc-meta-chip">
        <span class="adc-meta-k">Scheduler</span><span>${probing ? 'probing…' : 'idle'}</span>
      </div>
      <div class="adc-meta-chip">
        <span class="adc-meta-k">Cache</span><span>${Math.round((m.scheduler?.cacheTtlMs || 30000) / 1000)}s TTL</span>
      </div>
      ${b.alerts ? `<div class="adc-meta-chip adc-meta-warn"><span class="adc-meta-k">Alerts</span><span>${b.alerts}</span></div>` : ''}`;
  }

  function updateTabBadges(badges) {
    const ov = _cache.overview || {};
    const b = badges || {};
    const live = b.live ?? _cache.live?.count ?? 0;
    const fail = b.tokenFail24h ?? (ov.tokenEvents?.fail24h || 0);
    const down = b.down ?? (ov.downCount || 0);
    const map = { servers: down, tokens: fail, live };
    $$('.adc-tab').forEach(tab => {
      const badge = tab.querySelector('.adc-tab-badge');
      const n = map[tab.dataset.tab];
      if (badge) {
        badge.textContent = n > 0 ? n : '';
        badge.hidden = !(n > 0);
      }
    });
  }

  function renderOverview() {
    const panel = $('#adc-panel-overview');
    const d = _cache.overview;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div><div class="adc-skel"></div>'; return; }
    const biz = d.business || {};
    const alerts = (d.alerts || []).map(a =>
      `<div class="adc-alert adc-alert-${a.level === 'error' ? 'error' : a.level === 'warn' ? 'warn' : 'info'}" data-goto="${esc(a.tab)}">
        <span class="adc-alert-icon">${a.level === 'error' ? '⚠' : a.level === 'warn' ? '◆' : 'ℹ'}</span>${esc(a.text)}
      </div>`
    ).join('') || '<div class="adc-empty adc-empty-sm">All clear — no active alerts</div>';
    panel.innerHTML = `
      <div class="adc-grid-3">
        <div class="adc-card adc-card-accent">
          <div class="adc-card-head"><span class="adc-card-title">Fleet health</span></div>
          <div id="adc-overview-donut" class="adc-donut-wrap"></div>
        </div>
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Alerts</span><span class="adc-card-meta">${(d.alerts || []).length} active</span></div>
          <div class="adc-alerts">${alerts}</div>
        </div>
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Platform pulse</span></div>
          <div class="adc-stat-grid">
            <div class="adc-stat"><span class="adc-stat-n">${esc(biz.revenue?.lifetime != null ? fmtMoney(biz.revenue.lifetime, biz.revenue.currency) : '—')}</span><span class="adc-stat-l">Lifetime revenue</span></div>
            <div class="adc-stat"><span class="adc-stat-n">${esc(biz.users?.admins ?? '—')}</span><span class="adc-stat-l">Admins</span></div>
            <div class="adc-stat"><span class="adc-stat-n">${esc(biz.users?.comped ?? '—')}</span><span class="adc-stat-l">Comped</span></div>
            <div class="adc-stat"><span class="adc-stat-n">${esc(d.liveSessions ?? 0)}</span><span class="adc-stat-l">Live sessions</span></div>
            <div class="adc-stat"><span class="adc-stat-n">${esc(biz.failedPayments ?? 0)}</span><span class="adc-stat-l">Failed payments</span></div>
            <div class="adc-stat"><span class="adc-stat-n">${esc(d.snapshotCount ?? 0)}</span><span class="adc-stat-l">Snapshots</span></div>
          </div>
          <p class="adc-card-foot">Last probe cycle: <strong>${esc(d.snapshotAt ? fmtDate(d.snapshotAt) : 'pending')}</strong></p>
        </div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Bridge activity (7d)</span></div>
          <div id="adc-overview-chart"></div>
        </div>
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Recent lookups</span><span class="adc-card-meta">live feed</span></div>
          <div class="adc-feed">${(_cache.recentActivity || []).slice(0, 12).map(a => `
            <div class="adc-feed-row">
              <span class="adc-feed-title">${esc(a.title || '—')}</span>
              <span class="adc-feed-meta">${esc(a.username || '—')} · ${esc(a.server || '—')}</span>
              <span class="adc-pill ${a.found ? 'adc-pill-up' : 'adc-pill-down'}">${a.found ? 'found' : 'miss'}</span>
              <span class="adc-feed-time">${fmtDate(a.ts)}</span>
            </div>`).join('') || '<div class="adc-empty adc-empty-sm">No recent activity</div>'}</div>
        </div>
      </div>`;
    renderDonut($('#adc-overview-donut'), [
      { label: 'Up', value: d.upCount || 0, color: '#22c55e' },
      { label: 'Down', value: d.downCount || 0, color: '#ef4444' },
      { label: 'Unknown', value: Math.max(0, (d.serverCount || 0) - (d.upCount || 0) - (d.downCount || 0)), color: '#64748b' },
    ]);
    if (_cache.activity?.requests) renderAreaChart($('#adc-overview-chart'), _cache.activity.requests, ['total', 'found', 'failed'], { filled: true });
    panel.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => switchTab(el.dataset.goto));
    });
  }

  function filterServers(rows) {
    const f = _serverFilter;
    let out = [...rows];
    if (f.q) {
      const ql = f.q.toLowerCase();
      out = out.filter(s => [s.label, s.url, s.ownerUsername, s.type, s.version].some(x => String(x || '').toLowerCase().includes(ql)));
    }
    if (f.status === 'up') out = out.filter(s => s.up === true);
    else if (f.status === 'down') out = out.filter(s => s.up === false);
    else if (f.status === 'unknown') out = out.filter(s => s.up == null);
    if (f.type !== 'all') out = out.filter(s => (s.type || 'emby') === f.type);
    if (f.dedupe) {
      const seen = new Map();
      out.forEach(s => { if (!seen.has(s.url)) seen.set(s.url, s); });
      out = [...seen.values()];
    }
    const sortKey = f.sort;
    out.sort((a, b) => {
      if (sortKey === 'ping') return (a.pingMs ?? 99999) - (b.pingMs ?? 99999);
      if (sortKey === 'uptime') return (b.uptimePct ?? -1) - (a.uptimePct ?? -1);
      if (sortKey === 'sessions') return (b.sessions || 0) - (a.sessions || 0);
      if (sortKey === 'requests') return (b.requests7d || 0) - (a.requests7d || 0);
      return String(a.label || a.url).localeCompare(String(b.label || b.url));
    });
    return out;
  }

  function renderServers() {
    const panel = $('#adc-panel-servers');
    const rows = _cache.servers || [];
    if (!panel) return;
    if (!_cache.servers) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const filtered = filterServers(rows);
    panel.innerHTML = `
      <div class="adc-card">
        <div class="adc-card-head">
          <span class="adc-card-title">${filtered.length} of ${rows.length} servers</span>
          <button type="button" class="btn-soft" id="adc-export-servers">Export CSV</button>
        </div>
        <div class="adc-toolbar">
          <input type="search" class="adc-search" id="adc-server-search" placeholder="Search label, URL, owner…" value="${esc(_serverFilter.q)}" />
          <select class="adc-select" id="adc-server-status">
            <option value="all">All status</option>
            <option value="up">Up only</option>
            <option value="down">Down only</option>
            <option value="unknown">Unknown</option>
          </select>
          <select class="adc-select" id="adc-server-type">
            <option value="all">All types</option>
            <option value="emby">Emby</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
          <select class="adc-select" id="adc-server-sort">
            <option value="label">Sort: label</option>
            <option value="ping">Sort: ping</option>
            <option value="uptime">Sort: uptime</option>
            <option value="sessions">Sort: sessions</option>
            <option value="requests">Sort: requests 7d</option>
          </select>
          <label class="adc-check"><input type="checkbox" id="adc-server-dedupe" ${_serverFilter.dedupe ? 'checked' : ''}/> Dedupe by URL</label>
        </div>
        <div class="adc-table-wrap">
          <table class="adc-table" id="adc-servers-table">
            <thead><tr>
              <th>Status</th><th>Label</th><th>Owner</th><th>Type</th><th>Ping</th>
              <th>Probes</th><th>Library</th><th>Uptime</th><th>Trend</th><th>Sessions</th><th>Token TTL</th><th>Req 7d</th>
            </tr></thead>
            <tbody>${filtered.map(s => {
              const st = s.up === false ? 'down' : s.up ? 'up' : 'warn';
              const pill = st === 'up' ? 'adc-pill-up">UP' : st === 'down' ? 'adc-pill-down">DOWN' : 'adc-pill-warn">?';
              const lib = s.movies != null ? `${s.movies}m · ${s.shows}s` : '—';
              const ttlCls = s.tokenTtlMs != null && s.tokenTtlMs < 3600000 ? ' adc-ttl-warn' : '';
              const probeCls = s.probeScore >= 90 ? 'good' : s.probeScore >= 70 ? 'mid' : 'bad';
              return `<tr data-key="${esc(s.key)}">
                <td><span class="adc-pill ${pill}</span></td>
                <td><strong>${esc(s.label || s.url)}</strong>${s.version ? `<div class="adc-row-sub">v${esc(s.version)}</div>` : ''}</td>
                <td>${esc(s.ownerUsername)}</td>
                <td><span class="adc-type-pill">${esc(s.type)}</span></td>
                <td>${s.pingMs != null ? s.pingMs + 'ms' : '—'}</td>
                <td>${s.probeScore != null ? `<span class="adc-probe-score adc-probe-score-${probeCls}">${s.probeScore}%</span><div class="adc-row-sub">${s.probeOk || 0}/${(s.probeOk || 0) + (s.probeFail || 0)}</div>` : '—'}</td>
                <td>${esc(lib)}</td>
                <td>${s.uptimePct != null ? `<span class="adc-uptime adc-uptime-${s.uptimePct >= 95 ? 'good' : s.uptimePct >= 80 ? 'mid' : 'bad'}">${s.uptimePct}%</span>` : '—'}</td>
                <td><div class="adc-row-spark" data-spark="${esc(JSON.stringify(s.sparkHistory || []))}"></div></td>
                <td>${esc(s.sessions || 0)}${s.sessionMethod ? ' <span class="adc-row-sub">' + esc(s.sessionMethod) + '</span>' : ''}</td>
                <td class="${ttlCls}">${s.tokenTtlMs != null ? fmtUptime(s.tokenTtlMs) : '—'}</td>
                <td>${esc(s.requests7d || 0)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
    panel.querySelectorAll('.adc-row-spark').forEach(el => {
      try {
        const vals = JSON.parse(el.dataset.spark || '[]');
        renderSpark(el, vals, vals.length && vals[vals.length - 1] ? '#22c55e' : '#ef4444', { width: 72, height: 28 });
      } catch { /* */ }
    });
    $('#adc-server-search')?.addEventListener('input', e => { _serverFilter.q = e.target.value; renderServers(); });
    $('#adc-server-status') && ($('#adc-server-status').value = _serverFilter.status);
    $('#adc-server-status')?.addEventListener('change', e => { _serverFilter.status = e.target.value; renderServers(); });
    $('#adc-server-type') && ($('#adc-server-type').value = _serverFilter.type);
    $('#adc-server-type')?.addEventListener('change', e => { _serverFilter.type = e.target.value; renderServers(); });
    $('#adc-server-sort') && ($('#adc-server-sort').value = _serverFilter.sort);
    $('#adc-server-sort')?.addEventListener('change', e => { _serverFilter.sort = e.target.value; renderServers(); });
    $('#adc-server-dedupe')?.addEventListener('change', e => { _serverFilter.dedupe = e.target.checked; renderServers(); });
    panel.querySelectorAll('#adc-servers-table tbody tr').forEach(tr => {
      tr.addEventListener('click', () => openServerDetail(tr.dataset.key));
    });
    $('#adc-export-servers')?.addEventListener('click', () => exportCsv('servers', filtered));
  }

  function probeSummary(name, p) {
    if (!p) return { ok: false, text: 'not probed' };
    const ok = p.ok !== false && (p.ok === true || p.data != null);
    if (!ok) return { ok: false, text: p.error || 'failed' };
    const d = p.data;
    if (name === 'ping') return { ok: true, text: `${d.ms}ms` };
    if (name === 'systemInfo') return { ok: true, text: `${d.serverName || '—'} · ${d.version || '—'} · ${d.operatingSystem || '—'}` };
    if (name === 'libraryCounts') return { ok: true, text: `${d.movies} movies · ${d.shows} shows · ${d.episodes} eps` };
    if (name === 'userProfile') return { ok: true, text: `${d.name} · last active ${fmtDate(d.lastActivityDate)}` };
    if (name === 'views') return { ok: true, text: `${d.count} views: ${(d.names || []).join(', ')}` };
    if (name === 'latest') return { ok: true, text: (d || []).map(i => i.name).join(', ') || '—' };
    if (name === 'resume') return { ok: true, text: `${d.count} items: ${(d.items || []).join(', ')}` };
    if (name === 'favorites') return { ok: true, text: `${d.count} favorites` };
    if (name === 'playedItems') return { ok: true, text: (d || []).slice(0, 3).map(i => i.name).join(', ') };
    if (name === 'itemsSearch') return { ok: true, text: `${d.totalRecordCount} matches · sample: ${(d.sample || []).map(i => i.name).join(', ')}` };
    if (name === 'scheduledTasks') return { ok: true, text: `${d.count} tasks · ${d.running} running` };
    if (name === 'sessions') return { ok: true, text: `${d.count} sessions via ${d.method || '—'}` };
    if (name === 'playbackSample') return { ok: true, text: `${d.sampleTitle}: ${d.container} ${d.video ? d.video.codec + ' ' + d.video.width + 'x' + d.video.height : ''}` };
    return { ok: true, text: JSON.stringify(d).slice(0, 180) };
  }

  const DETAIL_GROUPS = {
    system: ['ping', 'systemInfo', 'scheduledTasks', 'userProfile'],
    library: ['libraryCounts', 'views', 'latest', 'resume', 'favorites', 'playedItems', 'itemsSearch'],
    live: ['sessions', 'playbackSample'],
    token: [],
  };

  async function openServerDetail(key) {
    const detail = $('#adc-detail');
    const body = $('#adc-detail-body');
    const title = $('#adc-detail-title');
    if (!detail || !body) return;
    _detailSubTab = 'system';
    detail.hidden = false;
    body.innerHTML = '<div class="adc-skel"></div>';
    document.addEventListener('keydown', onDetailEsc);
    const r = await api('/api/admin/intel/servers/' + encodeURIComponent(key));
    if (r.status !== 200 || !r.body) { body.innerHTML = '<div class="adc-empty">Failed to load</div>'; return; }
    _cache._detail = r.body;
    renderServerDetail();
    if (title) title.textContent = r.body.entry?.label || r.body.entry?.url || 'Server';
  }

  function onDetailEsc(e) {
    if (e.key === 'Escape') {
      const d = $('#adc-detail');
      if (d && !d.hidden) { d.hidden = true; document.removeEventListener('keydown', onDetailEsc); }
    }
  }

  function renderServerDetail() {
    const body = $('#adc-detail-body');
    const { entry, payload, history } = _cache._detail || {};
    if (!body || !payload) return;
    const probes = payload.probes || {};
    const token = payload.token || {};
    const tabs = ['system', 'library', 'live', 'token'];
    const ps = _cache._detail.probeSummary || {};
    body.innerHTML = `
      <div class="adc-detail-actions">
        <button type="button" class="btn-soft btn-xs" id="adc-detail-refresh">↻ Re-probe server</button>
        ${ps.scorePct != null ? `<span class="adc-probe-score adc-probe-score-${ps.scorePct >= 90 ? 'good' : ps.scorePct >= 70 ? 'mid' : 'bad'}">Probe score ${ps.scorePct}%</span>` : ''}
      </div>
      <div class="adc-detail-meta">
        <span>${esc(entry.url)}</span>
        <span>${esc(entry.ownerUsername)}</span>
        <span>${esc(entry.type)}</span>
        <span>Probed ${fmtDate(payload.probedAt)}</span>
        ${_cache._detail.health?.uptimePct != null ? `<span>Uptime ${esc(_cache._detail.health.uptimePct)}%</span>` : ''}
      </div>
      <div class="adc-detail-kpis">
        <div class="adc-mini-kpi"><span class="adc-mini-n">${payload.up ? 'UP' : 'DOWN'}</span><span>Status</span></div>
        <div class="adc-mini-kpi"><span class="adc-mini-n">${probes.ping?.data?.ms != null ? probes.ping.data.ms + 'ms' : '—'}</span><span>Ping</span></div>
        <div class="adc-mini-kpi"><span class="adc-mini-n">${probes.libraryCounts?.data?.movies ?? '—'}</span><span>Movies</span></div>
        <div class="adc-mini-kpi"><span class="adc-mini-n">${probes.sessions?.data?.count ?? 0}</span><span>Sessions</span></div>
      </div>
      <div class="adc-grid-2 adc-detail-charts">
        <div><div class="adc-card-title">Uptime (7d)</div><div id="adc-detail-spark" class="adc-detail-spark"></div></div>
        <div><div class="adc-card-title">Ping (7d)</div><div id="adc-detail-ping" class="adc-detail-spark"></div></div>
      </div>
      <div class="adc-subtabs" role="tablist">
        ${tabs.map(t => `<button type="button" class="adc-subtab${_detailSubTab === t ? ' on' : ''}" data-sub="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <div id="adc-detail-content"></div>`;
    const histVals = (history || []).map(h => h.up ? 1 : 0);
    renderSpark($('#adc-detail-spark'), histVals, histVals.length && histVals[histVals.length - 1] ? '#22c55e' : '#ef4444', { width: 280, height: 56 });
    const pingVals = (_cache._detail.pingSeries || []).map(p => p.ms);
    renderSpark($('#adc-detail-ping'), pingVals, '#60a5fa', { width: 280, height: 56 });
    $('#adc-detail-refresh')?.addEventListener('click', async () => {
      const btn = $('#adc-detail-refresh');
      if (btn) { btn.disabled = true; btn.textContent = 'Probing…'; }
      const key = _cache._detail?.entry?.key;
      if (key) {
        const r = await api('/api/admin/intel/servers/' + encodeURIComponent(key) + '/refresh', { method: 'POST' });
        if (r.status === 200 && r.body) {
          _cache._detail = {
            entry: r.body.entry,
            payload: r.body.payload,
            history: _cache._detail.history,
            pingSeries: _cache._detail.pingSeries,
            health: _cache._detail.health,
            probeSummary: r.body.probeSummary,
          };
          _cache.servers = null;
          renderServerDetail();
        }
      }
      if (btn) { btn.disabled = false; btn.textContent = '↻ Re-probe server'; }
    });
    body.querySelectorAll('.adc-subtab').forEach(btn => {
      btn.addEventListener('click', () => { _detailSubTab = btn.dataset.sub; renderServerDetail(); });
    });
    const content = $('#adc-detail-content');
    if (_detailSubTab === 'token') {
      content.innerHTML = `<div class="adc-card"><div class="adc-probe-grid">
        <div class="adc-probe adc-probe-ok"><div class="adc-probe-name">Cached token</div><div class="adc-probe-val">${token.hasCachedToken ? 'Yes' : 'No'}</div></div>
        <div class="adc-probe ${token.hasReauthCredentials ? 'adc-probe-ok' : 'adc-probe-fail'}"><div class="adc-probe-name">Re-auth credentials</div><div class="adc-probe-val">${token.hasReauthCredentials ? 'Saved' : 'Missing'}</div></div>
        <div class="adc-probe adc-probe-ok"><div class="adc-probe-name">TTL remaining</div><div class="adc-probe-val">${token.ttlRemainingMs != null ? fmtUptime(token.ttlRemainingMs) : '—'}</div></div>
        <div class="adc-probe adc-probe-ok"><div class="adc-probe-name">Cache age</div><div class="adc-probe-val">${token.cacheAgeMs != null ? fmtUptime(token.cacheAgeMs) : '—'}</div></div>
      </div></div>`;
      return;
    }
    const names = DETAIL_GROUPS[_detailSubTab] || [];
    const probeHtml = names.map(name => {
      const p = probes[name];
      const sum = probeSummary(name, p);
      return `<div class="adc-probe ${sum.ok ? 'adc-probe-ok' : 'adc-probe-fail'}">
        <div class="adc-probe-name">${esc(name)} ${p?.ms != null ? '(' + p.ms + 'ms)' : ''}</div>
        <div class="adc-probe-val">${esc(sum.text)}</div>
      </div>`;
    }).join('');
    if (_detailSubTab === 'live' && probes.sessions?.data?.live?.length) {
      content.innerHTML = `<div class="adc-live-grid">${probes.sessions.data.live.map(l => `
        <div class="adc-live-card">
          <div class="adc-live-title">${esc(l.title)}</div>
          <div class="adc-live-meta">${esc(l.client || '')}${l.isTranscoding ? ' · transcoding' : ''}</div>
          ${l.progressPct != null ? `<div class="adc-progress"><div class="adc-progress-fill" style="width:${l.progressPct}%"></div></div>` : ''}
        </div>`).join('')}</div>` + (probeHtml ? `<div class="adc-probe-grid">${probeHtml}</div>` : '');
    } else {
      content.innerHTML = `<div class="adc-probe-grid">${probeHtml || '<div class="adc-empty">No probes in this group</div>'}</div>`;
    }
  }

  function renderTokens() {
    const panel = $('#adc-panel-tokens');
    const d = _cache.tokens;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const cacheRows = (d.cache || []).map(c => {
      const warn = c.ttlRemainingMs != null && c.ttlRemainingMs < 3600000;
      return `<tr class="${warn ? 'adc-row-warn' : ''}"><td>${esc(c.url)}</td><td>${esc(c.userId)}</td><td>${fmtUptime(c.ageMs)}</td><td>${fmtUptime(c.ttlRemainingMs)}</td></tr>`;
    }).join('');
    const events = (d.events || []).slice(0, 30).map(e =>
      `<tr><td>${fmtDate(e.createdAt)}</td><td>${esc(e.label || e.serverUrl)}</td>
       <td><span class="adc-pill ${e.ok ? 'adc-pill-up' : 'adc-pill-down'}">${e.ok ? 'OK' : 'FAIL'}</span></td>
       <td>${esc(e.message)}</td></tr>`
    ).join('');
    const leaderboard = (d.failureLeaderboard || []).map((r, i) => {
      const max = d.failureLeaderboard[0]?.fail || 1;
      return `<div class="adc-rank-row"><span>${i + 1}. ${esc(r.label || r.url)}</span>
        <div class="adc-rank-bar"><div class="adc-rank-fill adc-rank-bad" style="width:${Math.round(r.fail / max * 100)}%"></div></div>
        <span>${r.fail} fail</span></div>`;
    }).join('');
    panel.innerHTML = `
      <div class="adc-grid-2">
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Re-auth (7d)</span>
            <button type="button" class="btn-soft btn-xs" id="adc-export-tokens">Export events</button></div>
          <div id="adc-token-chart"></div>
          <p class="adc-card-foot">24h: <strong>${d.aggregate?.ok24h || 0}</strong> ok · <strong class="adc-text-bad">${d.aggregate?.fail24h || 0}</strong> fail · 7d fails: ${d.aggregate?.fail7d || 0}</p>
        </div>
        <div class="adc-card">
          <div class="adc-card-title">Failure leaderboard (7d)</div>
          <div class="adc-rank">${leaderboard || '<div class="adc-empty adc-empty-sm">No failures — nice!</div>'}</div>
        </div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card">
          <div class="adc-card-title">Missing auto re-auth credentials</div>
          <p style="font-size:0.82rem;margin:0">${(d.missingCreds || []).length} server(s) without saved username/password</p>
          ${(d.missingCreds || []).slice(0, 5).map(m => `<div class="adc-row-sub" style="margin-top:6px">${esc(m.label || m.url)}</div>`).join('')}
        </div>
        <div class="adc-card">
          <div class="adc-card-title">Token cache (${(d.cache || []).length})</div>
          <div class="adc-table-wrap"><table class="adc-table adc-table-compact"><thead><tr><th>URL</th><th>User</th><th>Age</th><th>TTL left</th></tr></thead><tbody>${cacheRows || '<tr><td colspan="4">Empty</td></tr>'}</tbody></table></div>
        </div>
      </div>
      <div class="adc-card">
        <div class="adc-card-title">Recent re-auth events</div>
        <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>When</th><th>Server</th><th>Result</th><th>Message</th></tr></thead><tbody>${events || '<tr><td colspan="4">None yet</td></tr>'}</tbody></table></div>
      </div>`;
    if (d.series) renderAreaChart($('#adc-token-chart'), d.series, ['ok', 'fail'], { filled: true });
    $('#adc-export-tokens')?.addEventListener('click', () => exportCsv('token-events', d.events || []));
  }

  function renderLive() {
    const panel = $('#adc-panel-live');
    const live = _cache.live?.live || [];
    if (!panel) return;
    if (!_cache.live) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    if (!live.length) {
      panel.innerHTML = `<div class="adc-empty adc-empty-hero">
        <div class="adc-empty-icon">▶</div>
        <div>Nothing playing right now</div>
        <div class="adc-row-sub">Streams appear here when users are watching</div>
      </div>`;
      return;
    }
    panel.innerHTML = `
      <div class="adc-live-header">${live.length} active stream${live.length === 1 ? '' : 's'}</div>
      <div class="adc-live-grid">${live.map(s => `
      <div class="adc-live-card adc-live-card-rich">
        <div class="adc-live-play">▶</div>
        <div class="adc-live-body">
          <div class="adc-live-title">${esc(s.title)}</div>
          <div class="adc-live-meta">${esc(s.bridgeUsername)} · ${esc(s.server)}</div>
          <div class="adc-live-meta">${esc(s.client || s.device || '')}${s.isTranscoding ? ' · <span class="adc-type-pill">transcode</span>' : ''}</div>
          ${s.progressPct != null ? `<div class="adc-progress"><div class="adc-progress-fill" style="width:${s.progressPct}%"></div></div><div class="adc-row-sub">${Math.round(s.progressPct)}% watched</div>` : ''}
        </div>
      </div>`).join('')}</div>`;
  }

  function renderActivity() {
    const panel = $('#adc-panel-activity');
    const d = _cache.activity;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const top = (d.topContent || []).map((t, i) => {
      const max = d.topContent[0]?.count || 1;
      return `<div class="adc-rank-row"><span>${i + 1}. ${esc(t.title)}</span><div class="adc-rank-bar"><div class="adc-rank-fill" style="width:${Math.round(t.count / max * 100)}%"></div></div><span>${t.count}</span></div>`;
    }).join('');
    panel.innerHTML = `
      <div class="adc-toolbar">
        <span class="adc-card-title" style="margin:0">Activity</span>
        <div class="adc-seg">
          <button type="button" class="adc-seg-btn${_activityRange === '24h' ? ' on' : ''}" data-range="24h">24h</button>
          <button type="button" class="adc-seg-btn${_activityRange === '7d' ? ' on' : ''}" data-range="7d">7d</button>
        </div>
        <span class="adc-card-meta">${d.total || 0} requests in window</span>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">Requests</div><div id="adc-act-req"></div></div>
        <div class="adc-card"><div class="adc-card-title">Error rate %</div><div id="adc-act-err"></div></div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">Avg response ms</div><div id="adc-act-lat" class="adc-spark-wrap"></div></div>
        <div class="adc-card"><div class="adc-card-title">Server wins</div><div class="adc-rank">${(d.servers || []).map((s, i) => {
          const max = d.servers[0]?.count || 1;
          return `<div class="adc-rank-row"><span>${esc(s.server)}</span><div class="adc-rank-bar"><div class="adc-rank-fill" style="width:${Math.round(s.count / max * 100)}%"></div></div><span>${s.count}</span></div>`;
        }).join('') || '—'}</div></div>
      </div>
      <div class="adc-card"><div class="adc-card-title">Top content</div><div class="adc-rank">${top || '—'}</div></div>`;
    renderAreaChart($('#adc-act-req'), d.requests, ['total', 'found', 'failed'], { filled: true });
    if (d.errorRateSeries?.length) renderAreaChart($('#adc-act-err'), d.errorRateSeries, ['errorRate'], { filled: true });
    if (d.latencySeries?.length) renderSpark($('#adc-act-lat'), d.latencySeries.map(b => b.avgMs), '#60a5fa', { width: 400, height: 80 });
    panel.querySelectorAll('.adc-seg-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        _activityRange = btn.dataset.range;
        const r = await api('/api/admin/intel/activity?range=' + _activityRange);
        if (r.status === 200) { _cache.activity = r.body; renderActivity(); }
      });
    });
  }

  function renderHealth() {
    const panel = $('#adc-panel-health');
    const d = _cache.health;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const rows = (d.servers || []).map(s => {
      const cls = s.uptimePct >= 95 ? 'good' : s.uptimePct >= 80 ? 'mid' : 'bad';
      return `<tr>
        <td><strong>${esc(s.label || s.url)}</strong></td>
        <td><div class="adc-health-bar"><div class="adc-health-fill adc-health-${cls}" style="width:${s.uptimePct || 0}%"></div></div><span class="adc-uptime adc-uptime-${cls}">${s.uptimePct != null ? s.uptimePct + '%' : '—'}</span></td>
        <td>${s.avgMs != null ? s.avgMs + 'ms' : '—'}</td>
        <td>${esc(s.checks)}</td>
      </tr>`;
    }).join('');
    const heat = _cache.heatmap;
    const heatHtml = heat?.servers?.length ? `
      <div class="adc-card">
        <div class="adc-card-head">
          <span class="adc-card-title">Fleet heatmap (${heat.hours || 24}h)</span>
          <span class="adc-card-meta">${heat.servers.length} servers · snapshot cells</span>
        </div>
        <div class="adc-heatmap">${heat.servers.map(s => `
          <div class="adc-heatmap-row">
            <span class="adc-heatmap-label" title="${esc(s.url)}">${esc(s.label)}</span>
            <div class="adc-heatmap-cells">${(s.cells || []).map(c =>
              `<i class="adc-heat-cell adc-heat-${c.up ? 'up' : 'down'}" title="${fmtDate(c.at)}${c.pingMs != null ? ' · ' + c.pingMs + 'ms' : ''}"></i>`
            ).join('') || '<span class="adc-row-sub">no cells</span>'}</div>
          </div>`).join('')}</div>
      </div>` : '';
    panel.innerHTML = `
      ${heatHtml}
      <div class="adc-card">
        <div class="adc-card-title">Uptime rollup (30d)</div>
        <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>Server</th><th>Uptime</th><th>Avg ms</th><th>Checks</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No health data</td></tr>'}</tbody></table></div>
      </div>
      <div class="adc-card"><div class="adc-card-title">Daily checks</div><div id="adc-health-chart"></div></div>`;
    if (d.series?.length) renderAreaChart($('#adc-health-chart'), d.series, ['checks', 'up_checks'], { filled: true });
  }

  function renderBridge() {
    const panel = $('#adc-panel-bridge');
    const d = _cache.bridge;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const c = d.current || {};
    const dep = d.deployment || {};
    panel.innerHTML = `
      <div class="adc-bridge-gauges">
        <div class="adc-gauge-wrap">
          <div class="gauge adc-gauge" id="adc-g-cpu" style="--v:0"><div class="gauge-in"><div class="gv">—</div><div class="gl">CPU</div></div></div>
        </div>
        <div class="adc-gauge-wrap">
          <div class="gauge adc-gauge" id="adc-g-ram" style="--v:0"><div class="gauge-in"><div class="gv">—</div><div class="gl">RAM</div></div></div>
        </div>
        <div class="adc-bridge-stats">
          <div class="adc-stat"><span class="adc-stat-n">${Math.round((c.rssBytes || 0) / 1048576)}</span><span class="adc-stat-l">RSS MB</span></div>
          <div class="adc-stat"><span class="adc-stat-n">${Math.round((c.heapUsedBytes || 0) / 1048576)}</span><span class="adc-stat-l">Heap MB</span></div>
          <div class="adc-stat"><span class="adc-stat-n">${c.loadAvg1 != null ? Number(c.loadAvg1).toFixed(2) : '—'}</span><span class="adc-stat-l">Load 1m</span></div>
          <div class="adc-stat"><span class="adc-stat-n">${fmtUptime((c.uptimeSec || 0) * 1000)}</span><span class="adc-stat-l">Uptime</span></div>
        </div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">CPU (24h)</div><div id="adc-bridge-cpu" class="adc-spark-wrap"></div></div>
        <div class="adc-card"><div class="adc-card-title">RAM (24h)</div><div id="adc-bridge-ram" class="adc-spark-wrap"></div></div>
      </div>
      <div class="adc-card">
        <div class="adc-card-title">Deployment</div>
        <div class="adc-deploy-grid">
          <div><span class="adc-deploy-k">Node</span><span>${esc(dep.node)}</span></div>
          <div><span class="adc-deploy-k">Platform</span><span>${esc(dep.platform)} / ${esc(dep.arch)}</span></div>
          <div><span class="adc-deploy-k">Region</span><span>${esc(dep.region || '—')}</span></div>
          <div><span class="adc-deploy-k">Service</span><span>${esc(dep.service || '—')}</span></div>
          <div><span class="adc-deploy-k">Env</span><span>${esc(dep.env)}</span></div>
          <div><span class="adc-deploy-k">Host</span><span>${esc(dep.hostname)}</span></div>
          <div><span class="adc-deploy-k">Database</span><span class="adc-pill ${d.services?.database ? 'adc-pill-up' : 'adc-pill-down'}">${d.services?.database ? 'connected' : 'offline'}</span></div>
        </div>
      </div>`;
    setGauge($('#adc-g-cpu'), c.cpuPercent, 'CPU');
    setGauge($('#adc-g-ram'), c.sysMemPct, 'RAM');
    const series = d.series || [];
    renderSpark($('#adc-bridge-cpu'), series.map(s => s.cpu), 'var(--accent)', { width: 500, height: 100 });
    renderSpark($('#adc-bridge-ram'), series.map(s => s.ram), '#60a5fa', { width: 500, height: 100 });
  }

  function renderDocs() {
    const panel = $('#adc-panel-docs');
    const d = _cache.docs;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    panel.innerHTML = `
      <div class="adc-docs-head">
        <input type="search" class="adc-docs-search" id="adc-docs-search" placeholder="Search fields, APIs, notes…" />
        <span class="adc-card-meta">v${d.version || 1} · ${(d.categories || []).length} categories</span>
      </div>
      <div id="adc-docs-body"></div>`;
    const renderDocsBody = (q) => {
      const body = $('#adc-docs-body');
      if (!body) return;
      const ql = (q || '').toLowerCase();
      body.innerHTML = (d.categories || []).map((cat, ci) => {
        const fields = (cat.fields || []).filter(f =>
          !ql || [f.field, f.source, f.type, f.notes, f.status, cat.label].some(x => String(x || '').toLowerCase().includes(ql))
        );
        if (!fields.length) return '';
        const collected = fields.filter(f => f.status === 'collected').length;
        return `<details class="adc-doc-cat" open>
          <summary class="adc-doc-sum">
            <span>${esc(cat.label)}</span>
            <span class="adc-doc-badges">
              <span class="adc-status adc-status-collected">${collected} collected</span>
              ${fields.some(f => f.status === 'n/a') ? '<span class="adc-status adc-status-na">n/a</span>' : ''}
              ${fields.some(f => f.status === 'blocked') ? '<span class="adc-status adc-status-blocked">blocked</span>' : ''}
            </span>
          </summary>
          <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>Field</th><th>Status</th><th>Type</th><th>Source</th><th>Notes</th></tr></thead>
          <tbody>${fields.map(f => `<tr>
            <td><code>${esc(f.field)}</code></td>
            <td><span class="adc-status adc-status-${esc(f.status || 'collected')}">${esc(f.status || 'collected')}</span></td>
            <td>${esc(f.type)}</td>
            <td>${esc(f.source)}</td>
            <td>${esc(f.notes || '')}${f.sensitive ? ' <span class="adc-status adc-status-blocked">sensitive</span>' : ''}</td>
          </tr>`).join('')}
          </tbody></table></div>
        </details>`;
      }).join('') || '<div class="adc-empty">No matches</div>';
    };
    renderDocsBody('');
    $('#adc-docs-search')?.addEventListener('input', e => renderDocsBody(e.target.value));
  }

  function renderActivePanel() {
    const map = {
      overview: renderOverview,
      servers: renderServers,
      tokens: renderTokens,
      live: renderLive,
      activity: renderActivity,
      health: renderHealth,
      bridge: renderBridge,
      docs: renderDocs,
    };
    (map[_tab] || renderOverview)();
  }

  function switchTab(tab) {
    _tab = tab;
    $$('.adc-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    $$('.adc-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === tab));
    renderActivePanel();
  }

  function exportCsv(name, rows) {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]).filter(k => !k.startsWith('_') && k !== '_server');
    const lines = [keys.join(',')].concat(rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-center-${name}-${Date.now()}.csv`;
    a.click();
  }

  function applyDashboard(body) {
    if (!body) return;
    _cache.overview = body.overview;
    _cache.activity = body.activity;
    _cache.servers = body.servers;
    _cache.recentActivity = body.recentActivity;
    _cache.heatmap = body.heatmap;
    _meta = body.meta;
    setKpis(_cache.overview);
    renderMetaBar(_meta);
    updateTabBadges();
  }

  async function loadDashboard() {
    const r = await api('/api/admin/intel/dashboard');
    if (r.status === 200) applyDashboard(r.body);
  }

  async function pollStatus() {
    const r = await api('/api/admin/intel/status');
    if (r.status !== 200 || !r.body) return;
    _meta = r.body.meta;
    renderMetaBar(_meta, r.body.badges);
    updateTabBadges(r.body.badges);
    const pill = $('#adc-live-pill');
    if (pill && r.body.badges?.live > 0) pill.classList.add('adc-live-active');
    else if (pill) pill.classList.remove('adc-live-active');
  }

  async function loadTabData(tab) {
    if (tab === 'overview') {
      const [ov, act] = await Promise.all([
        api('/api/admin/intel/overview'),
        api('/api/admin/intel/activity?range=' + _activityRange),
      ]);
      if (ov.status === 200) _cache.overview = ov.body;
      if (act.status === 200) _cache.activity = act.body;
      setKpis(_cache.overview);
      updateTabBadges();
      return;
    }
    const loads = {
      servers: () => api('/api/admin/intel/servers'),
      tokens: () => api('/api/admin/intel/tokens'),
      live: () => api('/api/admin/intel/live'),
      activity: () => api('/api/admin/intel/activity?range=' + _activityRange),
      health: () => api('/api/admin/intel/health'),
      bridge: () => api('/api/admin/intel/bridge?range=24h'),
      docs: () => api('/api/admin/intel/docs'),
    };
    const fn = loads[tab];
    if (!fn) return;
    const r = await fn();
    if (r.status === 200) {
      if (tab === 'servers') _cache.servers = r.body?.servers;
      else _cache[tab] = r.body;
    }
    if (tab === 'live') updateTabBadges();
  }

  async function refreshAll() {
    const poll = $('#adc-last-poll');
    if (poll) poll.textContent = 'Refreshing…';
    await loadDashboard();
    await Promise.all([
      loadTabData('tokens'),
      loadTabData('health'),
      loadTabData('bridge'),
    ]);
    const liveR = await api('/api/admin/intel/live');
    if (liveR.status === 200) _cache.live = liveR.body;
    if (_tab === 'docs' && !_cache.docs) await loadTabData('docs');
    await pollStatus();
    renderActivePanel();
    if (poll) poll.textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  async function triggerServerRefresh() {
    const btn = $('#adc-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Probing…'; }
    await api('/api/admin/intel/refresh', { method: 'POST' });
    await refreshAll();
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh all'; }
  }

  function startPolling() {
    stopPolling();
    _statusTimer = setInterval(pollStatus, 15000);
    _pollTimer = setInterval(refreshAll, 60000);
    _liveTimer = setInterval(async () => {
      if (_tab === 'live' || document.getElementById('adc-autopoll')?.checked) {
        const r = await api('/api/admin/intel/live');
        if (r.status === 200) { _cache.live = r.body; updateTabBadges({ live: r.body.count }); if (_tab === 'live') renderLive(); }
      }
    }, 15000);
  }

  function stopPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    if (_liveTimer) clearInterval(_liveTimer);
    if (_statusTimer) clearInterval(_statusTimer);
    _pollTimer = _liveTimer = _statusTimer = null;
  }

  function exportDashboardJson() {
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      overview: _cache.overview,
      servers: _cache.servers,
      activity: _cache.activity,
      tokens: _cache.tokens,
      health: _cache.health,
      bridge: _cache.bridge,
      heatmap: _cache.heatmap,
      meta: _meta,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-center-export-${Date.now()}.json`;
    a.click();
  }

  function onRoute() {
    const page = (location.hash || '').replace(/^#\//, '').split('?')[0];
    if (page !== 'admin-data' && page !== 'admin/data') { stopPolling(); return; }
    refreshAll();
    startPolling();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return;

    $$('.adc-tab').forEach(btn => btn.addEventListener('click', async () => {
      switchTab(btn.dataset.tab);
      if (!_cache[btn.dataset.tab] && btn.dataset.tab !== 'overview') await loadTabData(btn.dataset.tab);
      renderActivePanel();
    }));

    $('#adc-refresh-btn')?.addEventListener('click', triggerServerRefresh);
    $('#adc-export-json')?.addEventListener('click', exportDashboardJson);
    $('#adc-detail-back')?.addEventListener('click', () => {
      const d = $('#adc-detail');
      if (d) { d.hidden = true; document.removeEventListener('keydown', onDetailEsc); }
    });
    $('#adc-autopoll')?.addEventListener('change', e => { if (e.target.checked) startPolling(); else stopPolling(); });

    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();