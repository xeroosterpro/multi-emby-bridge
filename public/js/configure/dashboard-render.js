// configure/dashboard-render.js — legacy full dashboard render (non-Dashboard.load path)
async function renderDashboard(force = false, gen = _dashLoadGen) {
  if (_dashGenStale(gen) && !force) return;
  const task = _renderDashboardChain.then(() => _renderDashboardBody(gen, force));
  _renderDashboardChain = task.catch(() => {});
  return task;
}

async function _renderDashboardBody(gen = _dashLoadGen, force = false) {
  if (_dashGenStale(gen)) return;
  _dashboardInFlight = true;
  _dashBusy = true;
  const wrap = document.getElementById('dash-cards');
  try {
    if (wrap && !wrap.children.length) {
      wrap.innerHTML = '<div class="dash-loading">Loading your servers…</div>';
    }
    await ensureAccountConfigLoaded();
    if (gen !== _dashLoadGen) return;
    const now = Date.now();
    const servers = _collectDashboardServers();
    dashConsoleLog(`Servers — ${servers.length} enabled`, servers.length ? 'info' : 'warn');
    dashConsoleLog('Registering health targets & ping', 'busy');
    await _registerHealthServers(servers);
    await _kickHealthPing();
    if (gen !== _dashLoadGen) return;
    dashConsoleLog('Fetching health history', 'busy');
    const healthByUrl = await _fetchHealthByUrl();
    const catCount = (window.collectExternalCatalogs ? window.collectExternalCatalogs() : []).length;
    const catEl = document.getElementById('tile-catalogs');
    if (catEl) catEl.textContent = catCount;
    if (!wrap) return;
    if (_dashGenStale(gen)) return;
    wrap.innerHTML = '';
    if (!servers.length) {
      wrap.innerHTML = dashEmptyServersHtml();
      wireDashEmptyCta(wrap);
      const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      setTxt('tile-servers', 0);
      setTxt('tile-movies', '0');
      setTxt('tile-shows', '0');
      setTxt('tile-ping', '—');
      setTxt('tile-cost', '$0');
      setTxt('tile-cost-l', 'Server costs · $0/yr');
      setTxt('dash-status', 'No servers yet — add one to get started');
      dashConsoleLog('No servers configured — add one on Connections', 'warn');
      return;
    }
    dashConsoleLog(`Building ${servers.length} server card(s)`, 'info');
    let upCount = 0, fastest = null;
    const dashMeta = [];

    // Quick initial status from health (no per-server Emby hit) so pills go from "…" to online/offline
    // almost instantly. Heavier authenticated _testServerConnection below upgrades with fresh data.
    const initialHealthStatus = {};
    servers.forEach(s => {
      const st = _statusFromHealth(healthByUrl, s.url);
      if (st) initialHealthStatus[_normServerUrl(s.url)] = st;
    });

    servers.forEach((s, idx) => {
      const healthRec = healthByUrl[_normServerUrl(s.url)];
      const cacheKey = _libKey(s);
      const cachedLib = (!force && _libStatsCache[cacheKey] && (now - _libStatsCache[cacheKey].ts < LIB_TTL_MS))
        ? _libStatsCache[cacheKey] : null;
      const card = _createDashboardGCard(s, idx, {
        healthRec,
        useCache: !!cachedLib,
        cached: cachedLib,
        initialPillClass: 'loading',
        initialPillTitle: 'Bridge connection status',
        initialPillText: '…',
      });
      wrap.appendChild(card);
      card.classList.add('skeleton');

      const initSt = initialHealthStatus[_normServerUrl(s.url)];
      if (initSt) {
        _applyDashCardStatus(card, initSt.online, initSt.bridgeMs, initSt.authenticated !== false);
      }

      const setStats = (st) => {
        ['movies', 'shows', 'episodes'].forEach(k => {
          const el = card.querySelector(`[data-st=${k}]`);
          if (!el) return;
          _setDashNumber(el, st[k] || 0);
          el.title = '';
          el.classList.remove('gchip-err');
        });
      };
      const setStatus = (online, bridgeMs) => _applyDashCardStatus(card, online, bridgeMs);
      if (cachedLib) setStats(cachedLib);
      dashMeta.push({ s, setStatus, setStats, card, cachedLib });
    });

    window._lastDashSyncTs = Date.now();
    updateDashLastSync('just now');
    // paint the beautiful discrete ping history dots using the fresh health history
    const dashCardsNow = wrap.querySelectorAll('.gcard[data-server-url]');
    dashCardsNow.forEach(c => _paintPingsForCard(c, healthByUrl));
    wireDashServerFilters();
    _wirePingDotInteractions();
    _updateFleetPulse();
    startDashTimestampTicker();

    // tile-servers + bridge latency refine from authenticated tests below (avoids ping-only count flicker).
    const setTxt = (id, v) => _setDashNumber(id, v);
    const pingEl = document.getElementById('tile-ping');

    const pingQueue = [];
    if (dashMeta.some(m => m.cachedLib)) _recalcDashLibTiles();

    // Authenticated connection tests (library stats hydrated separately).
    dashConsoleLog('Testing authenticated connections…', 'busy');
    await _mapPool(dashMeta, async (meta) => {
      if (_dashGenStale(gen)) return;
      const { s, setStatus, card } = meta;
      const label = _dashServerLabel(s);
      dashConsoleLog(`Connection test · ${label}…`, 'busy');
      let bridgeMs = _bridgeMsFromHealth(healthByUrl, s.url);
      const conn = await _testServerConnection(s);
      const online = conn.ok;
      if (online) {
        upCount++;
        if (bridgeMs != null && (fastest === null || bridgeMs < fastest)) fastest = bridgeMs;
        if (bridgeMs == null) pingQueue.push({ s, setStatus, card });
      }
      setStatus(online, bridgeMs);
      const msTxt = bridgeMs != null ? ` · ${bridgeMs}ms bridge` : '';
      dashConsoleLog(`Connection · ${label} — ${online ? 'ONLINE' : 'OFFLINE'}${msTxt}`, online ? 'ok' : 'warn');
    }, LIB_STATS_CONCURRENCY);
    if (gen !== _dashLoadGen) return;
    setTxt('tile-servers', upCount);
    if (pingEl && fastest != null) {
      pingEl.textContent = fastest + 'ms';
      pingEl.title = `Fastest bridge path right now · ${fastest}ms (addon → server)`;
    }
    if (pingQueue.length) {
      try {
        const resp = await fetch('/api/ping-servers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servers: pingQueue.map(m => ({ url: m.s.url, label: m.s.label })) }),
        });
        const data = resp.ok ? await resp.json().catch(() => ({})) : {};
        (data.results || []).forEach((r, i) => {
          const row = pingQueue[i];
          if (!row || !r.up || r.ms == null) return;
          row.setStatus(true, r.ms);
          if (fastest === null || r.ms < fastest) fastest = r.ms;
          const pEl = document.getElementById('tile-ping');
          if (pEl) {
            pEl.textContent = fastest + 'ms';
            pEl.title = `Fastest bridge path right now · ${fastest}ms (addon → server)`;
          }
        });
      } catch { /* bridge ms stays blank */ }
    }
    const totalMo = servers.reduce((a, s) => a + monthlyCost(s.cost, s.costPeriod), 0);
    setTxt('tile-cost', '$' + Math.round(totalMo) + (totalMo > 0 ? '/mo' : ''));
    setTxt('tile-cost-l', 'Server costs · $' + Math.round(totalMo * 12) + '/yr');
    setTxt('dash-status', servers.length
      ? `Everything's loaded. ${upCount}/${servers.length} servers reachable.`
      : 'No servers yet — add one on the Servers page.');
    if (gen === _dashLoadGen) {
      document.querySelectorAll('#page-dashboard .dash-tiles .tile .n').forEach(n => {
        n.classList.remove('tile-num-pop');
        n.offsetHeight;
        n.classList.add('tile-num-pop');
      });
    }
  } finally {
    _dashboardInFlight = false;
    if (gen === _dashLoadGen) _dashBusy = false;
    _reconcileDashServerTile();
  }
}

window.renderDashboard = renderDashboard;
