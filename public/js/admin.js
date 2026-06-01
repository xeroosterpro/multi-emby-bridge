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
    wrap.innerHTML = r.body.users.map(u => `
      <div class="mrow" data-uid="${u.id}">
        <span><strong>${u.username}</strong> <span class="mtag">${u.role}</span></span>
        <button class="btn-soft acct-role" data-uid="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">
          ${u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
        </button>
      </div>`).join('');
    wrap.querySelectorAll('.acct-role').forEach(btn => btn.addEventListener('click', async () => {
      const res = await api('/api/admin/users/' + btn.dataset.uid + '/role', { method: 'POST', body: JSON.stringify({ role: btn.dataset.role }) });
      if (res.status === 200) { if (window.toast) window.toast('Role updated'); loadUsers(); }
      else if (window.toast) window.toast((res.body && res.body.error) || 'Failed');
    }));
  }

  function onRoute() {
    const page = (location.hash || '').replace(/^#\//, '');
    if (page === 'admin') startMetrics(); else stopMetrics();
    if (page === 'users') loadUsers();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || me.body.user?.role !== 'admin') return; // not an admin → admin pages stay hidden
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
    window.addEventListener('hashchange', onRoute);
    onRoute();
  });
})();
