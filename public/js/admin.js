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

  async function loadUsers() {
    const wrap = $('#admin-users-list'); if (!wrap) return;
    const r = await api('/api/admin/users');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = '<p class="page-sub">Unable to load users.</p>'; return; }
    wrap.innerHTML = r.body.users.map(u => {
      const comped = u.sub_status === 'comped' || u.sub_status === 'active';
      return `<div class="mrow" data-uid="${u.id}">
        <span><strong>${u.username}</strong> <span class="mtag">${u.role}</span>${comped ? ' <span class="mtag" style="color:var(--success)">● ' + u.sub_status + '</span>' : ''}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-soft acct-manage" data-uid="${u.id}">Manage</button>
          <button class="btn-soft acct-role" data-uid="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Demote' : 'Make admin'}</button>
          <button class="btn-soft acct-comp" data-uid="${u.id}" data-act="${comped ? 'uncomp' : 'comp'}">${comped ? 'Remove access' : 'Comp access'}</button>
          <button class="btn-soft acct-del" data-uid="${u.id}" data-name="${u.username}" style="border-color:var(--error,#e05555);color:var(--error,#e05555)">Delete</button>
        </span>
      </div>`;
    }).join('');
    wrap.querySelectorAll('.acct-del').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete user "' + btn.dataset.name + '"? This cannot be undone.')) return;
      const res = await api('/api/admin/users/' + btn.dataset.uid, { method: 'DELETE' });
      if (res.status === 200) { if (window.toast) window.toast('User deleted'); loadUsers(); }
      else if (window.toast) window.toast((res.body && res.body.error) || 'Failed');
    }));
    wrap.querySelectorAll('.acct-role').forEach(btn => btn.addEventListener('click', async () => {
      const res = await api('/api/admin/users/' + btn.dataset.uid + '/role', { method: 'POST', body: JSON.stringify({ role: btn.dataset.role }) });
      if (res.status === 200) { if (window.toast) window.toast('Role updated'); loadUsers(); }
      else if (window.toast) window.toast((res.body && res.body.error) || 'Failed');
    }));
    wrap.querySelectorAll('.acct-comp').forEach(btn => btn.addEventListener('click', async () => {
      const res = await api('/api/admin/users/' + btn.dataset.uid + '/' + btn.dataset.act, { method: 'POST' });
      if (res.status === 200) { if (window.toast) window.toast(btn.dataset.act === 'comp' ? 'Access granted' : 'Access removed'); loadUsers(); }
      else if (window.toast) window.toast((res.body && res.body.error) || 'Failed');
    }));
    wrap.querySelectorAll('.acct-manage').forEach(btn => btn.addEventListener('click', async () => {
      const r = await api('/api/admin/users/' + btn.dataset.uid + '/detail');
      if (r.status === 200 && r.body) openUserManageModal(btn.dataset.uid, r.body);
    }));
  }

  function openUserManageModal(id, d) {
    if (!window.openModal) return;
    const money = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—');
    const date = x => x ? new Date(x).toLocaleString() : '—';
    const pays = (d.payments || []).map(p => `<div class="mrow">${date(p.paid_at)}<span class="mtag">${money(p)} · ${p.status}</span></div>`).join('') || '<div class="field-hint">No payments.</div>';
    const evs = (d.events || []).map(e => `<div class="mrow">${date(e.created_at)}<span class="mtag">${e.type}</span></div>`).join('') || '<div class="field-hint">No events.</div>';
    const servers = (d.servers || []).map(s => { const t = (s.daily||[]).reduce((a,x)=>a+x.checks,0), u = (s.daily||[]).reduce((a,x)=>a+x.up_checks,0); return `<div class="mrow">${s.label || s.url}<span class="mtag">${t?Math.round(u/t*100):0}% up</span></div>`; }).join('') || '<div class="field-hint">No history.</div>';
    window.openModal(`
      <div class="modal-head"><div><div class="modal-nm">Manage user</div><div class="modal-sub">${(d.subscription&&d.subscription.status)||'none'}</div></div><div class="modal-x" data-close>✕</div></div>
      <div class="modal-tabs"><button class="on" data-mt="sub">Subscription</button><button data-mt="pay">Payments</button><button data-mt="act">Activity</button><button data-mt="srv">Servers</button></div>
      <div class="modal-body">
        <div class="mtab on" id="mt-sub">
          <div class="field"><div class="field-label">Status</div>
            <select id="adm-status"><option>none</option><option>active</option><option>cancelled</option><option>past_due</option><option>comped</option></select></div>
          <div class="field"><div class="field-label">Access until (period end)</div><input class="input" id="adm-period" type="datetime-local" /></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-generate" id="adm-save" style="flex:1">Save override</button>
            <button class="btn-soft" id="adm-resync">Re-sync from PayPal</button></div>
          <h3 class="block-title" style="margin-top:16px">Reset password</h3>
          <div style="display:flex;gap:8px"><input class="input" id="adm-pass" type="text" placeholder="new password (min 6)"/><button class="btn-soft" id="adm-pass-btn">Set</button></div>
          <div class="auth-err" id="adm-msg"></div>
        </div>
        <div class="mtab" id="mt-pay">${pays}</div>
        <div class="mtab" id="mt-act">${evs}</div>
        <div class="mtab" id="mt-srv">${servers}</div>
      </div>`);
    const sel = document.getElementById('adm-status'); if (sel && d.subscription) sel.value = d.subscription.status || 'none';
    const post = (path, body) => api('/api/admin/users/' + id + '/' + path, { method: 'POST', body: JSON.stringify(body || {}) });
    const msg = t => { const e = document.getElementById('adm-msg'); if (e) e.textContent = t; };
    document.getElementById('adm-save').onclick = async () => { const pe = document.getElementById('adm-period').value; const r = await post('subscription', { status: sel.value, periodEnd: pe ? new Date(pe).toISOString() : null }); msg(r.status === 200 ? 'Saved' : ((r.body && r.body.error) || 'failed')); if (r.status === 200 && window.toast) window.toast('Subscription updated'); };
    document.getElementById('adm-resync').onclick = async () => { const r = await post('resync'); msg(r.status === 200 ? ('Re-synced: ' + r.body.status) : ((r.body && r.body.error) || 'failed')); };
    document.getElementById('adm-pass-btn').onclick = async () => { const r = await post('password', { password: document.getElementById('adm-pass').value }); msg(r.status === 200 ? 'Password set' : ((r.body && r.body.error) || 'failed')); };
  }

  async function loadCodes() {
    const wrap = $('#admin-codes-list'); if (!wrap) return;
    const r = await api('/api/admin/codes');
    if (r.status !== 200 || !r.body) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = r.body.codes.map(c => `
      <div class="mrow">
        <span><strong>${c.code}</strong> <span class="mtag">${c.type}</span> <span class="mtag">${c.uses}${c.max_uses ? '/' + c.max_uses : ''} used</span></span>
        <span><span class="mtag" style="color:${c.active ? 'var(--success)' : 'var(--text-mute)'}">${c.active ? 'active' : 'inactive'}</span>
          ${c.active ? `<button class="btn-soft code-off" data-code="${c.code}" style="margin-left:8px">Deactivate</button>` : ''}</span>
      </div>`).join('') || '<p class="page-sub">No codes yet.</p>';
    wrap.querySelectorAll('.code-off').forEach(btn => btn.addEventListener('click', async () => {
      await api('/api/admin/codes/' + encodeURIComponent(btn.dataset.code) + '/deactivate', { method: 'POST' });
      if (window.toast) window.toast('Code deactivated'); loadCodes();
    }));
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

  function onRoute() {
    const page = (location.hash || '').replace(/^#\//, '');
    if (page === 'admin') startMetrics(); else stopMetrics();
    if (page === 'users') { loadUsers(); loadCodes(); wireCodeCreate(); wireAddUser(); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return; // not an admin → admin pages stay hidden
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();
