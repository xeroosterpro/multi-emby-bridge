(function () {
  const MAX = 64;
  const IDLE_MS = 14000;
  const ROUTINE_DEDUPE_MS = 45000;

  let lines = [];
  let idleTimer = null;
  let collapsed = true;
  let filter = 'all';
  let seenErrors = new Map();
  let lastRoutine = { live: null, conn: null, health: null, stats: null };

  const LEVEL_META = {
    busy: { label: 'RUN', short: '…' },
    ok: { label: 'OK', short: '✓' },
    info: { label: 'INFO', short: 'i' },
    warn: { label: 'WARN', short: '!' },
    err: { label: 'ERR', short: '×' },
  };

  function fmtTime() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function esc(x) {
    return (typeof window.escHtml === 'function') ? window.escHtml(x) : String(x ?? '');
  }

  function pageActive() {
    const page = document.getElementById('page-dashboard');
    return !!(page && (page.classList.contains('on') || (location.hash || '').includes('dashboard')));
  }

  function parseMsg(msg) {
    const m = String(msg || '');
    const err = m.match(/^((?:connection|library|stats|live|health|bundle)[^·]*)\s*·\s*([^—]+)\s*—\s*(.+)$/i);
    if (err) return { tag: err[1].trim(), who: err[2].trim(), detail: err[3].trim() };
    const scope = m.match(/^Bundle\s*·\s*scope=(\w+)/i);
    if (scope) return { tag: 'bundle', who: scope[1], detail: m };
    const refresh = m.match(/^Refreshing\s*·\s*scope=(\w+)/i);
    if (refresh) return { tag: 'poll', who: refresh[1], detail: m };
    return { tag: null, who: null, detail: m };
  }

  function counts() {
    const c = { all: lines.length, err: 0, warn: 0, info: 0 };
    for (const l of lines) {
      if (l.level === 'err') c.err++;
      else if (l.level === 'warn') c.warn++;
      else if (l.level === 'info' || l.level === 'ok') c.info++;
    }
    return c;
  }

  function filtered() {
    if (filter === 'all') return lines;
    if (filter === 'err') return lines.filter(l => l.level === 'err' || l.level === 'warn');
    if (filter === 'info') return lines.filter(l => l.level === 'info' || l.level === 'ok' || l.level === 'busy');
    return lines;
  }

  function lastLine() {
    return lines.length ? lines[lines.length - 1] : null;
  }

  function setCollapsed(next) {
    collapsed = !!next;
    const root = document.getElementById('dash-console');
    const toggle = document.getElementById('dash-console-toggle');
    if (root) root.classList.toggle('collapsed', collapsed);
    const head = document.getElementById('dash-console-head');
    if (toggle) {
      toggle.textContent = collapsed ? '+' : '−';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.title = collapsed ? 'Expand log' : 'Collapse log';
    }
    if (head) head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    paintPreview();
  }

  function paintPreview() {
    const preview = document.getElementById('dash-console-preview');
    if (!preview) return;
    const last = lastLine();
    if (!last) {
      preview.textContent = 'Waiting for backend events…';
      preview.classList.add('dash-console-preview-idle');
      return;
    }
    preview.classList.remove('dash-console-preview-idle');
    const parsed = parseMsg(last.msg);
    const who = parsed.who ? `${parsed.who} — ` : '';
    preview.textContent = `${who}${parsed.detail}`;
  }

  function paintFilters() {
    const c = counts();
    const root = document.getElementById('dash-console-filters');
    if (!root) return;
    root.querySelectorAll('[data-filter]').forEach(btn => {
      const f = btn.getAttribute('data-filter');
      const n = f === 'all' ? c.all : f === 'err' ? c.err + c.warn : c.info;
      const countEl = btn.querySelector('.dash-console-filter-n');
      if (countEl) countEl.textContent = n > 0 ? String(n) : '';
      btn.classList.toggle('active', filter === f);
      btn.setAttribute('aria-pressed', filter === f ? 'true' : 'false');
    });
  }

  function paint() {
    const log = document.getElementById('dash-console-log');
    const status = document.getElementById('dash-console-status');
    const root = document.getElementById('dash-console');
    const countEl = document.getElementById('dash-console-count');
    if (!log) return;

    const busy = lines.some(l => l.level === 'busy');
    const c = counts();
    if (status) {
      status.textContent = busy ? 'Working…' : (c.err ? `${c.err} issue${c.err === 1 ? '' : 's'}` : 'Ready');
      status.dataset.state = busy ? 'busy' : (c.err ? 'err' : 'ready');
    }
    if (root) {
      root.classList.toggle('dash-console-idle', !busy && !c.err);
      root.classList.toggle('dash-console-has-err', c.err > 0);
    }
    if (countEl) countEl.textContent = String(c.all);

    const rows = filtered();
    if (!rows.length) {
      log.innerHTML = '<div class="dash-console-empty">No lines match this filter.</div>';
    } else {
      log.innerHTML = rows.map(l => {
        const meta = LEVEL_META[l.level] || LEVEL_META.info;
        const parsed = parseMsg(l.msg);
        const tag = parsed.tag
          ? `<span class="dash-console-tag">${esc(parsed.tag)}</span>`
          : '';
        const who = parsed.who
          ? `<span class="dash-console-who">${esc(parsed.who)}</span>`
          : '';
        const detail = esc(parsed.detail || l.msg);
        return `<div class="dash-console-line dash-console-${l.level}">` +
          `<span class="dash-console-ts" title="${esc(l.time)}">${esc(l.time)}</span>` +
          `<span class="dash-console-lvl" aria-label="${meta.label}">${meta.short}</span>` +
          `<span class="dash-console-bodyline">${tag}${who}<span class="dash-console-msg">${detail}</span></span>` +
          `</div>`;
      }).join('');
    }
    log.scrollTop = log.scrollHeight;
    paintFilters();
    paintPreview();
  }

  function pushLine(msg, level = 'info', opts = {}) {
    if (!pageActive()) return;
    const root = document.getElementById('dash-console');
    if (root) {
      root.hidden = false;
      root.classList.remove('dash-console-idle');
    }
    if (!opts.force) {
      const prev = lines[lines.length - 1];
      if (prev && prev.msg === msg && prev.level === level) return;
    }
    lines.push({ time: fmtTime(), msg, level });
    if (lines.length > MAX) lines.shift();
    paint();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const status = document.getElementById('dash-console-status');
      const c = counts();
      if (status) {
        status.textContent = c.err ? `${c.err} issue${c.err === 1 ? '' : 's'}` : 'Idle';
        status.dataset.state = c.err ? 'err' : 'idle';
      }
      document.getElementById('dash-console')?.classList.add('dash-console-idle');
    }, IDLE_MS);
  }

  function shouldLogRoutine(key, signature) {
    const now = Date.now();
    const prev = lastRoutine[key];
    if (prev && prev.sig === signature && (now - prev.ts) < ROUTINE_DEDUPE_MS) return false;
    lastRoutine[key] = { sig: signature, ts: now };
    return true;
  }

  function logErrorOnce(part, server, message) {
    const key = `${part}|${server}|${message}`;
    const prev = seenErrors.get(key);
    if (prev) {
      prev.count++;
      prev.last = fmtTime();
      const row = document.querySelector(`[data-err-key="${CSS.escape(key)}"]`);
      if (row) {
        const rep = row.querySelector('.dash-console-repeat');
        if (rep) rep.textContent = `×${prev.count}`;
      }
      return;
    }
    seenErrors.set(key, { count: 1, first: fmtTime(), last: fmtTime() });
    const who = server ? `${part} · ${server}` : part;
    pushLine(`${who} — ${message}`, 'err', { force: true });
    const log = document.getElementById('dash-console-log');
    const lastRow = log?.lastElementChild;
    if (lastRow) lastRow.dataset.errKey = key;
    const body = lastRow?.querySelector('.dash-console-bodyline');
    if (body) {
      const rep = document.createElement('span');
      rep.className = 'dash-console-repeat';
      rep.textContent = '×1';
      body.appendChild(rep);
    }
  }

  function log(msg, level = 'info') {
    pushLine(msg, level);
  }

  function start(msg) {
    lines = [];
    seenErrors.clear();
    lastRoutine = { live: null, conn: null, health: null, stats: null };
    const root = document.getElementById('dash-console');
    const logEl = document.getElementById('dash-console-log');
    if (root) {
      root.hidden = false;
      root.classList.remove('dash-console-idle');
    }
    if (logEl) logEl.innerHTML = '';
    setCollapsed(true);
    log(msg || 'Dashboard load started', 'busy');
  }

  function clear() {
    lines = [];
    seenErrors.clear();
    paint();
  }

  function logBundle(bundle, opts = {}) {
    if (!bundle) return;
    const scope = opts.scope || bundle.scope || 'full';

    if (scope === 'live') {
      const liveN = Array.isArray(bundle.live) ? bundle.live.length : 0;
      const sig = `live:${liveN}`;
      if (!shouldLogRoutine('live', sig)) return;
      log(`Live · ${liveN} active stream(s)`, liveN ? 'ok' : 'info');
      return;
    }

    if (scope === 'conn') {
      const t = bundle.totals || {};
      const sig = `conn:${t.serversUp}/${t.serversTotal}`;
      if (shouldLogRoutine('conn', sig)) {
        log(`Reachability · ${t.serversUp}/${t.serversTotal} up`, 'info');
      }
      const errList = Array.isArray(opts.errors) ? opts.errors : (bundle.errors || []);
      for (const err of errList) {
        if (err.part !== 'connection') continue;
        logErrorOnce(err.part, err.server || '', err.message || 'failed');
      }
      return;
    }

    if (scope === 'health') {
      const sig = `health:${(bundle.health || []).length}`;
      if (shouldLogRoutine('health', sig)) {
        log(`Health · ${bundle.serverCount || 0} target(s) refreshed`, 'ok');
      }
      return;
    }

    if (scope === 'stats' || scope === 'full') {
      const t = bundle.totals || {};
      const sig = `stats:${t.serversUp}/${t.serversTotal}:${t.movies}`;
      if (shouldLogRoutine('stats', sig)) {
        log(`Totals · ${t.serversUp}/${t.serversTotal} up · ${(t.movies || 0).toLocaleString()} movies`, 'info');
      }
    }

    if (scope === 'full') {
      const liveN = Array.isArray(bundle.live) ? bundle.live.length : 0;
      log(`Live · ${liveN} active stream(s)`, liveN ? 'ok' : 'info');
    }

    const errParts = scope === 'stats' ? new Set(['library', 'connection', 'stats'])
      : scope === 'full' ? null : new Set();
    const errList = Array.isArray(opts.errors) ? opts.errors : (bundle.errors || []);
    for (const err of errList) {
      if (errParts && !errParts.has(err.part)) continue;
      logErrorOnce(err.part || 'error', err.server || '', err.message || 'failed');
    }
  }

  function wireUi() {
    const toggle = document.getElementById('dash-console-toggle');
    if (toggle && !toggle.dataset.wired) {
      toggle.dataset.wired = '1';
      toggle.addEventListener('click', () => setCollapsed(!collapsed));
    }
    const head = document.getElementById('dash-console-head');
    if (head && !head.dataset.wired) {
      head.dataset.wired = '1';
      head.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        setCollapsed(!collapsed);
      });
    }
    const clearBtn = document.getElementById('dash-console-clear');
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clear(); });
    }
    const filters = document.getElementById('dash-console-filters');
    if (filters && !filters.dataset.wired) {
      filters.dataset.wired = '1';
      filters.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        e.stopPropagation();
        filter = btn.getAttribute('data-filter') || 'all';
        paint();
      });
    }
    setCollapsed(true);
    paint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUi);
  } else {
    wireUi();
  }

  window.DashboardConsole = { start, log, logBundle, clear, setCollapsed };
})();