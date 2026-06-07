// ─── Admin panel: System + Users console — metrics, charts, live streams, users
(function () {
  const $ = s => document.querySelector(s);
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  function fmtUptime(s) {
    s = Math.floor(s || 0); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }
  function fmtMB(b) { return Math.round((b || 0) / 1048576) + ' MB'; }

  let metricsTimer = null;
  async function tickMetrics() {
    const r = await api('/api/metrics'); const m = r.body; if (!m) return;
    if ($('#m-cpu')) $('#m-cpu').textContent = (m.cpuPercent ?? 0) + '%';
    if ($('#g-cpu')) $('#g-cpu').style.setProperty('--v', m.cpuPercent ?? 0);
    if ($('#m-ram')) $('#m-ram').textContent = (m.sysMemPct ?? 0) + '%';
    if ($('#g-ram')) $('#g-ram').style.setProperty('--v', m.sysMemPct ?? 0);
    if ($('#m-mem')) $('#m-mem').textContent = fmtMB(m.rssBytes);
    if ($('#m-up')) $('#m-up').textContent = fmtUptime(m.uptimeSec);
    if ($('#m-cpus')) $('#m-cpus').textContent = m.cpuCount ?? '—';
  }
  function startMetrics() { if (!metricsTimer) { tickMetrics(); metricsTimer = setInterval(tickMetrics, 3000); } }
  function stopMetrics() { clearInterval(metricsTimer); metricsTimer = null; }

  let _adminUsers = [];
  let _adminPage = 0;
  let _overview = null;
  let _liveByUser = new Map();
  let _chartRange = '7d';
  let _liveTimer = null;
  let _usersTimer = null;

  const escU = x => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtAgo = x => { if(!x) return 'never'; const d=Date.now()-new Date(x).getTime(); const m=Math.floor(d/60000); if(m<1) return 'just now'; if(m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; return Math.floor(h/24)+'d ago'; };
  const fmtWhen = x => x ? new Date(x).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
  const money = n => '$' + Number(n||0).toFixed(n >= 100 ? 0 : 2);
  const statusPill = s => `<span class="pay-status ${s==='active'||s==='comped'?'completed':(s==='past_due'?'refunded':'failed')}">${escU(s)}</span>`;
  const serverLabel = v => {
    if (!v) return '—';
    if (typeof v === 'object') return v.label || '—';
    const s = String(v);
    if (s.startsWith('{') || s.startsWith('[')) {
      try { const o = JSON.parse(s); if (o && o.label) return o.label; } catch {}
    }
    return s;
  };

  // ── SVG charts (no external lib) ─────────────────────────────────────────
  let _chartUid = 0;
  function renderAreaChart(el, series, opts = {}) {
    if (!el) return;
    const pts = Array.isArray(series) ? series : [];
    if (!pts.length) { el.innerHTML = '<div class="adm-empty">No data in this range yet.</div>'; return; }
    const W = 480, H = 140, pad = { t: 12, r: 8, b: 28, l: 36 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxV = Math.max(...pts.map(p => p.total || 0), 1);
    const coords = pts.map((p, i) => ({
      x: pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw),
      y: pad.t + ih - ((p.total || 0) / maxV) * ih,
      label: p.label,
      total: p.total,
      found: p.found,
    }));
    const line = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const area = `M${coords[0].x.toFixed(1)},${pad.t + ih} ` +
      coords.map(c => `L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ') +
      ` L${coords[coords.length - 1].x.toFixed(1)},${pad.t + ih} Z`;
    const uid = 'admch' + (_chartUid++);
    const labels = coords.filter((_, i) => i === 0 || i === coords.length - 1 || i % Math.ceil(coords.length / 5) === 0);
    const gridY = [0, 0.5, 1].map(f => {
      const y = pad.t + ih * (1 - f);
      const v = Math.round(maxV * f);
      return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--border)" stroke-width="1" opacity="0.5"/>
        <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-mute)" font-size="9">${v}</text>`;
    }).join('');
    const xLabels = labels.map(c => {
      const lbl = (c.label || '').slice(5).replace('T', ' ');
      return `<text x="${c.x}" y="${H - 6}" text-anchor="middle" fill="var(--text-mute)" font-size="8">${escU(lbl)}</text>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Request chart">
      <defs><linearGradient id="${uid}-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient></defs>
      ${gridY}
      <path d="${area}" fill="url(#${uid}-g)"/>
      <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${coords.map(c => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="var(--accent-2)" opacity="0.9"><title>${escU(c.label)}: ${c.total} requests (${c.found} found)</title></circle>`).join('')}
      ${xLabels}
    </svg>`;
    const meta = $('#adm-chart-meta');
    if (meta) {
      const tot = pts.reduce((a, p) => a + (p.total || 0), 0);
      const found = pts.reduce((a, p) => a + (p.found || 0), 0);
      meta.innerHTML = `<span>Total: <strong>${tot}</strong></span><span>Found: <strong>${found}</strong></span><span>Failed: <strong>${tot - found}</strong></span>`;
    }
  }

  function renderBarChart(el, items) {
    if (!el) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) { el.innerHTML = '<div class="adm-empty">No server traffic in the last 24h.</div>'; return; }
    const max = Math.max(...rows.map(r => r.count), 1);
    el.innerHTML = rows.map(r => `<div class="adm-bar-row">
      <span class="adm-bar-label" title="${escU(r.server)}">${escU(r.server)}</span>
      <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${Math.round(r.count / max * 100)}%"></div></div>
      <span class="adm-bar-val">${r.count}</span>
    </div>`).join('');
  }

  function renderRankList(el, items) {
    if (!el) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) { el.innerHTML = '<div class="adm-empty">No content requests yet today.</div>'; return; }
    el.innerHTML = rows.map((r, i) => `<div class="adm-rank-item">
      <span class="adm-rank-n${i < 3 ? ' top' : ''}">${i + 1}</span>
      <span class="adm-rank-title" title="${escU(r.title)}">${escU(r.title)}</span>
      <span class="adm-rank-count">${r.count}</span>
    </div>`).join('');
  }

  function renderHistoryList(el, items) {
    if (!el) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) { el.innerHTML = '<div class="adm-empty">No watch history recorded yet.</div>'; return; }
    el.innerHTML = rows.map(e => `<div class="adm-hist-row">
      <div class="adm-hist-main">
        <span class="adm-hist-title">${escU(e.title || '—')}${e.season ? ` <span class="da-ep">S${e.season}E${e.episode || ''}</span>` : ''}</span>
        <div class="adm-hist-meta">${escU(serverLabel(e.server))}${e.username ? ` · <span class="adm-hist-user">${escU(e.username)}</span>` : ''}${e.ms != null ? ` · ${e.ms}ms` : ''}</div>
      </div>
      <span class="adm-hist-found ${e.found ? 'ok' : 'fail'}">${e.found ? 'found' : 'miss'}</span>
      <span class="adm-hist-time">${fmtWhen(e.ts)}</span>
    </div>`).join('');
  }

  function renderLiveList(el, sessions) {
    if (!el) return;
    const rows = Array.isArray(sessions) ? sessions : [];
    const badge = $('#adm-live-count');
    const stLive = $('#adm-st-live');
    if (badge) badge.textContent = rows.length;
    if (stLive) stLive.textContent = rows.length;
    if (!rows.length) {
      el.innerHTML = '<div class="adm-empty">Nothing playing right now across all user servers.</div>';
      return;
    }
    el.innerHTML = rows.map(s => `<div class="adm-live-row">
      <div class="adm-live-main">
        <span class="adm-live-title">▶ ${escU(s.title)}</span>
        <div class="adm-live-meta">${escU(s.server)}${s.user ? ' · ' + escU(s.user) : ''}${s.client ? ' · ' + escU(s.client) : ''}</div>
      </div>
      <span class="adm-live-user">${escU(s.bridgeUsername || s.user || '—')}</span>
    </div>`).join('');
  }

  function renderPayments(el, items) {
    if (!el) return;
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) { el.innerHTML = '<div class="adm-empty">No payments recorded.</div>'; return; }
    el.innerHTML = rows.map(p => `<div class="adm-pay-row">
      <div class="adm-hist-main">
        <span class="adm-hist-title">${escU(p.username || '—')}</span>
        <div class="adm-hist-meta">${fmtWhen(p.paid_at)}</div>
      </div>
      <span class="adm-rank-count">${money(p.amount)}</span>
      <span class="adm-hist-found ${p.status === 'completed' ? 'ok' : 'fail'}">${escU(p.status)}</span>
    </div>`).join('');
  }

  function populateStats(o) {
    if (!o) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('adm-st-users', o.users?.total ?? '—');
    set('adm-st-servers', o.servers?.total ?? '—');
    set('adm-st-active', o.activeUsers24h ?? '—');
    set('adm-st-requests', o.activity?.requests24h ?? '—');
    set('adm-st-success', o.successRate != null ? o.successRate + '%' : '—');
    set('adm-st-revenue', money(o.revenue?.monthly));
    set('adm-st-tickets', o.tickets?.open ?? 0);
  }

  function renderCharts(o) {
    if (!o?.charts) return;
    const series = _chartRange === '24h' ? o.charts.requests24h : o.charts.requests7d;
    renderAreaChart($('#adm-chart-requests'), series);
    renderBarChart($('#adm-chart-servers'), o.charts.servers24h);
    renderRankList($('#adm-top-content'), o.charts.topContent24h);
    renderHistoryList($('#adm-history-list'), o.recentActivity);
    renderPayments($('#adm-pay-list'), o.recentPayments);
  }

  async function loadOverview() {
    const r = await api('/api/admin/overview');
    if (r.status !== 200 || !r.body) return;
    _overview = r.body;
    populateStats(_overview);
    renderCharts(_overview);
  }

  async function loadLive() {
    const el = $('#adm-live-list');
    const r = await api('/api/admin/live');
    if (r.status !== 200 || !r.body) {
      if (el && !el.querySelector('.adm-live-row')) el.innerHTML = '<div class="adm-empty">Live scan unavailable.</div>';
      return;
    }
    _liveByUser = new Map();
    for (const s of (r.body.live || [])) {
      const uid = s.bridgeUserId;
      if (uid) {
        if (!_liveByUser.has(uid)) _liveByUser.set(uid, []);
        _liveByUser.get(uid).push(s);
      }
    }
    renderLiveList(el, r.body.live);
    renderUsersTable();
  }

  function renderUsersTable() {
    const tbody = $('#adm-users-rows'); if (!tbody) return;
    const term = ($('#adm-search')?.value || '').toLowerCase();
    const filter = $('#adm-filter')?.value || 'all';
    const sort = $('#adm-sort')?.value || 'activity';
    let rows = _adminUsers.filter(u => (!term || u.username.toLowerCase().includes(term)) && (filter === 'all' || u.sub_status === filter));
    const ts = x => x ? new Date(x).getTime() : 0;
    rows.sort((a,b) =>
      sort === 'name' ? a.username.localeCompare(b.username) :
      sort === 'status' ? String(a.sub_status).localeCompare(String(b.sub_status)) :
      sort === 'requests' ? (b.requests_24h||0) - (a.requests_24h||0) :
      sort === 'newest' ? ts(b.created_at) - ts(a.created_at) :
      ts(b.last_request_at || b.last_seen_at) - ts(a.last_request_at || a.last_seen_at));
    const PER = 25;
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    if (_adminPage >= pages) _adminPage = pages - 1;
    const pageRows = rows.slice(_adminPage * PER, _adminPage * PER + PER);
    tbody.innerHTML = pageRows.map(u => {
      const liveN = (_liveByUser.get(u.id) || []).length;
      const liveBadge = liveN
        ? `<span class="adm-live-badge"><span class="adm-live-dot"></span>${liveN}</span>`
        : `<span class="adm-live-badge off">—</span>`;
      const reqs = u.requests_24h || 0;
      return `<tr data-uid="${u.id}">
      <td><div class="adm-user"><span class="adm-avatar">${escU((u.username||'?')[0].toUpperCase())}</span><span><strong>${escU(u.username)}</strong><span class="adm-role">${escU(u.role)}</span></span></div></td>
      <td>${statusPill(u.sub_status)}</td>
      <td>${liveBadge}</td>
      <td><span class="adm-req-pill${reqs >= 5 ? ' hot' : ''}">${reqs}</span></td>
      <td class="adm-dim">${fmtAgo(u.last_request_at || u.last_seen_at)}</td>
      <td class="adm-dim">${u.server_count||0}</td>
      <td><button class="btn-soft acct-manage" data-uid="${u.id}">Manage</button></td>
    </tr>`;
    }).join('') || '<tr><td colspan="7" class="log-empty">No users match your filters.</td></tr>';
    const pager = $('#adm-pager');
    if (pager) {
      pager.innerHTML = pages > 1
        ? `<button class="btn-soft" id="adm-prev" ${_adminPage===0?'disabled':''}>← Prev</button>
           <span class="adm-dim">Page ${_adminPage+1} of ${pages} · ${rows.length} users</span>
           <button class="btn-soft" id="adm-next" ${_adminPage>=pages-1?'disabled':''}>Next →</button>`
        : '';
      const prev=$('#adm-prev'), next=$('#adm-next');
      if (prev) prev.onclick = () => { _adminPage--; renderUsersTable(); };
      if (next) next.onclick = () => { _adminPage++; renderUsersTable(); };
    }
  }

  async function loadUsers() {
    const tb = $('#adm-users-rows');
    if (tb && !_adminUsers.length) tb.innerHTML = Array(4).fill('<tr class="skel-row"><td colspan="7"><div class="skel-line"></div></td></tr>').join('');
    const r = await api('/api/admin/users');
    if (r.status !== 200 || !r.body) { if(tb) tb.innerHTML='<tr><td colspan="7">Unable to load users.</td></tr>'; return; }
    _adminUsers = r.body.users || [];
    renderUsersTable();
    ['adm-search','adm-filter','adm-sort'].forEach(id => { const el=document.getElementById(id); if(el&&!el._w){ el._w=1; const h=()=>{ _adminPage=0; renderUsersTable(); }; el.addEventListener('input', h); el.addEventListener('change', h); } });
  }

  function startUsersPolling() {
    stopUsersPolling();
    _usersTimer = setInterval(() => {
      if ((location.hash || '').replace(/^#\//, '') === 'users') refreshConsole(true);
    }, 20000);
  }
  function stopUsersPolling() { clearInterval(_usersTimer); _usersTimer = null; }

  function startLivePolling() {
    stopLivePolling();
    _liveTimer = setInterval(() => {
      if ((location.hash || '').replace(/^#\//, '') === 'users') loadLive();
    }, 15000);
  }
  function stopLivePolling() { clearInterval(_liveTimer); _liveTimer = null; }

  async function refreshConsole(silent) {
    const btn = $('#adm-refresh-btn');
    if (btn && !silent) { btn.disabled = true; btn.textContent = '↻ Loading…'; }
    await Promise.all([loadOverview(), loadUsers(), loadLive()]);
    if (btn && !silent) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
    if (!silent && window.toast) window.toast('Console refreshed');
  }

  function wireChartTabs() {
    const tabs = $('#adm-chart-tabs');
    if (!tabs || tabs._w) return;
    tabs._w = 1;
    tabs.querySelectorAll('.adm-chart-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.adm-chart-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _chartRange = btn.dataset.range || '7d';
        if (_overview) renderCharts(_overview);
      });
    });
  }

  function openUserManageModal(id, d) {
    if (!window.openModal) return;
    const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const moneyP = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—');
    const date = x => x ? new Date(x).toLocaleString() : '—';
    const pays = (d.payments || []).map(p => `<div class="mrow">${date(p.paid_at)}<span class="mtag">${moneyP(p)} · ${esc(p.status)}</span></div>`).join('') || '<div class="field-hint">No payments.</div>';
    const evs = (d.events || []).map(e => `<div class="mrow">${date(e.created_at)}<span class="mtag">${esc(e.type)}</span></div>`).join('') || '<div class="field-hint">No events.</div>';
    const servers = (d.servers || []).map(s => { const t = (s.daily||[]).reduce((a,x)=>a+x.checks,0), u = (s.daily||[]).reduce((a,x)=>a+x.up_checks,0); return `<div class="mrow">${esc(s.label || s.url)}<span class="mtag">${t?Math.round(u/t*100):0}% up</span></div>`; }).join('') || '<div class="field-hint">No history.</div>';
    window.openModal(`
      <div class="modal-head"><div><div class="modal-nm">Manage user</div><div class="modal-sub">${(d.subscription&&d.subscription.status)||'none'}</div></div><div class="modal-x" data-close>✕</div></div>
      <div class="modal-tabs"><button class="on" data-mt="act">Activity</button><button data-mt="srv">Servers</button><button data-mt="sub">Subscription</button><button data-mt="pay">Payments</button><button data-mt="acct">Account</button></div>
      <div class="modal-body">
        <div class="mtab on" id="mt-act"><div class="field-hint">Loading activity…</div></div>
        <div class="mtab" id="mt-srv">${servers}</div>
        <div class="mtab" id="mt-sub">
          <div class="field"><div class="field-label">Status</div>
            <select class="input" id="adm-status"><option>none</option><option>active</option><option>cancelled</option><option>past_due</option><option>comped</option></select></div>
          <div class="field"><div class="field-label">Access until (period end)</div><input class="input" id="adm-period" type="datetime-local" /></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-generate" id="adm-save" style="flex:1">Save override</button>
            <button class="btn-soft" id="adm-resync">Re-sync from PayPal</button></div>
          <div class="auth-err" id="adm-msg"></div>
        </div>
        <div class="mtab" id="mt-pay">${pays}</div>
        <div class="mtab" id="mt-acct">
          <div class="mrow">Username<span class="mtag">${esc(d.username || (d.subscription && d.subscription.username) || '—')}</span></div>
          <h3 class="block-title" style="margin-top:14px">Reset password</h3>
          <div style="display:flex;gap:8px"><input class="input" id="adm-pass" type="text" placeholder="new password (min 6)"/><button class="btn-soft" id="adm-pass-btn">Set</button></div>
        </div>
      </div>`);
    const sel = document.getElementById('adm-status'); if (sel && d.subscription) sel.value = d.subscription.status || 'none';
    const post = (path, body) => api('/api/admin/users/' + id + '/' + path, { method: 'POST', body: JSON.stringify(body || {}) });
    const msg = t => { const e = document.getElementById('adm-msg'); if (e) e.textContent = t; };
    document.getElementById('adm-save').onclick = async () => { const pe = document.getElementById('adm-period').value; const r = await post('subscription', { status: sel.value, periodEnd: pe ? new Date(pe).toISOString() : null }); msg(r.status === 200 ? 'Saved' : ((r.body && r.body.error) || 'failed')); if (r.status === 200 && window.toast) window.toast('Subscription updated'); };
    document.getElementById('adm-resync').onclick = async () => { const r = await post('resync'); msg(r.status === 200 ? ('Re-synced: ' + r.body.status) : ((r.body && r.body.error) || 'failed')); };
    document.getElementById('adm-pass-btn').onclick = async () => { const r = await post('password', { password: document.getElementById('adm-pass').value }); msg(r.status === 200 ? 'Password set' : ((r.body && r.body.error) || 'failed')); };
    (async () => {
      const r = await api('/api/admin/users/' + id + '/activity');
      const el = document.getElementById('mt-act'); if (!el) return;
      if (r.status !== 200 || !r.body) { el.innerHTML = '<div class="field-hint">Activity unavailable.</div>'; return; }
      const a = r.body, esc2 = esc;
      const live = (a.live || []).map(s => `<div class="mrow"><span>▶ ${esc2(s.title)} <span class="adm-dim">on ${esc2(s.server)}</span></span><span class="mtag">${esc2(s.user||'')}</span></div>`).join('');
      const recent = (a.recent || []).map(e => `<div class="mrow"><span>${esc2(e.title||'—')}${e.season?` S${e.season}E${e.episode||''}`:''} <span class="adm-dim">· ${esc2(e.server||'—')}</span></span><span class="mtag">${date(e.ts)}</span></div>`).join('') || '<div class="field-hint">No recent activity.</div>';
      el.innerHTML = `<div class="mrow">Totals<span class="mtag">${a.totals.requests24h} (24h) · ${a.totals.requests7d} (7d)</span></div>
        ${a.analytics ? `<div class="mrow">Success rate<span class="mtag">${a.analytics.successRate != null ? a.analytics.successRate + '%' : '—'}</span></div>
        ${a.analytics.topServer ? `<div class="mrow">Most-used server<span class="mtag">${esc2(a.analytics.topServer.server)}</span></div>` : ''}
        ${(a.analytics.topTitles||[]).length ? `<div class="mrow">Top titles<span class="mtag">${esc2(a.analytics.topTitles.map(t=>t.title).slice(0,3).join(', '))}</span></div>` : ''}` : ''}
        ${live ? `<h3 class="block-title" style="margin-top:12px;color:var(--accent)">● Now playing</h3>${live}` : ''}
        <h3 class="block-title" style="margin-top:12px">Recent watches</h3>${recent}`;
    })();
  }

  async function loadCodes() {
    const wrap = $('#admin-codes-list'); if (!wrap) return;
    const r = await api('/api/admin/codes');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = r.body.codes.map(c => `
      <div class="mrow">
        <span><strong>${escU(c.code)}</strong> <span class="mtag">${escU(c.type)}</span> <span class="mtag">${c.uses}${c.max_uses ? '/' + c.max_uses : ''} used</span></span>
        <span><span class="mtag" style="color:${c.active ? 'var(--success)' : 'var(--text-mute)'}">${c.active ? 'active' : 'inactive'}</span>
          ${c.active ? `<button class="btn-soft code-off" data-code="${escU(c.code)}" style="margin-left:8px">Deactivate</button>` : ''}
          <button class="btn-soft code-del" data-code="${escU(c.code)}" style="margin-left:8px;border-color:var(--error,#e05555);color:var(--error,#e05555)">Delete</button></span>
      </div>`).join('') || '<p class="page-sub">No codes yet.</p>';
    wrap.querySelectorAll('.code-off').forEach(btn => btn.addEventListener('click', async () => {
      await api('/api/admin/codes/' + encodeURIComponent(btn.dataset.code) + '/deactivate', { method: 'POST' });
      if (window.toast) window.toast('Code deactivated'); loadCodes();
    }));
    wrap.querySelectorAll('.code-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete code "' + btn.dataset.code + '"? This cannot be undone.')) return;
      await api('/api/admin/codes/' + encodeURIComponent(btn.dataset.code), { method: 'DELETE' });
      if (window.toast) window.toast('Code deleted'); loadCodes();
    }));
  }

  async function loadAudit() {
    const wrap = $('#admin-audit-list'); if (!wrap) return;
    const r = await api('/api/admin/audit');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = '<p class="page-sub">Unable to load activity.</p>'; return; }
    const date = x => x ? new Date(x).toLocaleString() : '—';
    const label = { activated:'Subscription activated', cancelled:'Cancelled', comped:'Comped', code_redeemed:'Code redeemed', payment:'Payment', admin_override:'Admin override', resync:'PayPal re-sync', admin_password_reset:'Password reset' };
    wrap.innerHTML = (r.body.events || []).map(e => {
      const who = e.actor ? escU(e.actor) : 'system';
      const tgt = e.target ? escU(e.target) : '—';
      return `<div class="mrow"><span><strong>${escU(label[e.type] || e.type)}</strong> <span class="adm-dim">· ${tgt}</span></span><span class="mtag">${who} · ${date(e.created_at)}</span></div>`;
    }).join('') || '<p class="page-sub">No activity yet.</p>';
  }

  function wireCodeCreate() {
    const btn = $('#dc-create'); if (!btn || btn._w) return; btn._w = 1;
    btn.addEventListener('click', async () => {
      const code = $('#dc-code').value.trim(); const type = $('#dc-type').value;
      if (!code) { $('#dc-msg').textContent = 'Enter a code'; return; }
      const res = await api('/api/admin/codes', { method: 'POST', body: JSON.stringify({ code, type }) });
      if (res.status === 200) { $('#dc-code').value = ''; $('#dc-msg').textContent = ''; if (window.toast) window.toast('Code created'); loadCodes(); }
      else { $('#dc-msg').textContent = (res.body && res.body.error) || 'Create failed'; }
    });
  }

  function wireAddUser() {
    const btn = $('#nu-create'); if (!btn || btn._w) return; btn._w = 1;
    btn.addEventListener('click', async () => {
      const username = $('#nu-name').value.trim(), password = $('#nu-pass').value, role = $('#nu-role').value;
      if (!username || !password) { $('#nu-msg').textContent = 'Username and password required'; return; }
      const res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
      if (res.status === 200) { $('#nu-name').value = ''; $('#nu-pass').value = ''; $('#nu-msg').textContent = ''; if (window.toast) window.toast('User added'); refreshConsole(); }
      else { $('#nu-msg').textContent = (res.body && res.body.error) || 'Add failed'; }
    });
  }

  const TAB_LABELS = { dashboard:'Dashboard', servers:'Servers', catalogs:'Catalogs', streaming:'Media Sources', appearance:'Media Sources', install:'Install', apikeys:'API Keys', health:'Health', ping:'Ping test', log:'Request log', settings:'Settings', billing:'Billing' };

  async function loadSiteControls() {
    const list = $('#site-tabs-list'); if (!list) return;
    const vs = $('#view-as-switch');
    if (vs) {
      const on = window.MEBSite && window.MEBSite.isViewAs();
      vs.classList.toggle('on', !!on); vs.setAttribute('aria-checked', on ? 'true' : 'false');
      if (!vs._w) { vs._w = 1; vs.addEventListener('click', () => {
        const next = !vs.classList.contains('on');
        vs.classList.toggle('on', next); vs.setAttribute('aria-checked', next ? 'true' : 'false');
        if (window.MEBSite) window.MEBSite.setViewAs(next);
      }); }
    }
    const r = await api('/api/admin/site-config');
    if (r.status !== 200 || !r.body) { list.innerHTML = '<div class="field-hint">Site config unavailable.</div>'; return; }
    const disabled = new Set(r.body.disabledTabs || []);
    const tabs = r.body.toggleable || [];
    list.innerHTML = tabs.map(t => `<div class="field" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
    <span>${escU(TAB_LABELS[t] || t)}</span>
    <button type="button" class="switch site-tab-switch ${disabled.has(t) ? '' : 'on'}" data-tab="${escU(t)}" role="switch" aria-checked="${disabled.has(t) ? 'false' : 'true'}"></button></div>`).join('');
    list.querySelectorAll('.site-tab-switch').forEach(sw => sw.addEventListener('click', async () => {
      const enabled = !sw.classList.contains('on');
      sw.classList.toggle('on', enabled); sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
      const next = tabs.filter(t => {
        const el = list.querySelector(`.site-tab-switch[data-tab="${t}"]`);
        return el && !el.classList.contains('on');
      });
      const res = await api('/api/admin/site-config', { method: 'POST', body: JSON.stringify({ disabledTabs: next }) });
      if (res.status === 200) { if (window.toast) window.toast('Tabs updated'); if (window.MEBSite) await window.MEBSite.refresh(); }
      else if (window.toast) window.toast('Update failed');
    }));
  }

  const fmtDate = x => x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  async function loadNews() {
    const wrap = $('#admin-news-list'); if (!wrap) return;
    wrap.innerHTML = '<div class="tkt-loading">Loading…</div>';
    const r = await api('/api/news');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = '<p class="page-sub">Unable to load news.</p>'; return; }
    const items = r.body;
    if (!items.length) { wrap.innerHTML = '<p class="page-sub" style="margin:0">No news posts yet.</p>'; return; }
    wrap.innerHTML = items.map(n => `
      <div class="adm-news-row">
        <div class="adm-news-row-body">
          <div class="adm-news-row-title">${escU(n.title)}</div>
          ${n.body ? `<div class="adm-news-row-meta">${escU(n.body.slice(0,120))}${n.body.length > 120 ? '…' : ''}</div>` : ''}
          <div class="adm-news-row-meta" style="margin-top:4px">${fmtDate(n.created_at)}</div>
        </div>
        <button class="adm-news-row-del" data-id="${escU(n.id)}">Delete</button>
      </div>`).join('');
    wrap.querySelectorAll('.adm-news-row-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this news post?')) return;
      const res = await api('/api/news/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
      if (res.status === 200) { if (window.toast) window.toast('Post deleted'); loadNews(); }
      else if (window.toast) window.toast('Delete failed');
    }));
  }

  function wireNewsCreate() {
    const btn = $('#news-add-btn'); if (!btn || btn._w) return; btn._w = 1;
    btn.addEventListener('click', async () => {
      const title = ($('#news-title-inp')?.value || '').trim();
      const body = ($('#news-body-inp')?.value || '').trim();
      const msg = $('#news-msg');
      if (!title) { if (msg) msg.textContent = 'Title is required'; return; }
      if (msg) msg.textContent = '';
      btn.disabled = true; btn.textContent = 'Posting…';
      const res = await api('/api/news', { method: 'POST', body: JSON.stringify({ title, body }) });
      btn.disabled = false; btn.textContent = 'Post';
      if (res.status === 200) {
        const ti = $('#news-title-inp'); if (ti) ti.value = '';
        const bi = $('#news-body-inp'); if (bi) bi.value = '';
        if (window.toast) window.toast('News posted');
        loadNews();
      } else {
        if (msg) msg.textContent = (res.body && res.body.error) || 'Failed to post';
      }
    });
  }

  function onRoute() {
    const page = (location.hash || '').replace(/^#\//, '');
    if (page === 'admin') { startMetrics(); loadSiteControls(); stopLivePolling(); stopUsersPolling(); }
    else stopMetrics();
    if (page === 'users') {
      wireChartTabs();
      const refreshBtn = $('#adm-refresh-btn');
      if (refreshBtn && !refreshBtn._w) { refreshBtn._w = 1; refreshBtn.addEventListener('click', refreshConsole); }
      refreshConsole();
      loadCodes(); loadAudit(); wireCodeCreate(); wireAddUser(); loadNews(); wireNewsCreate();
      startLivePolling();
      startUsersPolling();
    } else {
      stopLivePolling();
      stopUsersPolling();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return;
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
    document.querySelectorAll('.nav-group.admin-only').forEach(g => { g.style.display = ''; });
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.acct-manage'); if (!btn) return;
      const r = await api('/api/admin/users/' + btn.dataset.uid + '/detail');
      if (r.status === 200 && r.body) openUserManageModal(btn.dataset.uid, r.body);
    });
    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();