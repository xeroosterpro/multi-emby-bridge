// ─── Admin Data Center UI ────────────────────────────────────────────────────
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

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
  let _cache = {};

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

  function renderAreaChart(el, series, keys) {
    if (!el || !series?.length) { el.innerHTML = '<div class="adc-empty">No data yet</div>'; return; }
    const W = 600, H = 120, p = 12;
    const max = Math.max(1, ...series.map(s => Math.max(...keys.map(k => s[k] || 0))));
    const step = (W - p * 2) / Math.max(1, series.length - 1);
    const colors = ['var(--accent)', '#60a5fa', '#f59e0b'];
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="adc-chart">`;
    keys.forEach((key, ki) => {
      const pts = series.map((s, i) => {
        const v = s[key] || 0;
        const x = p + i * step;
        const y = H - p - (v / max) * (H - p * 2);
        return `${x},${y}`;
      }).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${colors[ki % colors.length]}" stroke-width="2" opacity="0.9"/>`;
    });
    svg += '</svg>';
    el.innerHTML = svg;
  }

  function renderSpark(el, vals, color) {
    if (!el || !vals?.length) return;
    const pts = vals.filter(v => v != null);
    if (pts.length < 2) return;
    const W = 200, H = 48, p = 4;
    const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
    const coords = pts.map((v, i) => ({
      x: p + (i / (pts.length - 1)) * (W - p * 2),
      y: p + (1 - (v - mn) / rng) * (H - p * 2),
    }));
    const line = coords.map(c => `${c.x},${c.y}`).join(' ');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
  }

  function setKpis(data) {
    const el = $('#adc-kpis');
    if (!el || !data) return;
    const tiles = [
      ['Servers', data.serverCount],
      ['Snapshots', data.snapshotCount],
      ['Token cache', data.tokenCacheCount],
      ['Re-auth 24h', (data.tokenEvents?.ok24h || 0) + ' ok / ' + (data.tokenEvents?.fail24h || 0) + ' fail'],
      ['Requests 24h', data.platform?.requests24h],
      ['Success %', data.platform?.successRate != null ? data.platform.successRate + '%' : '—'],
      ['Avg ms', data.platform?.avgResponseMs],
      ['Down now', data.downCount],
    ];
    el.innerHTML = tiles.map(([l, n]) =>
      `<div class="adc-kpi"><div class="adc-kpi-n">${esc(n ?? '—')}</div><div class="adc-kpi-l">${esc(l)}</div></div>`
    ).join('');
  }

  function renderOverview() {
    const panel = $('#adc-panel-overview');
    const d = _cache.overview;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div><div class="adc-skel"></div>'; return; }
    const alerts = (d.alerts || []).map(a =>
      `<div class="adc-alert adc-alert-${a.level === 'error' ? 'error' : a.level === 'warn' ? 'warn' : 'info'}" data-goto="${esc(a.tab)}">${esc(a.text)}</div>`
    ).join('') || '<div class="adc-empty">All clear — no active alerts</div>';
    panel.innerHTML = `
      <div class="adc-grid-2">
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Alerts</span></div>
          ${alerts}
        </div>
        <div class="adc-card">
          <div class="adc-card-head"><span class="adc-card-title">Snapshot status</span></div>
          <p style="margin:0;font-size:0.84rem;color:var(--text-muted)">
            Last cycle: <strong>${esc(d.snapshotAt ? fmtDate(d.snapshotAt) : 'pending')}</strong><br>
            Servers tracked: <strong>${esc(d.serverCount)}</strong>
          </p>
        </div>
      </div>
      <div class="adc-card">
        <div class="adc-card-head"><span class="adc-card-title">Activity (7d)</span></div>
        <div id="adc-overview-chart"></div>
      </div>`;
    if (_cache.activity?.requests) renderAreaChart($('#adc-overview-chart'), _cache.activity.requests, ['total', 'found', 'failed']);
    panel.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => switchTab(el.dataset.goto));
    });
  }

  function renderServers() {
    const panel = $('#adc-panel-servers');
    const rows = _cache.servers || [];
    if (!panel) return;
    if (!_cache.servers) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    if (!rows.length) { panel.innerHTML = '<div class="adc-empty">No configured servers yet</div>'; return; }
    panel.innerHTML = `
      <div class="adc-card">
        <div class="adc-card-head">
          <span class="adc-card-title">${rows.length} servers</span>
          <button type="button" class="btn-soft" id="adc-export-servers">Export CSV</button>
        </div>
        <div class="adc-table-wrap">
          <table class="adc-table" id="adc-servers-table">
            <thead><tr>
              <th>Status</th><th>Label</th><th>Owner</th><th>Type</th><th>Ping</th>
              <th>Library</th><th>Sessions</th><th>Token TTL</th><th>Req 7d</th>
            </tr></thead>
            <tbody>${rows.map(s => {
              const st = s.up === false ? 'down' : s.up ? 'up' : 'warn';
              const pill = st === 'up' ? 'adc-pill-up">UP' : st === 'down' ? 'adc-pill-down">DOWN' : 'adc-pill-warn">?';
              const lib = s.movies != null ? `${s.movies}m · ${s.shows}s` : '—';
              return `<tr data-key="${esc(s.key)}">
                <td><span class="adc-pill ${pill}</span></td>
                <td><strong>${esc(s.label || s.url)}</strong></td>
                <td>${esc(s.ownerUsername)}</td>
                <td>${esc(s.type)}</td>
                <td>${s.pingMs != null ? s.pingMs + 'ms' : '—'}</td>
                <td>${esc(lib)}</td>
                <td>${esc(s.sessions || 0)}${s.sessionMethod ? ' · ' + esc(s.sessionMethod) : ''}</td>
                <td>${s.tokenTtlMs != null ? fmtUptime(s.tokenTtlMs) : '—'}</td>
                <td>${esc(s.requests7d || 0)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
    panel.querySelectorAll('#adc-servers-table tbody tr').forEach(tr => {
      tr.addEventListener('click', () => openServerDetail(tr.dataset.key));
    });
    $('#adc-export-servers')?.addEventListener('click', () => exportCsv('servers', rows));
  }

  async function openServerDetail(key) {
    const detail = $('#adc-detail');
    const body = $('#adc-detail-body');
    const title = $('#adc-detail-title');
    if (!detail || !body) return;
    detail.hidden = false;
    body.innerHTML = '<div class="adc-skel"></div>';
    const r = await api('/api/admin/intel/servers/' + encodeURIComponent(key));
    if (r.status !== 200 || !r.body) { body.innerHTML = '<div class="adc-empty">Failed to load</div>'; return; }
    const { entry, payload, history } = r.body;
    if (title) title.textContent = entry.label || entry.url;
    const probes = payload.probes || {};
    const probeHtml = Object.entries(probes).map(([name, p]) => {
      const ok = p.ok !== false && (p.ok === true || p.data != null);
      const val = p.data != null ? JSON.stringify(p.data).slice(0, 200) : (p.error || 'n/a');
      return `<div class="adc-probe ${ok ? 'adc-probe-ok' : 'adc-probe-fail'}">
        <div class="adc-probe-name">${esc(name)} ${p.ms != null ? '(' + p.ms + 'ms)' : ''}</div>
        <div class="adc-probe-val">${esc(val)}</div>
      </div>`;
    }).join('');
    body.innerHTML = `
      <div class="adc-card">
        <p style="margin:0 0 12px;font-size:0.82rem;color:var(--text-muted)">
          ${esc(entry.url)} · ${esc(entry.ownerUsername)} · probed ${fmtDate(payload.probedAt)}
        </p>
        <div id="adc-detail-spark" style="height:48px;margin-bottom:12px"></div>
        <div class="adc-probe-grid">${probeHtml}</div>
      </div>`;
    const histVals = (history || []).map(h => h.up ? 1 : 0);
    renderSpark($('#adc-detail-spark'), histVals, 'var(--accent)');
  }

  function renderTokens() {
    const panel = $('#adc-panel-tokens');
    const d = _cache.tokens;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const cacheRows = (d.cache || []).map(c =>
      `<tr><td>${esc(c.url)}</td><td>${esc(c.userId)}</td><td>${fmtUptime(c.ageMs)}</td><td>${fmtUptime(c.ttlRemainingMs)}</td></tr>`
    ).join('');
    const events = (d.events || []).slice(0, 30).map(e =>
      `<tr><td>${fmtDate(e.createdAt)}</td><td>${esc(e.label || e.serverUrl)}</td>
       <td><span class="adc-pill ${e.ok ? 'adc-pill-up' : 'adc-pill-down'}">${e.ok ? 'OK' : 'FAIL'}</span></td>
       <td>${esc(e.message)}</td></tr>`
    ).join('');
    panel.innerHTML = `
      <div class="adc-grid-2">
        <div class="adc-card">
          <div class="adc-card-title">Re-auth (7d)</div>
          <div id="adc-token-chart"></div>
          <p style="font-size:0.78rem;color:var(--text-muted);margin:8px 0 0">
            24h: ${d.aggregate?.ok24h || 0} ok · ${d.aggregate?.fail24h || 0} fail
          </p>
        </div>
        <div class="adc-card">
          <div class="adc-card-title">Missing auto re-auth credentials</div>
          <p style="font-size:0.82rem;margin:0">${(d.missingCreds || []).length} server(s) without saved username/password</p>
        </div>
      </div>
      <div class="adc-card">
        <div class="adc-card-title">Token cache (${(d.cache || []).length})</div>
        <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>URL</th><th>User</th><th>Age</th><th>TTL left</th></tr></thead><tbody>${cacheRows || '<tr><td colspan="4">Empty</td></tr>'}</tbody></table></div>
      </div>
      <div class="adc-card">
        <div class="adc-card-title">Recent re-auth events</div>
        <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>When</th><th>Server</th><th>Result</th><th>Message</th></tr></thead><tbody>${events || '<tr><td colspan="4">None yet</td></tr>'}</tbody></table></div>
      </div>`;
    if (d.series) renderAreaChart($('#adc-token-chart'), d.series, ['ok', 'fail']);
  }

  function renderLive() {
    const panel = $('#adc-panel-live');
    const live = _cache.live?.live || [];
    if (!panel) return;
    if (!_cache.live) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    if (!live.length) { panel.innerHTML = '<div class="adc-empty">Nothing playing right now across all users</div>'; return; }
    panel.innerHTML = `<div class="adc-live-grid">${live.map(s => `
      <div class="adc-live-card">
        <div class="adc-live-title">${esc(s.title)}</div>
        <div class="adc-live-meta">${esc(s.bridgeUsername)} · ${esc(s.server)} · ${esc(s.client || s.device || '')}</div>
        ${s.progressPct != null ? `<div class="adc-progress"><div class="adc-progress-fill" style="width:${s.progressPct}%"></div></div>` : ''}
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
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">Requests</div><div id="adc-act-req"></div></div>
        <div class="adc-card"><div class="adc-card-title">Avg response ms</div><div id="adc-act-lat"></div></div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">Top content (7d)</div><div class="adc-rank">${top || '—'}</div></div>
        <div class="adc-card"><div class="adc-card-title">Server wins (7d)</div><div class="adc-rank">${(d.servers || []).map((s, i) => {
          const max = d.servers[0]?.count || 1;
          return `<div class="adc-rank-row"><span>${esc(s.server)}</span><div class="adc-rank-bar"><div class="adc-rank-fill" style="width:${Math.round(s.count / max * 100)}%"></div></div><span>${s.count}</span></div>`;
        }).join('') || '—'}</div></div>
      </div>`;
    renderAreaChart($('#adc-act-req'), d.requests, ['total', 'found', 'failed']);
    if (d.latencySeries?.length) {
      const el = $('#adc-act-lat');
      const vals = d.latencySeries.map(b => b.avgMs);
      renderSpark(el, vals, '#60a5fa');
    }
  }

  function renderHealth() {
    const panel = $('#adc-panel-health');
    const d = _cache.health;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const rows = (d.servers || []).map(s =>
      `<tr><td>${esc(s.label || s.url)}</td><td>${s.uptimePct != null ? s.uptimePct + '%' : '—'}</td><td>${s.avgMs != null ? s.avgMs + 'ms' : '—'}</td><td>${esc(s.checks)}</td></tr>`
    ).join('');
    panel.innerHTML = `
      <div class="adc-card">
        <div class="adc-card-title">Uptime rollup (30d)</div>
        <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>Server</th><th>Uptime</th><th>Avg ms</th><th>Checks</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No health data</td></tr>'}</tbody></table></div>
      </div>
      <div class="adc-card"><div class="adc-card-title">Daily checks</div><div id="adc-health-chart"></div></div>`;
    if (d.series?.length) renderAreaChart($('#adc-health-chart'), d.series, ['checks', 'up_checks']);
  }

  function renderBridge() {
    const panel = $('#adc-panel-bridge');
    const d = _cache.bridge;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    const c = d.current || {};
    panel.innerHTML = `
      <div class="adc-kpis" style="margin-bottom:14px">
        <div class="adc-kpi"><div class="adc-kpi-n">${esc(c.cpuPercent)}%</div><div class="adc-kpi-l">CPU now</div></div>
        <div class="adc-kpi"><div class="adc-kpi-n">${esc(c.sysMemPct)}%</div><div class="adc-kpi-l">RAM now</div></div>
        <div class="adc-kpi"><div class="adc-kpi-n">${Math.round((c.rssBytes || 0) / 1048576)}</div><div class="adc-kpi-l">RSS MB</div></div>
        <div class="adc-kpi"><div class="adc-kpi-n">${esc(c.loadAvg1 != null ? Number(c.loadAvg1).toFixed(2) : '—')}</div><div class="adc-kpi-l">Load 1m</div></div>
      </div>
      <div class="adc-grid-2">
        <div class="adc-card"><div class="adc-card-title">CPU (24h)</div><div id="adc-bridge-cpu"></div></div>
        <div class="adc-card"><div class="adc-card-title">RAM (24h)</div><div id="adc-bridge-ram"></div></div>
      </div>`;
    const series = d.series || [];
    renderSpark($('#adc-bridge-cpu'), series.map(s => s.cpu), 'var(--accent)');
    renderSpark($('#adc-bridge-ram'), series.map(s => s.ram), '#60a5fa');
  }

  function renderDocs() {
    const panel = $('#adc-panel-docs');
    const d = _cache.docs;
    if (!panel) return;
    if (!d) { panel.innerHTML = '<div class="adc-skel"></div>'; return; }
    panel.innerHTML = `
      <input type="search" class="adc-docs-search" id="adc-docs-search" placeholder="Search fields, APIs, notes…" />
      <div id="adc-docs-body"></div>`;
    const renderDocsBody = (q) => {
      const body = $('#adc-docs-body');
      if (!body) return;
      const ql = (q || '').toLowerCase();
      body.innerHTML = (d.categories || []).map(cat => {
        const fields = (cat.fields || []).filter(f =>
          !ql || [f.field, f.source, f.type, f.notes, cat.label].some(x => String(x || '').toLowerCase().includes(ql))
        );
        if (!fields.length) return '';
        return `<div class="adc-card"><div class="adc-card-title">${esc(cat.label)}</div>
          <div class="adc-table-wrap"><table class="adc-table"><thead><tr><th>Field</th><th>Type</th><th>Source</th><th>Sensitive</th><th>Notes</th></tr></thead>
          <tbody>${fields.map(f => `<tr><td><code>${esc(f.field)}</code></td><td>${esc(f.type)}</td><td>${esc(f.source)}</td><td>${f.sensitive ? 'yes' : 'no'}</td><td>${esc(f.notes || '')}</td></tr>`).join('')}
          </tbody></table></div></div>`;
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
    const keys = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
    const lines = [keys.join(',')].concat(rows.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-center-${name}-${Date.now()}.csv`;
    a.click();
  }

  async function loadTabData(tab) {
    const loads = {
      overview: () => api('/api/admin/intel/overview'),
      servers: () => api('/api/admin/intel/servers'),
      tokens: () => api('/api/admin/intel/tokens'),
      live: () => api('/api/admin/intel/live'),
      activity: () => api('/api/admin/intel/activity?range=7d'),
      health: () => api('/api/admin/intel/health'),
      bridge: () => api('/api/admin/intel/bridge?range=24h'),
      docs: () => api('/api/admin/intel/docs'),
    };
    if (tab === 'overview') {
      const [ov, act] = await Promise.all([api('/api/admin/intel/overview'), api('/api/admin/intel/activity?range=7d')]);
      if (ov.status === 200) _cache.overview = ov.body;
      if (act.status === 200) _cache.activity = act.body;
      setKpis(_cache.overview);
      return;
    }
    const fn = loads[tab];
    if (!fn) return;
    const r = await fn();
    if (r.status === 200) {
      if (tab === 'servers') _cache.servers = r.body?.servers;
      else _cache[tab] = r.body;
    }
  }

  async function refreshAll() {
    const poll = $('#adc-last-poll');
    if (poll) poll.textContent = 'Refreshing…';
    await Promise.all([
      loadTabData('overview'),
      loadTabData('servers'),
      loadTabData('tokens'),
      loadTabData('activity'),
      loadTabData('health'),
      loadTabData('bridge'),
    ]);
    if (_tab === 'docs' && !_cache.docs) await loadTabData('docs');
    if (_tab === 'live') await loadTabData('live');
    setKpis(_cache.overview);
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
    _pollTimer = setInterval(refreshAll, 60000);
    _liveTimer = setInterval(async () => {
      if (_tab === 'live' || document.getElementById('adc-autopoll')?.checked) {
        const r = await api('/api/admin/intel/live');
        if (r.status === 200) { _cache.live = r.body; if (_tab === 'live') renderLive(); }
      }
    }, 15000);
  }

  function stopPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    if (_liveTimer) clearInterval(_liveTimer);
    _pollTimer = _liveTimer = null;
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
    $('#adc-detail-back')?.addEventListener('click', () => { const d = $('#adc-detail'); if (d) d.hidden = true; });
    $('#adc-autopoll')?.addEventListener('change', e => { if (e.target.checked) startPolling(); else stopPolling(); });

    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();