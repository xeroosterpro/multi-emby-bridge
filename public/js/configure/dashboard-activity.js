// configure/dashboard-activity.js — live/history panels, activity polling
function dashActivityWhen(t) {
  if (!t) return '';
  const d = Date.now() - new Date(t).getTime();
  const h = Math.floor(d / 3600000);
  return h < 1 ? 'just now' : h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
}

// Mirror of titlesMatch + recentMatchesLive in lib/activityEnrich.js. Used so the
// Watched-history "▶ now" tag is computed against the SAME live set the Live panel
// renders (bundle.live — already suppressed + real-session aware), instead of the
// looser server-side bridge self-match. The two panels then always agree.
function dashNormTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function dashTitlesMatch(a, b) {
  const x = dashNormTitle(a), y = dashNormTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  const xWords = x.split(' ').filter(w => w.length > 2);
  const yWords = new Set(y.split(' ').filter(w => w.length > 2));
  if (!xWords.length || !yWords.size) return false;
  const overlap = xWords.filter(w => yWords.has(w)).length;
  return overlap >= Math.min(2, Math.ceil(xWords.length * 0.6));
}
function dashRecentMatchesLive(entry, liveList) {
  if (!entry || !entry.title || !Array.isArray(liveList)) return false;
  const entryHasSE = entry.season != null && entry.episode != null;
  for (const s of liveList) {
    if (!s) continue;
    if (entryHasSE && s.season != null && s.episode != null) {
      if (Number(s.season) !== Number(entry.season) || Number(s.episode) !== Number(entry.episode)) continue;
    }
    const candidates = [s.title, s.rawTitle, s.seriesName].filter(Boolean);
    if (candidates.some(c => dashTitlesMatch(entry.title, c))) return true;
  }
  return false;
}

function dashHistKindLabel(kind) {
  if (kind === 'live') return 'Playing now';
  if (kind === 'resume') return 'In progress';
  if (kind === 'played') return 'Watched';
  return 'Stremio play';
}

function dashNormContentKey(entry) {
  const base = entry?.imdbId || dashNormTitle(entry?.title);
  return [base, entry?.season ?? '', entry?.episode ?? ''].join('|');
}

