// ─── Admin panel: reveals System + Users pages for admins; polls /api/metrics;
// lists/manages users. Non-destructive; uses hashchange (does not touch onPageShow).
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
  const escU = x => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtAgo = x => { if(!x) return 'never'; const d=Date.now()-new Date(x).getTime(); const h=Math.floor(d/3600000); if(h<1) return 'just now'; if(h<24) return h+'h ago'; return Math.floor(h/24)+'d ago'; };
  const statusPill = s => `<span class="pay-status ${s==='active'||s==='comped'?'completed':(s==='past_due'?'refunded':'failed')}">${escU(s)}</span>`;

  async function loadOverview() {
    const wrap = $('#adm-overview'); if (!wrap) return;
    if (!wrap.dataset.loaded) wrap.innerHTML = Array(4).fill('<div class="adm-card skel"><div class="skel-line lg"></div><div class="skel-line"></div></div>').join('');
    const r = await api('/api/admin/overview');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = ''; return; }
    const o = r.body, money = n => '$' + Number(n||0).toFixed(0);
    wrap.innerHTML = `
      <div class="adm-card"><div class="adm-card-n">${o.users.total}</div><div class="adm-card-l">Users · ${o.users.active} active · ${o.users.comped} comped</div></div>
      <div class="adm-card"><div class="adm-card-n">${money(o.revenue.monthly)}</div><div class="adm-card-l">Revenue (30d) · ${money(o.revenue.lifetime)} lifetime</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.activity.requests24h}</div><div class="adm-card-l">Stream requests (24h)</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.activity.busiestServer?escU(o.activity.busiestServer.server):'—'}</div><div class="adm-card-l">Busiest server (24h)</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.successRate != null ? o.successRate + '%' : '—'}</div><div class="adm-card-l">Stream success (24h)</div></div>
      <div class="adm-card"><div class="adm-card-n">${o.upcomingRenewals ?? 0}</div><div class="adm-card-l">Renewals (next 7d)${o.failedPayments ? ' · ' + o.failedPayments + ' failed' : ''}</div></div>`;
    wrap.dataset.loaded = '1';
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
      sort === 'newest' ? ts(b.created_at) - ts(a.created_at) :
      ts(b.last_seen_at) - ts(a.last_seen_at));
    const PER = 25;
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    if (_adminPage >= pages) _adminPage = pages - 1;
    const pageRows = rows.slice(_adminPage * PER, _adminPage * PER + PER);
    tbody.innerHTML = pageRows.map(u => `<tr data-uid="${u.id}">
      <td><div class="adm-user"><span class="adm-avatar">${escU((u.username||'?')[0].toUpperCase())}</span><span><strong>${escU(u.username)}</strong><span class="adm-role">${escU(u.role)}</span></span></div></td>
      <td>${statusPill(u.sub_status)}</td>
      <td class="adm-dim">${fmtAgo(u.last_seen_at)}</td>
      <td class="adm-dim">${u.server_count||0}</td>
      <td><button class="btn-soft acct-manage" data-uid="${u.id}">Manage</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="log-empty">No users match your filters.</td></tr>';
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
    loadOverview();
    const tb = $('#adm-users-rows');
    if (tb && !_adminUsers.length) tb.innerHTML = Array(4).fill('<tr class="skel-row"><td colspan="5"><div class="skel-line"></div></td></tr>').join('');
    const r = await api('/api/admin/users');
    if (r.status !== 200 || !r.body) { const t=$('#adm-users-rows'); if(t) t.innerHTML='<tr><td colspan="5">Unable to load users.</td></tr>'; return; }
    _adminUsers = r.body.users || [];
    renderUsersTable();
    ['adm-search','adm-filter','adm-sort'].forEach(id => { const el=document.getElementById(id); if(el&&!el._w){ el._w=1; const h=()=>{ _adminPage=0; renderUsersTable(); }; el.addEventListener('input', h); el.addEventListener('change', h); } });
  }

  function openUserManageModal(id, d) {
    if (!window.openModal) return;
    const esc = x => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const money = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—');
    const date = x => x ? new Date(x).toLocaleString() : '—';
    const pays = (d.payments || []).map(p => `<div class="mrow">${date(p.paid_at)}<span class="mtag">${money(p)} · ${esc(p.status)}</span></div>`).join('') || '<div class="field-hint">No payments.</div>';
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
      if (res.status === 200) { $('#nu-name').value = ''; $('#nu-pass').value = ''; $('#nu-msg').textContent = ''; if (window.toast) window.toast('User added'); loadUsers(); }
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
        return el && !el.classList.contains('on'); // not-on => disabled
      });
      const res = await api('/api/admin/site-config', { method: 'POST', body: JSON.stringify({ disabledTabs: next }) });
      if (res.status === 200) { if (window.toast) window.toast('Tabs updated'); if (window.MEBSite) await window.MEBSite.refresh(); }
      else if (window.toast) window.toast('Update failed');
    }));
  }

  // ── News management (admin section on users page) ──────────────────────────
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
    if (page === 'admin') { startMetrics(); loadSiteControls(); } else stopMetrics();
    if (page === 'users') { loadUsers(); loadCodes(); loadAudit(); wireCodeCreate(); wireAddUser(); loadNews(); wireNewsCreate(); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return; // not an admin → admin pages stay hidden
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
    // Make sure the Administration group (and its toggle) is visible as a unit
    document.querySelectorAll('.nav-group.admin-only').forEach(g => { g.style.display = ''; });
    // delegated: open the manage modal for any user row's Manage button
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.acct-manage'); if (!btn) return;
      const r = await api('/api/admin/users/' + btn.dataset.uid + '/detail');
      if (r.status === 200 && r.body) openUserManageModal(btn.dataset.uid, r.body);
    });
    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();
