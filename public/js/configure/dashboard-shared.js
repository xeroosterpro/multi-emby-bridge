// configure/dashboard-shared.js — console, ping dots, dash header helpers
function _dashServerLabel(s) {
  return String(s?.label || '').trim() || String(s?.url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'server';
}

function dashConsoleLog(msg, level = 'info') {
  if (window.DashboardConsole?.log) window.DashboardConsole.log(msg, level);
}

function dashConsoleStart(msg) {
  if (window.DashboardConsole?.start) window.DashboardConsole.start(msg);
}
let _renderDashboardChain = Promise.resolve();
let _activityFetchPromise = null;

const _PLACEHOLDER_SERVER_RE = /emby\.cloud\.example\.com|jellyfin\.home\.lab(?::8096)?|192\.168\.1\.42(?::8096)?/i;

function _isPlaceholderServer(server) {
  if (!server) return false;
  const label = String(server.label || '').trim();
  if (label === 'Cloud Emby' || label === 'Home Jellyfin' || label === 'Backup NAS') return true;
  return _PLACEHOLDER_SERVER_RE.test(String(server.url || ''));
}

function _allowBrowserSessionProbe(server) {
  if (window.MEBDemo?.isActive?.()) return false;
  if (_isPlaceholderServer(server)) return false;
  return true;
}

function _dashHealthPanel(history) {
  if (window.HealthWidgets && typeof window.HealthWidgets.buildMiniHealthPanel === 'function') {
    return window.HealthWidgets.buildMiniHealthPanel(history, { range: '24h', compact: true });
  }
  return '<div class="gcard-health-empty">Health charts loading…</div>';
}

function _paintPingDots(card, hist = []) {
  if (!card) return;
  let cont = card.querySelector('.gcard-ping-dots');
  const pad = card.querySelector('.gcard-pad');
  if (!cont && pad) {
    cont = document.createElement('div');
    cont.className = 'gcard-ping-dots';
    cont.setAttribute('aria-hidden', 'true');
    // place after chips, before health or status log for perfect visual flow
    const chips = pad.querySelector('.gchips');
    const after = chips ? chips.nextSibling : pad.firstChild;
    pad.insertBefore(cont, after && after.nextSibling ? after.nextSibling : null);
  }
  if (!cont) return;
  const recent = (Array.isArray(hist) ? hist : []).slice(0, 12).reverse(); // left=older, right=newest
  if (!recent.length) {
    cont.innerHTML = '<span class="pd na" style="flex:1"></span>'.repeat(6);
    return;
  }
  cont.innerHTML = recent.map(h => {
    if (!h) return '<span class="pd na" title="no data"></span>';
    let cls = 'ok';
    if (h.up === false) cls = 'down';
    else if (h.ms != null && h.ms > 800) cls = 'slow';
    const t = h.ts ? new Date(h.ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    const val = h.ms != null ? `${h.ms}ms` : '';
    return `<span class="pd pd-${cls}" title="${t} ${val}"></span>`;
  }).join('');
}

function _paintPingsForCard(card, healthByUrl) {
  if (!card || !healthByUrl) return;
  const url = card.dataset.serverUrl;
  const rec = healthByUrl[_normServerUrl(url)] || {};
  _paintPingDots(card, rec.history || []);
}

function updateDashLastSync(relative = 'just now') {
  const el = document.getElementById('dash-last-sync');
  if (el) el.textContent = relative;
}

function startDashTimestampTicker() {
  clearInterval(window._dashTickTimer);
  window._dashTickTimer = setInterval(() => {
    const onDash = document.getElementById('page-dashboard')?.classList.contains('on');
    if (!onDash) return;
    // simple relative for header; per-card absolute in logs are fine + health viz tells story
    const last = window._lastDashSyncTs || Date.now();
    const ago = Math.max(0, Math.floor((Date.now() - last) / 1000));
    let txt = 'just now';
    if (ago > 90) txt = Math.floor(ago / 60) + 'm ago';
    else if (ago > 25) txt = ago + 's ago';
    updateDashLastSync(txt);
  }, 15000);
}

/* ===== Next-level amazing: count-up, interactive history, persist, fleet pulse ===== */
function animateNumber(el, newVal, duration = 480) {
  if (!el) return;
  const clean = (s) => parseInt(String(s || '0').replace(/[^\d-]/g, '')) || 0;
  const start = clean(el.textContent);
  const end = clean(newVal);
  if (start === end) {
    el.textContent = newVal;
    return;
  }
  const startTs = performance.now();
  const tick = (ts) => {
    const p = Math.min((ts - startTs) / duration, 1);
    const eased = p < .5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
    const cur = Math.round(start + (end - start) * eased);
    el.textContent = cur.toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = (typeof newVal === 'string' ? newVal : end.toLocaleString());
  };
  requestAnimationFrame(tick);
}

function _setDashNumber(elOrId, val) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  animateNumber(el, val);
  const parent = el.closest('.tile, .gchip');
  if (parent) {
    parent.classList.add('just-updated');
    setTimeout(() => parent.classList.remove('just-updated'), 700);
  }
}

function _updateFleetPulse() {
  const pulse = document.getElementById('dash-fleet-pulse');
  if (!pulse) return;
  const cards = document.querySelectorAll('#dash-cards .gcard');
  if (!cards.length) { pulse.textContent = ''; return; }
  let healthy = 0;
  cards.forEach(c => {
    const p = c.querySelector('.gpill');
    if (p && (p.classList.contains('online') || p.classList.contains('reachable'))) healthy++;
  });
  pulse.textContent = `${healthy}/${cards.length} healthy`;
  pulse.style.display = 'inline-block';
}

function _wirePingDotInteractions() {
  const wrap = document.getElementById('dash-cards');
  if (!wrap) return;
  wrap.querySelectorAll('.gcard-ping-dots').forEach(dotsEl => {
    if (dotsEl._wiredInteractive) return;
    dotsEl._wiredInteractive = true;
    dotsEl.style.cursor = 'pointer';
    dotsEl.addEventListener('click', () => {
      const card = dotsEl.closest('.gcard');
      if (!card) return;
      let exp = card.querySelector('.gcard-ping-expando');
      if (exp) {
        exp.style.maxHeight = '0';
        setTimeout(() => exp && exp.parentNode && exp.parentNode.removeChild(exp), 140);
        return;
      }
      const pds = Array.from(dotsEl.querySelectorAll('.pd[title]'));
      const items = pds.slice(-5).map(pd => {
        const cls = pd.className.includes('down') ? 'down' : pd.className.includes('slow') ? 'slow' : 'ok';
        return `<div class="pd-item pd-${cls}">${pd.title}</div>`;
      }).join('');
      exp = document.createElement('div');
      exp.className = 'gcard-ping-expando';
      exp.innerHTML = `<div class="pd-exp-head">Last pings (click dots to close)</div><div class="pd-items">${items || '<span style="opacity:.6">No details</span>'}</div>`;
      dotsEl.after(exp);
      // brief auto hint
      setTimeout(() => { if (exp) exp.style.opacity = '1'; }, 10);
    });
  });
}
