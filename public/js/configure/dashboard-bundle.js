// configure/dashboard-bundle.js — merge/patch/apply dashboard API bundles
function _mergeDashboardBundles(prev, next) {
  if (!next) return prev;
  const scope = next.scope || 'full';
  if (scope === 'full') return next;
  if (!prev) return next;  // allow first partial after skeleton to populate its data (stats, conn, health) and set state

  const out = {
    ...prev,
    ts: next.ts || Date.now(),
    scope,
    errors: [...(prev.errors || []), ...(next.errors || [])].slice(-24),
    hasServers: next.hasServers ?? prev.hasServers,
    serverCount: next.serverCount ?? prev.serverCount,
    servers: (next.servers?.length ? next.servers : prev.servers) || [],
    totals: prev.totals ? { ...prev.totals } : prev.totals,
    connections: prev.connections || [],
    library: prev.library || [],
    live: prev.live || [],
    liveProbes: prev.liveProbes || [],
    recent: prev.recent || [],
    health: prev.health || [],
  };

  if (scope === 'live') {
    out.live = next.live ?? prev.live ?? [];
    out.liveProbes = next.liveProbes ?? prev.liveProbes ?? [];
    out.recent = next.recent ?? prev.recent ?? [];
  }
  if (scope === 'stats') {
    out.connections = next.connections ?? prev.connections ?? [];
    out.library = next.library ?? prev.library ?? [];
    out.totals = next.totals || prev.totals;
  }
  if (scope === 'health') {
    out.health = next.health ?? prev.health ?? [];
  }
  if (scope === 'conn') {
    out.connections = next.connections ?? prev.connections ?? [];
    const up = out.connections.filter(c => c.ok).length;
    if (prev.totals) {
      out.totals = { ...prev.totals, serversUp: up, serversTotal: out.serverCount || prev.totals.serversTotal };
    } else if (next.totals) {
      out.totals = next.totals;
    }
  }
  return out;
}

function _healthMapFromBundle(healthRows) {
  const map = {};
  (healthRows || []).forEach(h => { map[_normServerUrl(h.url)] = h; });
  return map;
}

function _bundleConnByUrl(bundle, url) {
  const norm = _normServerUrl(url);
  return (bundle.connections || []).find(c => _normServerUrl(c.url) === norm);
}

function _bundleLibByUrl(bundle, url) {
  const norm = _normServerUrl(url);
  return (bundle.library || []).find(r => _normServerUrl(r.url) === norm);
}

function _patchDashHealthFromBundle(data) {
  const healthByUrl = _healthMapFromBundle(data.health);
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  cards.forEach(card => {
    const url = card.dataset.serverUrl;
    const slot = card.querySelector('.gcard-health');
    const healthRec = healthByUrl[_normServerUrl(url)];
    if (slot) slot.innerHTML = _dashHealthPanel(healthRec?.history || []);
    _paintPingsForCard(card, healthByUrl);
    _syncDashCardStatus(card, data);
  });
  if (window._dashReapplyFilters) window._dashReapplyFilters();
}

function _patchDashConnFromBundle(data) {
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  cards.forEach(card => _syncDashCardStatus(card, data));
  _paintDashTilesFromBundle(data);
}

function _getCachedLibForUrl(url) {
  if (!_libStatsCache) return null;
  const norm = _normServerUrl(url);
  for (const k of Object.keys(_libStatsCache)) {
    const keyUrl = k.split('|')[0] || '';
    if (_normServerUrl(keyUrl) === norm) {
      const c = _libStatsCache[k];
      if (c && (Date.now() - (c.ts || 0)) < 3600000) return c; // within last hour
    }
  }
  return null;
}

function _patchDashStatsFromBundle(data) {
  const cards = document.querySelectorAll('#page-dashboard #dash-cards .gcard[data-server-url]');
  cards.forEach(card => {
    const url = card.dataset.serverUrl;
    const lib = _bundleLibByUrl(data, url);
    const setChip = (st, val, err) => {
      const el = card.querySelector(`[data-st="${st}"]`);
      if (!el) return;
      el.textContent = val;
      el.classList.toggle('gchip-err', !!err);
      if (err) el.title = err;
      else el.removeAttribute('title');
    };
    if (lib) {
      if (lib.ok) {
        setChip('movies', (lib.movies || 0).toLocaleString(), '');
        setChip('shows', (lib.shows || 0).toLocaleString(), '');
        setChip('episodes', (lib.episodes || 0).toLocaleString(), '');
        const srv = (data.servers || []).find(s => _normServerUrl(s.url) === _normServerUrl(url));
        const cacheKey = _libKey({ url, apiKey: '', userId: srv?.userId || '' });
        _libStatsCache[cacheKey] = { movies: lib.movies, shows: lib.shows, episodes: lib.episodes, ts: Date.now() };
      } else {
        const cached = _getCachedLibForUrl(url);
        const err = lib.error || 'failed';
        if (cached) {
          const note = ' (last known)';
          setChip('movies', (cached.movies || 0).toLocaleString() + note, err);
          setChip('shows', (cached.shows || 0).toLocaleString() + note, err);
          setChip('episodes', (cached.episodes || 0).toLocaleString() + note, err);
        } else {
          setChip('movies', '—', err);
          setChip('shows', '—', err);
          setChip('episodes', '—', err);
        }
      }
    }
    _syncDashCardStatus(card, data);
  });
  _paintDashTilesFromBundle(data);
}