function dashMergeLiveIntoRecent(recent, live, opts = {}) {
  const limit = opts.limit || 30;
  const list = [...(recent || [])];
  const liveSessions = (live || []).filter(s => s && s.title);
  for (const session of liveSessions) {
    const title = session.title || session.rawTitle || session.seriesName;
    if (!title) continue;
    if (list.some(entry => dashRecentMatchesLive(entry, [session]))) continue;
    list.unshift({
      title: session.title || title,
      season: session.season ?? null,
      episode: session.episode ?? null,
      server: session.server || session.pickedServer || null,
      source: 'server',
      kind: 'live',
      ts: new Date().toISOString(),
      serverType: session.serverType || null,
      sources: ['server'],
    });
  }
  const seen = new Set();
  const deduped = [];
  for (const entry of list) {
    if (!entry?.title) continue;
    const key = dashNormContentKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function dashHistSourceBadge(entry) {
  if (entry.kind === 'live') return '<span class="da-src-badge da-src-live">Playing now</span>';
  const sources = entry.sources || [entry.source || 'bridge'];
  const hasBridge = sources.includes('bridge');
  const hasServer = sources.includes('server');
  if (hasBridge && hasServer) return '<span class="da-src-badge da-src-both">Stremio + Server</span>';
  if (hasServer) {
    const t = (entry.serverType || 'emby').toLowerCase();
    const cls = t === 'jellyfin' ? 'da-src-jellyfin' : 'da-src-emby';
    const label = t === 'jellyfin' ? 'Jellyfin' : 'Emby';
    return `<span class="da-src-badge ${cls}">${label}</span>`;
  }
  return '<span class="da-src-badge da-src-stremio">Stremio</span>';
}

function dashHistIcon(entry) {
  const isEp = entry.season != null || entry.episode != null || entry.type === 'series' || entry.itemType === 'Episode';
  return isEp ? '📺' : '🎬';
}

function dashHistMatchesFilter(entry, filter) {
  if (filter === 'all') return true;
  const sources = entry.sources || [entry.source || 'bridge'];
  if (filter === 'bridge') return sources.includes('bridge');
  if (filter === 'server') return sources.includes('server');
  return true;
}

function renderDashHistoryRows(recent, live, filter) {
  const esc = dashActivityEsc;
  const when = dashActivityWhen;
  const rows = (recent || []).filter(e => dashHistMatchesFilter(e, filter));
  if (!rows.length) {
    const emptyMsg = filter === 'all'
      ? 'No recent activity yet — plays in Stremio or your Emby/Jellyfin apps appear here.'
      : filter === 'bridge'
        ? 'No Stremio plays logged yet.'
        : 'No native server watch history returned — try playing something in Emby or Jellyfin.';
    return `<div class="da-empty da-hist-empty">${emptyMsg}</div>`;
  }
  return rows.map(e => {
    const isLive = e.kind === 'live' || dashRecentMatchesLive(e, live);
    const showProgress = e.kind === 'resume' && e.progressPct != null && e.progressPct < 98;
    const pct = showProgress ? Math.min(100, Math.max(1, Math.round(e.progressPct))) : null;
    const kindCls = e.kind === 'live' ? 'da-hist-item-kind-live'
      : e.kind === 'resume' ? 'da-hist-item-resume'
        : (e.kind === 'played' ? 'da-hist-item-played' : 'da-hist-item-lookup');
    const subParts = [];
    if (e.server) subParts.push(esc(e.server));
    subParts.push(esc(dashHistKindLabel(e.kind)));
    if (e.lookupCount > 1) subParts.push(`${e.lookupCount} lookups`);
    else if (pct != null && !showProgress) subParts.push('Completed');
    else if (pct != null) subParts.push(`${pct}% watched`);
    return `<div class="da-hist-item ${kindCls}${isLive ? ' da-hist-item-live' : ''}">
      <div class="da-hist-icon" aria-hidden="true">${dashHistIcon(e)}</div>
      <div class="da-hist-body">
        <div class="da-hist-title-row">
          <span class="da-hist-title" title="${esc(e.title || '')}">${esc(e.title || '—')}</span>
          ${dashHistSourceBadge(e)}
        </div>
        <div class="da-hist-sub">${subParts.join(' · ')}</div>
        ${showProgress ? `<div class="da-hist-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="da-hist-progress-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
      <div class="da-hist-meta">
        ${isLive ? '<span class="da-hist-now">▶ now</span>' : ''}
        <span class="da-hist-when">${when(e.ts)}</span>
      </div>
    </div>`;
  }).join('');
}

function dashHistStats(recent) {
  const list = recent || [];
  const bridge = list.filter(e => (e.sources || [e.source]).includes('bridge')).length;
  const server = list.filter(e => (e.sources || [e.source]).includes('server')).length;
  const resume = list.filter(e => e.kind === 'resume').length;
  return { total: list.length, bridge, server, resume };
}

function paintDashActivityPanels(el, a, bundle, localServers) {
  const esc = dashActivityEsc;
  const when = dashActivityWhen;
  const serverCount = localServers.length || a.serverCount || 0;
  const live = bundle.live || [];
  const probes = bundle.probes || a.liveProbes || [];

  const liveRows = window.MEBLiveUI
    ? window.MEBLiveUI.renderLiveRows(live, { emptyHtml: '' })
    : '';

  const emptyMsg = live.length ? '' : liveEmptyMessage(probes, serverCount);
  const recent = dashMergeLiveIntoRecent(a.recent || [], live);
  const stats = dashHistStats(recent);
  const histRows = renderDashHistoryRows(recent, live, _dashHistFilter);

  // aggregate idle summary instead of per-server empty
  const idleCount = (probes || []).filter(p => p && p.ok && (p.count || 0) === 0).length;
  const aggregateEmpty = live.length ? '' : `<div class="da-empty">${emptyMsg}<div class="da-idle-summary">${idleCount}/${serverCount} servers idle</div></div>`;

  el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
    <div class="dash-act-panel dash-act-live">
      <h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming <span class="dash-act-count">${live.length}</span></h3>
      <p class="dash-act-hint">Sessions, browser, and bridge stream lookups · ${serverCount} server${serverCount === 1 ? '' : 's'} · refreshes every ${Math.round(DASH_LIVE_POLL_MS / 1000)}s on this page</p>
      ${renderLiveProbeStrip(probes)}
      <div class="da-list">${liveRows || aggregateEmpty}</div>
    </div>
    <div class="dash-act-panel dash-act-history">
      <div class="da-hist-head">
        <h3 class="block-title dash-act-title">Recent activity</h3>
        <div class="da-hist-filters" role="tablist" aria-label="Activity source filter">
          <button type="button" class="da-hist-filter${_dashHistFilter === 'all' ? ' on' : ''}" data-hist-filter="all" role="tab">All <span class="da-hist-filter-n">${stats.total}</span></button>
          <button type="button" class="da-hist-filter${_dashHistFilter === 'bridge' ? ' on' : ''}" data-hist-filter="bridge" role="tab">Stremio <span class="da-hist-filter-n">${stats.bridge}</span></button>
          <button type="button" class="da-hist-filter${_dashHistFilter === 'server' ? ' on' : ''}" data-hist-filter="server" role="tab">Servers <span class="da-hist-filter-n">${stats.server}</span></button>
        </div>
      </div>
      <p class="dash-act-hint">Stremio addon plays <strong>and</strong> native Emby/Jellyfin watch history · <strong>▶ now</strong> syncs with Live</p>
      <div class="da-hist-stats">
        <span class="da-hist-stat"><strong>${stats.total}</strong> titles</span>
        ${stats.resume ? `<span class="da-hist-stat da-hist-stat-resume"><strong>${stats.resume}</strong> in progress</span>` : ''}
      </div>
      <div class="da-hist-list">${histRows}</div>
    </div>
  </div>`;
  el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
  el.querySelectorAll('[data-hist-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _dashHistFilter = btn.dataset.histFilter || 'all';
      paintDashActivityPanels(el, a, bundle, localServers);
    });
  });
}

async function renderDashActivity(opts = {}) {
  const gen = ++_dashActivityGen;
  const el = document.getElementById('dash-activity');
  if (!el) return;

  await ensureAccountConfigLoaded();
  if (gen !== _dashActivityGen) return;

  const localServers = collectServersForLive();
  if (!dashActivityHasContent(el)) renderDashActivityShell(localServers.length);
  if (gen !== _dashActivityGen) return;

  let a = opts.activity !== undefined ? opts.activity : (_dashActivityData || null);
  if (opts.activity !== undefined) {
    if (opts.activity) _dashActivityData = opts.activity;
  } else if (!a || opts.refreshHistory) {
    let resp;
    let fresh;
    try {
      fresh = await _fetchUserActivityQuick();
      resp = fresh ? { ok: true, status: 200 } : await fetch('/api/user/activity?quick=1', { credentials: 'same-origin' });
    } catch {
      if (!dashActivityHasContent(el)) {
        el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
          <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Could not load activity — check your connection.</div></div>
          <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Could not load history.</div></div>
        </div>`;
      }
      return;
    }
    if (gen !== _dashActivityGen) return;

    if (!fresh && resp.status === 401) {
      el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
        <div class="dash-act-panel"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Sign in to see live activity from your servers.</div></div>
        <div class="dash-act-panel"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Sign in to see your personal watch history.</div></div>
      </div>`;
      return;
    }

    if (!fresh) fresh = resp.ok ? await resp.json().catch(() => null) : null;
    if (!fresh) {
      if (!localServers.length) {
        el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
          <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3><div class="da-empty">Add servers on the <a href="#" data-page="servers">Servers</a> page to see live activity from your Emby/Jellyfin instances.</div></div>
          <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Your personal watch history appears here once you have servers configured.</div></div>
        </div>`;
        el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
      } else if (!dashActivityHasContent(el)) {
        el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
          <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title">Live streaming</h3><div class="da-empty">Activity unavailable right now.</div></div>
          <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">History unavailable right now.</div></div>
        </div>`;
      }
      return;
    }
    a = fresh;
    _dashActivityData = fresh;
  }
  if (gen !== _dashActivityGen) return;

  if (!a) {
    if (!localServers.length) {
      el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
        <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3><div class="da-empty">Add servers on the <a href="#" data-page="servers">Servers</a> page to see live activity from your Emby/Jellyfin instances.</div></div>
        <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Your personal watch history appears here once you have servers configured.</div></div>
      </div>`;
      el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
      return;
    }
    a = { recent: [], hasServers: true, serverCount: localServers.length, liveProbes: [] };
  }

  _activityRecentCache = Array.isArray(a.recent) ? a.recent : [];
  const hasServers = localServers.length > 0 || !!a.hasServers;

  if (!hasServers) {
    el.innerHTML = `<div class="dash-activity-grid" data-ready="1">
      <div class="dash-act-panel dash-act-live"><h3 class="block-title dash-act-title"><span class="da-dot"></span> Live streaming</h3><div class="da-empty">Add servers on the <a href="#" data-page="servers">Servers</a> page to see live activity from your Emby/Jellyfin instances.</div></div>
      <div class="dash-act-panel dash-act-history"><h3 class="block-title dash-act-title">Watched history</h3><div class="da-empty">Your personal watch history appears here once you have servers configured.</div></div>
    </div>`;
    el.querySelectorAll('[data-page]').forEach(link => link.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + link.dataset.page; }));
    return;
  }

  let bundle = opts.bundle;
  if (!bundle?.ts) {
    const dashBundle = window.DashboardState?.lastBundle;
    if (dashBundle?.ts) {
      bundle = { live: dashBundle.live, probes: dashBundle.liveProbes, ts: dashBundle.ts };
    } else if (_liveBundleCache.ts) {
      bundle = _liveBundleCache;
    } else if (!_dashboardBundleActive()) {
      bundle = await fetchLiveBundle(false, { fast: true });
    } else {
      bundle = _liveBundleCache;
    }
  }
  if (gen !== _dashActivityGen) return;

  paintDashActivityPanels(el, a, bundle, localServers);
}

function replayDashTileAnimations() {
  document.querySelectorAll('#page-dashboard .dash-tiles .tile').forEach(tile => {
    tile.style.animation = 'none';
    tile.offsetHeight;
    tile.style.animation = '';
  });
}

// Real-time: live playback + buffering notifications (all pages when signed in).
setInterval(() => {
  if (_dashboardBundleActive()) return;
  pollLivePlaybackNotifications();
}, LIVE_PLAYBACK_POLL_MS);
setTimeout(() => {
  if (!document.getElementById('page-dashboard')?.classList.contains('on')) {
    pollLivePlaybackNotifications({ force: true });
  }
}, 400);

// Dashboard health sparklines + fast health-based status while that page is open.
setInterval(() => {
  const dash = document.getElementById('page-dashboard');
  if (!dash || !dash.classList.contains('on')) return;
  if (_dashBusy) return;
  if (_dashboardBundleActive()) return;
  if (_dashLastFullLoad && Date.now() - _dashLastFullLoad < DASH_GRAPH_POLL_MS) return;
  refreshDashCardHealth();
  refreshDashCardStatus();
}, DASH_GRAPH_POLL_MS);

// Full authenticated connection test (heavier) on a slower cadence.
setInterval(() => {
  const dash = document.getElementById('page-dashboard');
  if (!dash || !dash.classList.contains('on')) return;
  if (_dashBusy) return;
  if (_dashboardBundleActive()) return;
  if (_dashLastFullLoad && Date.now() - _dashLastFullLoad < DASH_CONN_POLL_MS - 3000) return;
  refreshDashCardStatus({ full: true });
}, DASH_CONN_POLL_MS);

window.renderDashActivity = renderDashActivity;
window.replayDashTileAnimations = replayDashTileAnimations;
