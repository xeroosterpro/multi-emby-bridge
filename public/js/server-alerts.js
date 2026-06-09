// In-app banner when user servers are down for consecutive health checks.
(function () {
  const POLL_MS = 10000;
  let timer = null;

  function esc(t) {
    return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function renderBanner(down, detectionMinutes) {
    let el = document.getElementById('server-down-banner');
    if (!down || !down.length) {
      if (el) el.remove();
      document.documentElement.classList.remove('has-server-down-banner');
      return;
    }
    const names = down.map(d => d.label || d.url).filter(Boolean);
    const mins = detectionMinutes || 3;
    const summary = names.length === 1
      ? `<strong>${esc(names[0])}</strong> has been offline for ${mins}+ minutes`
      : `<strong>${names.length} servers</strong> offline for ${mins}+ minutes — ${esc(names.slice(0, 2).join(', '))}${names.length > 2 ? '…' : ''}`;
    if (!el) {
      el = document.createElement('div');
      el.id = 'server-down-banner';
      el.setAttribute('role', 'alert');
      el.innerHTML = `<span class="sdb-icon" aria-hidden="true">⚠</span>
        <span class="sdb-text"></span>
        <button type="button" class="sdb-link" data-goto="servers">Servers</button>
        <button type="button" class="sdb-dismiss" title="Snooze 1 hour">Dismiss</button>`;
      el.querySelector('.sdb-link').addEventListener('click', () => { location.hash = '#/servers'; });
      el.querySelector('.sdb-dismiss').addEventListener('click', snoozeAlerts);
      document.body.appendChild(el);
    }
    el.querySelector('.sdb-text').innerHTML = summary;
    document.documentElement.classList.add('has-server-down-banner');
    el._down = down;
  }

  async function snoozeAlerts() {
    const el = document.getElementById('server-down-banner');
    const down = (el && el._down) || [];
    if (!down.length) return;
    const until = new Date(Date.now() + 3600000).toISOString();
    const snoozed = {};
    down.forEach(d => { if (d.url) snoozed[d.url.replace(/\/+$/, '')] = until; });
    try {
      const cur = await fetch('/api/user/config', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null);
      const prev = (cur && cur.config && cur.config.alertPrefs && cur.config.alertPrefs.snoozed) || {};
      await fetch('/api/user/config-patch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertPrefs: { snoozed: { ...prev, ...snoozed } } }),
      });
    } catch {}
    renderBanner([]);
  }

  async function poll() {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
      if (!me || !me.user) { renderBanner([]); return; }
      const data = await fetch('/api/user/server-alerts', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null);
      renderBanner(data && data.down, data && data.detectionMinutes);
    } catch {
      renderBanner([]);
    }
  }

  function start() {
    if (timer) return;
    poll();
    timer = setInterval(poll, POLL_MS);
  }

  document.addEventListener('DOMContentLoaded', start);
  document.addEventListener('viewas-changed', () => setTimeout(poll, 200));
})();