function _paintDashTilesFromBundle(bundle) {
  const t = bundle.totals || {};
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setTxt('tile-servers', t.serversUp ?? 0);
  setTxt('tile-movies', (t.movies || 0).toLocaleString());
  setTxt('tile-shows', (t.shows || 0).toLocaleString());
  const pingEl = document.getElementById('tile-ping');
  if (pingEl) {
    if (t.fastestBridgeMs != null) {
      pingEl.textContent = t.fastestBridgeMs + 'ms';
      pingEl.title = `Fastest bridge path right now · ${t.fastestBridgeMs}ms (addon → server)`;
    } else pingEl.textContent = '—';
  }
  const mo = t.costMonthly || 0;
  setTxt('tile-cost', '$' + Math.round(mo) + (mo > 0 ? '/mo' : ''));
  setTxt('tile-cost-l', 'Server costs (configured) · $' + (t.costYearly || Math.round(mo * 12)) + '/yr');
  const costTile = document.getElementById('tile-cost');
  if (costTile) {
    const healthy = t.healthyCostMonthly != null ? t.healthyCostMonthly : mo;
    costTile.title = `Configured monthly: $${Math.round(mo)} (all servers, incl. degraded). Currently healthy servers only: $${Math.round(healthy)}/mo. Per-server costs are user-configured.`;
  }
  // #4 polish: if healthy cost is meaningfully lower, surface a compact note under the yearly (keeps UI clean but informative)
  const costYearEl = document.getElementById('tile-cost-l');
  if (costYearEl && t.healthyCostMonthly != null && t.healthyCostMonthly < mo * 0.95) {
    const h = Math.round(t.healthyCostMonthly);
    if (!costYearEl.querySelector('[data-healthy-note]')) {
      const note = document.createElement('span');
      note.setAttribute('data-healthy-note','1');
      note.style.cssText = 'display:block;font-size:0.58rem;opacity:0.75;margin-top:1px;';
      note.textContent = `(healthy only: $${h}/mo)`;
      costYearEl.appendChild(note);
    }
  }
  const n = bundle.serverCount || 0;
  const up = t.serversUp ?? 0;
  setTxt('dash-status', n
    ? `Everything's loaded. ${up}/${n} servers reachable.`
    : 'No servers yet — add one on the Servers page.');
}

function _syncLiveCacheFromBundle(bundle) {
  if (!bundle) return;
  const live = Array.isArray(bundle.live) ? bundle.live : [];
  const probes = Array.isArray(bundle.liveProbes) ? bundle.liveProbes : [];
  const annotated = annotateLiveSessions(live);
  _liveBundleCache = { live: annotated, probes, ts: bundle.ts || Date.now() };
  window._mebAnnotatedLive = annotated;
  window._mebAnnotatedLiveTs = _liveBundleCache.ts;
  window._mebLiveProbes = probes;
  renderLiveDock(annotated);
}

async function applyDashboardBundle(bundle, opts = {}) {
  const prev = window.DashboardState?.lastBundle;
  const data = opts.partial ? _mergeDashboardBundles(prev, bundle) : bundle;
  if (!data) return;
  const scope = data.scope || bundle.scope || 'full';
  window.DashboardStateApi?.setBundle?.(data, scope);

  const servers = data.servers || [];
  await _registerHealthServers(servers);
  if (opts.full) await _kickHealthPingThrottled();

  if (opts.partial && scope === 'live') {
    _syncLiveCacheFromBundle(data);
    _activityRecentCache = Array.isArray(data.recent) ? data.recent : [];
    _dashActivityData = {
      recent: data.recent || [],
      hasServers: !!data.hasServers,
      serverCount: data.serverCount || servers.length,
      liveProbes: data.liveProbes || [],
    };
    await renderDashActivity({
      activity: _dashActivityData,
      bundle: { live: _liveBundleCache.live, probes: data.liveProbes, ts: data.ts },
    });
    return;
  }

  if (opts.partial && scope === 'health') {
    _patchDashHealthFromBundle(data);
    return;
  }

  if (opts.partial && scope === 'conn') {
    _patchDashConnFromBundle(data);
    return;
  }

  if (opts.partial && scope === 'stats') {
    _patchDashStatsFromBundle(data);
    return;
  }

  const wrap = document.getElementById('dash-cards');
  const healthByUrl = _healthMapFromBundle(data.health);

  if (wrap) {
    if (!servers.length) {
      wrap.innerHTML = dashEmptyServersHtml();
      wireDashEmptyCta(wrap);
    } else {
      wrap.innerHTML = '';
      servers.forEach((s, idx) => {
        const conn = _bundleConnByUrl(data, s.url);
        const lib = _bundleLibByUrl(data, s.url);
        const healthRec = healthByUrl[_normServerUrl(s.url)];

        const card = _createDashboardGCard(s, idx, {
          conn,
          lib,
          healthRec,
          initialPillClass: 'loading',
          initialPillTitle: 'Bridge connection status',
          initialPillText: '…',
        });
        wrap.appendChild(card);

        if (lib?.ok) {
          const cacheKey = _libKey({ url: s.url, apiKey: '', userId: s.userId });
          _libStatsCache[cacheKey] = { movies: lib.movies, shows: lib.shows, episodes: lib.episodes, ts: Date.now() };
        }
        _syncDashCardStatus(card, data);
        requestAnimationFrame(() => {
          card.style.animationDelay = `${idx * 55}ms`;
        });
      });
    }
  }

  _paintDashTilesFromBundle(data);
  _syncLiveCacheFromBundle(data);
  _activityRecentCache = Array.isArray(data.recent) ? data.recent : [];
  _dashActivityData = {
    recent: data.recent || [],
    hasServers: !!data.hasServers,
    serverCount: data.serverCount || servers.length,
    liveProbes: data.liveProbes || [],
  };
  await renderDashActivity({
    activity: _dashActivityData,
    bundle: { live: _liveBundleCache.live, probes: data.liveProbes, ts: data.ts },
  });
}

window.applyDashboardBundle = applyDashboardBundle;
