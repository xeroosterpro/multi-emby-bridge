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
    if ($('#m-cpu')) $('#m-cpu').textContent = (m.cpuPercent ?? '—') + '%';
    if ($('#m-ram')) $('#m-ram').textContent = (m.sysMemPct ?? '—') + '%';
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
          <button class="btn-soft acct-role" data-uid="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Demote' : 'Make admin'}</button>
          <button class="btn-soft acct-comp" data-uid="${u.id}" data-act="${comped ? 'uncomp' : 'comp'}">${comped ? 'Remove access' : 'Comp access'}</button>
        </span>
      </div>`;
    }).join('');
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

  function onRoute() {
    const page = (location.hash || '').replace(/^#\//, '');
    if (page === 'admin') startMetrics(); else stopMetrics();
    if (page === 'users') { loadUsers(); loadCodes(); wireCodeCreate(); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return; // not an admin → admin pages stay hidden
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();
