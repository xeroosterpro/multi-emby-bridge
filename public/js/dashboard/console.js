(function () {
  const MAX = 48;
  const IDLE_MS = 14000;
  let lines = [];
  let idleTimer = null;

  function fmtTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function pageActive() {
    const page = document.getElementById('page-dashboard');
    return !!(page && (page.classList.contains('on') || (location.hash || '').includes('dashboard')));
  }

  function esc(x) {
    return (typeof window.escHtml === 'function') ? window.escHtml(x) : String(x ?? '');
  }

  function paint() {
    const log = document.getElementById('dash-console-log');
    const status = document.getElementById('dash-console-status');
    const root = document.getElementById('dash-console');
    if (!log) return;
    const busy = lines.some(l => l.level === 'busy');
    if (status) status.textContent = busy ? 'Working…' : 'Ready';
    if (root) root.classList.toggle('dash-console-idle', !busy);
    log.innerHTML = lines.map(l =>
      `<div class="dash-console-line dash-console-${l.level}"><span class="dash-console-ts">${esc(l.time)}</span><span class="dash-console-msg">${esc(l.msg)}</span></div>`
    ).join('');
    log.scrollTop = log.scrollHeight;
  }

  function log(msg, level = 'info') {
    if (!pageActive()) return;
    const root = document.getElementById('dash-console');
    if (root) {
      root.hidden = false;
      root.classList.remove('dash-console-idle');
    }
    lines.push({ time: fmtTime(), msg, level });
    if (lines.length > MAX) lines.shift();
    paint();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const status = document.getElementById('dash-console-status');
      if (status) status.textContent = 'Idle';
      document.getElementById('dash-console')?.classList.add('dash-console-idle');
    }, IDLE_MS);
  }

  function start(msg) {
    lines = [];
    const root = document.getElementById('dash-console');
    const body = document.getElementById('dash-console-body');
    const logEl = document.getElementById('dash-console-log');
    if (root) {
      root.hidden = false;
      root.classList.add('collapsed');
      root.classList.remove('dash-console-idle');
    }
    if (body) body.hidden = false;
    if (logEl) logEl.innerHTML = '';
    const toggle = document.getElementById('dash-console-toggle');
    if (toggle) { toggle.textContent = '+'; toggle.setAttribute('aria-expanded', 'false'); toggle.title = 'Expand log'; }
    log(msg || 'Dashboard load started', 'busy');
  }

  function logBundle(bundle, opts = {}) {
    if (!bundle) return;
    const scope = opts.scope || bundle.scope || 'full';
    log(`Bundle · scope=${scope} · ${bundle.serverCount || 0} server(s)`, 'ok');
    if (scope === 'health') return;

    if (scope === 'conn') {
      const t = bundle.totals || {};
      if (t.serversTotal != null) {
        log(`Reachability · ${t.serversUp}/${t.serversTotal} up`, 'info');
      }
      const errList = Array.isArray(opts.errors) ? opts.errors : (bundle.errors || []);
      for (const err of errList) {
        if (err.part !== 'connection') continue;
        const who = err.server ? `${err.part} · ${err.server}` : err.part;
        log(`${who} — ${err.message}`, 'err');
      }
      return;
    }

    const liveN = Array.isArray(bundle.live) ? bundle.live.length : 0;
    if (scope === 'live') {
      log(`Live · ${liveN} active stream(s)`, liveN ? 'ok' : 'info');
      return;
    }

    const t = bundle.totals || {};
    if (scope === 'stats' || scope === 'full') {
      if (t.serversTotal) {
        log(`Totals · ${t.serversUp}/${t.serversTotal} up · ${(t.movies || 0).toLocaleString()} movies`, 'info');
      }
    }
    if (scope === 'full') {
      log(`Live · ${liveN} active stream(s)`, liveN ? 'ok' : 'info');
    }
    const errParts = scope === 'stats' ? new Set(['library', 'connection', 'stats'])
      : scope === 'full' ? null : new Set();
    const errList = Array.isArray(opts.errors) ? opts.errors : (bundle.errors || []);
    for (const err of errList) {
      if (errParts && !errParts.has(err.part)) continue;
      const who = err.server ? `${err.part} · ${err.server}` : err.part;
      log(`${who} — ${err.message}`, 'err');
    }
  }

  window.DashboardConsole = { start, log, logBundle };
})();