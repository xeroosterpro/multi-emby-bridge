// configure/dashboard-live.js — live sessions, dock, polling
function formatLiveTitleClient(np) {
  if (!np) return 'Unknown';
  if (np.Type === 'Episode' && np.SeriesName) {
    const s = np.ParentIndexNumber != null ? `S${np.ParentIndexNumber}` : '';
    const e = np.IndexNumber != null ? `E${np.IndexNumber}` : '';
    const ep = np.Name && np.Name !== np.SeriesName ? ` — ${np.Name}` : '';
    return `${np.SeriesName} ${s}${e}${ep}`.trim();
  }
  return np.Name || 'Unknown';
}

function parseBrowserSessions(data, server) {
  const out = [];
  for (const sess of (Array.isArray(data) ? data : [])) {
    const np = sess && sess.NowPlayingItem;
    if (!np) continue;
    const ps = sess.PlayState || {};
    const runTicks = Number(np.RunTimeTicks) || 0;
    const posTicks = ps.PositionTicks != null ? Number(ps.PositionTicks) : null;
    let progressPct = null;
    if (runTicks > 0 && posTicks != null && posTicks >= 0) {
      progressPct = Math.min(100, Math.max(0, Math.round((posTicks / runTicks) * 100)));
    }
    out.push({
      server: server.label || server.url,
      title: formatLiveTitleClient(np),
      rawTitle: np.Name || null,
      season: np.ParentIndexNumber ?? null,
      episode: np.IndexNumber ?? null,
      user: sess.UserName || sess.DeviceName || null,
      client: sess.Client || sess.AppName || null,
      device: sess.DeviceName || null,
      positionTicks: posTicks,
      progressPct,
      isPaused: !!ps.IsPaused,
      playMethod: ps.PlayMethod || null,
      isTranscoding: false,
      sessionId: sess.Id || null,
      source: 'browser-sessions',
    });
  }
  return out;
}

async function fetchBrowserServerSessions(server) {
  const label = server.label || server.url || 'server';
  if (!_allowBrowserSessionProbe(server)) {
    return { live: [], probe: { server: label, ok: false, count: 0, error: 'skipped (demo)', method: null } };
  }
  if (!server?.url || !server?.apiKey) {
    return { live: [], probe: { server: label, ok: false, count: 0, error: 'missing credentials', method: null } };
  }
  const base = server.url.replace(/\/+$/, '');
  const key = encodeURIComponent(server.apiKey);
  const urls = [
    `${base}/Sessions?api_key=${key}&ActiveWithinSeconds=7200`,
    `${base}/emby/Sessions?api_key=${key}&ActiveWithinSeconds=7200`,
    `${base}/Sessions?api_key=${key}`,
    `${base}/emby/Sessions?api_key=${key}`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LIVE_BROWSER_TIMEOUT_MS);
      const r = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json();
      const live = parseBrowserSessions(data, server);
      if (live.length) {
        return {
          live,
          probe: { server: label, ok: true, count: live.length, error: null, method: 'browser-sessions' },
        };
      }
    } catch { /* CORS / network — try next path */ }
  }
  return { live: [], probe: { server: label, ok: false, count: 0, error: 'browser blocked', method: null } };
}

function _availableServersFromStatus(serverStatus) {
  if (!Array.isArray(serverStatus)) return [];
  return serverStatus.filter(s => s && s.status === 'found' && s.label).map(s => s.label);
}

function _resolveBridgePlayback(entry) {
  const pickedServer = entry?.server || entry?.pickedServer || (entry?.bestFile && entry.bestFile.label) || null;
  const availableOn = _availableServersFromStatus(entry?.serverStatus);
  let server = null;
  let serverConfirmed = false;
  if (availableOn.length === 1) {
    server = availableOn[0];
    serverConfirmed = true;
  } else if (availableOn.length > 1) {
    server = null;
    serverConfirmed = false;
  } else if (pickedServer) {
    server = pickedServer;
    serverConfirmed = false;
  }
  return { pickedServer, server, availableOn, serverConfirmed };
}

function inferBridgeLiveFromRecent(recent) {
  const now = Date.now();
  const seen = new Map();
  for (const entry of recent || []) {
    if (!entry?.found || !entry.title) continue;
    const ts = entry.ts ? new Date(entry.ts).getTime() : 0;
    if (!ts) continue;
    const age = now - ts;
    if (age < 0 || age > BRIDGE_LIVE_MAX_AGE_MS) continue;
    const resolved = _resolveBridgePlayback(entry);
    if (!resolved.pickedServer && !resolved.server && !resolved.availableOn.length) continue;
    const key = [entry.title, entry.season ?? '', entry.episode ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.set(key, {
      server: resolved.server,
      pickedServer: resolved.pickedServer,
      availableOn: resolved.availableOn,
      serverConfirmed: resolved.serverConfirmed,
      title: entry.title,
      rawTitle: entry.title,
      season: entry.season ?? null,
      episode: entry.episode ?? null,
      user: null,
      client: 'Stremio',
      source: 'bridge',
      inferredAgeMs: age,
      isPaused: false,
      progressPct: null,
    });
  }
  return [...seen.values()];
}

function mergeLiveSourcesClient(lists) {
  const prefer = ['sessions', 'user-playing', 'browser-sessions', 'bridge'];
  const rank = new Map(prefer.map((s, i) => [s, i]));
  const map = new Map();
  const keyOf = s => [s.server || '', s.title || '', s.user || '', s.source || ''].join('|');
  for (const list of lists) {
    for (const s of list || []) {
      if (!s?.title) continue;
      const key = keyOf(s);
      const prev = map.get(key);
      if (!prev || (rank.get(s.source) ?? 99) < (rank.get(prev.source) ?? 99)) map.set(key, s);
    }
  }
  const out = [...map.values()];
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sessionTitles = new Set(
    out.filter(s => s.source !== 'bridge').map(s => norm(s.title)).filter(Boolean)
  );
  return out.filter(s => s.source !== 'bridge' || !sessionTitles.has(norm(s.title)));
}

// Mirror of lib/bridgeLive.js suppressReachableBridge — drop bridge-inferred rows
// on servers the browser successfully probed (ground truth: if it were playing it
// would be a real session). Rows on unreachable servers stay (legit fallback).
function suppressReachableBridgeClient(live, probes) {
  const reachable = new Set((probes || []).filter(p => p && p.ok).map(p => p.server));
  if (!reachable.size) return (live || []).slice();
  return (live || []).filter(s => {
    if (!s || s.source !== 'bridge') return true;
    const candidates = (Array.isArray(s.availableOn) && s.availableOn.length)
      ? s.availableOn
      : [s.server, s.pickedServer].filter(Boolean);
    if (!candidates.length) return true;
    return !candidates.every(c => reachable.has(c));
  });
}

function formatBridgeServerLabel(s) {
  if (!s) return '';
  if (s.source === 'bridge') return (s.serverConfirmed && s.server) ? s.server : '';
  return s.server || '';
}

function formatLiveMetaLine(s) {
  const parts = [];
  const server = formatBridgeServerLabel(s);
  if (server) parts.push(server);
  const user = s.user || '';
  const client = s.client || s.device || '';
  if (user) parts.push(user);
  if (client) parts.push(client);
  return parts.join(' · ');
}

async function fetchLiveSessionsForServers(servers) {
  if (!servers?.length) return [];
  // Short timeout + allSettled: one timing-out/offline server (EAGLE etc.) won't make live or opening dash hang
  const settled = await Promise.allSettled(servers.map(async (s) => {
    try {
      const r = await _fetchWithTimeout('/api/server-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId, label: s.label,
          username: s.username || '', password: s.password || '',
        }),
      }, 4000);
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      if (d?.apiKey) {
        const norm = (s.url || '').replace(/\/+$/, '');
        const block = [...document.querySelectorAll('.server-block')].find(b => {
          const u = b.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
          return u && u === norm;
        });
        if (block) _applyRefreshedApiKey(block, d.apiKey);
      }
      return Array.isArray(d?.live) ? d.live : [];
    } catch {
      return [];
    }
  }));
  const chunks = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
  return chunks.flat();
}

const _livePlaybackPrev = new Map();
const _bufferingToastKeys = new Set();
const LIVE_PLAYBACK_POLL_MS = 20000;
const DASH_LIVE_POLL_MS = 8000;
const BRIDGE_LIVE_MAX_AGE_MS = 90 * 1000; // keep in sync with lib/bridgeLive.js
const LIVE_BROWSER_TIMEOUT_MS = 4000;
let _dashLiveTimer = null;

function annotateLiveSessions(sessions) {
  const lp = window.MEBLivePlayback;
  if (!lp) return (sessions || []).map(s => ({ ...s, buffering: false }));
  return lp.annotateBuffering(sessions || [], _livePlaybackPrev);
}

function renderBufferingBanner(buffering) {
  const list = buffering || [];
  let el = document.getElementById('buffering-banner');
  if (!list.length) {
    if (el) el.remove();
    document.documentElement.classList.remove('has-buffering-banner');
    return;
  }
  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const servers = [...new Set(list.map(s => s.server).filter(Boolean))];
  const summary = servers.length === 1
    ? `Buffering on <strong>${esc(servers[0])}</strong>`
    : `Buffering on <strong>${servers.length} servers</strong> — ${esc(servers.slice(0, 3).join(', '))}${servers.length > 3 ? '…' : ''}`;
  const detail = list.length === 1
    ? `${esc(list[0].title)}${list[0].user ? ` · ${esc(list[0].user)}` : ''}`
    : `${list.length} active stream${list.length === 1 ? '' : 's'} stalled`;
  if (!el) {
    el = document.createElement('div');
    el.id = 'buffering-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="bb-icon" aria-hidden="true">⏳</span>
      <span class="bb-text"><span class="bb-summary"></span><span class="bb-detail"></span></span>
      <button type="button" class="bb-action">View</button>`;
    el.querySelector('.bb-action').addEventListener('click', () => { location.hash = '#/dashboard'; });
    document.body.appendChild(el);
  }
  el.querySelector('.bb-summary').innerHTML = summary;
  el.querySelector('.bb-detail').textContent = detail;
  document.documentElement.classList.add('has-buffering-banner');
}

function updateDashboardBufferBadge(count) {
  const nav = document.querySelector('.nav-item[data-page="dashboard"]');
  if (!nav) return;
  let badge = nav.querySelector('.nav-buffer-badge');
  if (!count) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-buffer-badge';
    badge.title = 'Playback buffering';
    nav.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.style.display = 'inline-flex';
}

function notifyNewBuffering(buffering) {
  const lp = window.MEBLivePlayback;
  if (!lp || typeof window.toast !== 'function') return;
  for (const s of buffering) {
    const key = lp.liveSessionKey(s);
    if (_bufferingToastKeys.has(key)) continue;
    _bufferingToastKeys.add(key);
    window.toast(`Buffering on ${s.server || 'server'} — ${s.title || 'playback'}`);
  }
  for (const key of [..._bufferingToastKeys]) {
    if (!buffering.some(s => lp.liveSessionKey(s) === key)) _bufferingToastKeys.delete(key);
  }
}

let _liveBundleInFlight = null;
let _liveBundleCache = { live: [], probes: [], ts: 0 };
let _activityRecentCache = [];
let _dashActivityGen = 0;
let _dashActivityData = null;
let _dashHistFilter = 'all';

function _serverLikelyDown(healthByUrl, url) {
  const hist = healthByUrl?.[_normServerUrl(url)]?.history || [];
  const lat = hist[0];
  if (!lat || !lat.up) {
    if (!lat || Date.now() - lat.ts > BRIDGE_FRESH_MS) return false;
    return _isHealthDownConfirmed(healthByUrl, url);
  }
  return false;
}

function _liveProbeSkipBrowser(probe) {
  const err = (probe?.error || '').toLowerCase();
  return err.includes('timeout') || err.includes('unreachable') || err.includes('network');
}

function collectServersForLive() {
  const cfg = collectConfig(true);
  if (cfg?.servers?.length) return cfg.servers;
  const state = collectFormState();
  return (state.servers || []).filter(s =>
    s.enabled !== false && s.url && s.apiKey && s.userId && s.label
  );
}

function mergeLiveSessions(lists) {
  const lp = window.MEBLivePlayback;
  const map = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      const k = lp
        ? lp.liveSessionKey(s)
        : [s.server, s.user, s.title, s.client, s.sessionId].join('|');
      if (!map.has(k)) map.set(k, s);
    }
  }
  return [...map.values()];
}

async function _fetchUserActivityQuick() {
  const demoOn = window.MEBDemo?.isActive?.();
  const auth = await getAuth();
  if (!auth?.user && !demoOn) return null;
  if (_activityFetchPromise) return _activityFetchPromise;
  _activityFetchPromise = fetch('/api/user/activity?quick=1', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json().catch(() => null) : null)
    .catch(() => null)
    .finally(() => { _activityFetchPromise = null; });
  return _activityFetchPromise;
}

async function fetchLiveBundle(force = false, opts = {}) {
  const ttl = opts.fast ? DASH_LIVE_POLL_MS : LIVE_PLAYBACK_POLL_MS;
  if (!force && _liveBundleCache.ts && Date.now() - _liveBundleCache.ts < ttl) {
    return _liveBundleCache;
  }
  if (_liveBundleInFlight) return _liveBundleInFlight;
  _liveBundleInFlight = (async () => {
    const demoOn = window.MEBDemo && window.MEBDemo.isActive && window.MEBDemo.isActive();
    let live = [];
    let probes = [];
    let recentForBridge = _activityRecentCache || [];

    await ensureAccountConfigLoaded();
    const servers = collectServersForLive();
    const healthByUrl = servers.length ? await _fetchHealthByUrl() : {};

    const activityP = opts.activity !== undefined
      ? Promise.resolve(opts.activity)
      : (!demoOn ? _fetchUserActivityQuick() : Promise.resolve(null));

    const probesP = (servers.length && !demoOn)
      ? Promise.all(servers.map(async (s) => {
          if (_serverLikelyDown(healthByUrl, s.url)) {
            return {
              live: [],
              probe: { server: s.label || s.url, ok: false, count: 0, error: 'skipped (offline)', method: null },
            };
          }
          try {
            const r = await fetch('/api/server-sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                url: s.url, type: s.type, apiKey: s.apiKey, userId: s.userId, label: s.label,
                username: s.username || '', password: s.password || '',
              }),
            });
            const d = await r.json().catch(() => null);
            if (d?.apiKey) {
              const norm = (s.url || '').replace(/\/+$/, '');
              const block = [...document.querySelectorAll('.server-block')].find(b => {
                const u = b.querySelector('.f-url')?.value.trim().replace(/\/+$/, '');
                return u && u === norm;
              });
              if (block) _applyRefreshedApiKey(block, d.apiKey);
            }
            let chunkLive = Array.isArray(d?.live) ? d.live : [];
            let probe = d?.probe || {
              server: s.label || s.url,
              ok: r.ok,
              count: chunkLive.length,
              error: d?.error || (!r.ok ? `HTTP ${r.status}` : null),
              method: d?.probe?.method || null,
            };
            if (!chunkLive.length && !probe?.ok && !_liveProbeSkipBrowser(probe) && _allowBrowserSessionProbe(s)) {
              const browser = await fetchBrowserServerSessions(s);
              if (browser.live.length) {
                chunkLive = browser.live;
                probe = browser.probe;
              } else if (!probe.ok && browser.probe?.error === 'browser blocked') {
                probe = { ...probe, browserNote: 'browser blocked' };
              }
            }
            return { live: chunkLive, probe };
          } catch {
            const browser = _allowBrowserSessionProbe(s)
              ? await fetchBrowserServerSessions(s).catch(() => ({ live: [], probe: null }))
              : { live: [], probe: null };
            if (browser.live?.length) return browser;
            return {
              live: [],
              probe: { server: s.label || s.url, ok: false, count: 0, error: 'network error', method: null },
            };
          }
        }))
      : Promise.resolve([]);

    const [actData, clientChunks] = await Promise.all([activityP, probesP]);

    if (actData) {
      live = Array.isArray(actData.live) ? actData.live : [];
      probes = Array.isArray(actData.liveProbes) ? actData.liveProbes : [];
      recentForBridge = Array.isArray(actData.recent) ? actData.recent : recentForBridge;
      _activityRecentCache = recentForBridge;
    }

    if (servers.length && clientChunks.length) {
      const clientLive = clientChunks.flatMap(c => c.live);
      const clientProbes = clientChunks.map(c => c.probe).filter(Boolean);
      live = mergeLiveSourcesClient([live, clientLive]);
      if (!probes.length) probes = clientProbes;
      else {
        const byServer = new Map(probes.map(p => [p.server, p]));
        clientProbes.forEach(p => {
          const prev = byServer.get(p.server);
          if (!prev || (!prev.ok && p.ok) || ((prev.count || 0) === 0 && (p.count || 0) > 0)) {
            byServer.set(p.server, p);
          }
        });
        probes = [...byServer.values()];
      }
    } else if (demoOn) {
      live = await fetchLiveSessionsForServers(collectServersForLive());
    }

    if (!live.length && recentForBridge.length) {
      live = mergeLiveSourcesClient([live, inferBridgeLiveFromRecent(recentForBridge)]);
    }

    // Ground-truth pass: once we've probed servers directly, bridge-inferred rows
    // on reachable servers that aren't real sessions are stale browses — drop them.
    live = suppressReachableBridgeClient(live, probes);

    const annotated = annotateLiveSessions(live);
    _liveBundleCache = { live: annotated, probes, ts: Date.now() };
    window._mebAnnotatedLive = annotated;
    window._mebAnnotatedLiveTs = _liveBundleCache.ts;
    window._mebLiveProbes = probes;
    renderLiveDock(annotated);
    return _liveBundleCache;
  })().finally(() => { _liveBundleInFlight = null; });
  return _liveBundleInFlight;
}

function liveEmptyMessage(probes, serverCount) {
  const list = probes || [];
  const failed = list.filter(p => !p.ok);
  const okEmpty = list.filter(p => p.ok && (p.count || 0) === 0);
  const n = serverCount || list.length || 0;
  const serverWord = n === 1 ? 'server' : 'servers';
  if (!list.length) {
    return `No live streams detected right now across your ${serverWord}.`;
  }
  if (failed.length === list.length) {
    const names = failed.slice(0, 2).map(p => p.server || p.label).join(', ');
    return `Could not poll live sessions on ${failed.length} ${serverWord}${names ? ` (${names}${failed.length>2?'…':''})` : ''}. Verify API access on the <a href="#" data-page="servers">Servers</a> page.`;
  }
  if (failed.length) {
    const names = failed.slice(0, 2).map(p => p.server || p.label).join(', ');
    return `No active playback right now. ${failed.length} ${serverWord} could not be checked${names ? ` (${names}${failed.length>2?'…':''})` : ''}.`;
  }
  if (okEmpty.length === list.length) {
    return `All ${n} ${serverWord} reachable — no live streams right now (refreshes every ~8s).`;
  }
  return `No live streams detected on your ${serverWord} at the moment.`;
}

function renderLiveDock(live) {
  const list = live || [];
  let dock = document.getElementById('live-dock');
  const onDash = document.getElementById('page-dashboard')?.classList.contains('on');
  if (!list.length || onDash) {
    if (dock) dock.remove();
    document.documentElement.classList.remove('has-live-dock');
    return;
  }
  const solo = list.length === 1 ? list[0] : null;
  const soloServer = solo ? formatBridgeServerLabel(solo) : '';
  // Assigned via .textContent below (which is safe), so DON'T HTML-escape here —
  // doing so double-escapes (e.g. "Romance & Confectionery" → "Romance &amp; …") (UI-2).
  const summary = solo
    ? (soloServer ? `${solo.title} on ${soloServer}` : solo.title)
    : `${list.length} streams active`;
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'live-dock';
    dock.setAttribute('role', 'status');
    dock.innerHTML = `<span class="ld-pulse" aria-hidden="true"></span>
      <span class="ld-text"><span class="ld-title"></span><span class="ld-sub"></span></span>
      <button type="button" class="ld-btn">Details</button>`;
    dock.querySelector('.ld-btn').addEventListener('click', () => {
      location.hash = '#/dashboard';
      const target = document.getElementById('dash-activity');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    document.body.appendChild(dock);
  }
  dock.querySelector('.ld-title').textContent = summary;
  const sources = [...new Set(list.map(s => s.source).filter(Boolean))];
  dock.querySelector('.ld-sub').textContent = sources.includes('bridge')
    ? 'Live via bridge + server Sessions'
    : 'Live from your media servers';
  document.documentElement.classList.add('has-live-dock');
}

async function pollLivePlaybackNotifications(opts = {}) {
  const onDash = document.getElementById('page-dashboard')?.classList.contains('on');
  const dashBundle = window.DashboardState?.lastBundle;
  const dashReady = window.DashboardState?.lifecycle === 'ready'
    || window.DashboardState?.lifecycle === 'polling';
  const dashFresh = dashBundle?.ts && Date.now() - dashBundle.ts < DASH_LIVE_POLL_MS;

  if (onDash && dashReady && dashBundle && !opts.force) {
    _syncLiveCacheFromBundle(dashBundle);
    const buffering = (dashBundle.live || []).filter(s => s.buffering);
    renderBufferingBanner(buffering);
    updateDashboardBufferBadge(buffering.length);
    notifyNewBuffering(buffering);
    return dashBundle.live || [];
  }

  if (!onDash && window.DashboardApi?.fetchBundle && !opts.force) {
    const ttl = LIVE_PLAYBACK_POLL_MS;
    if (_liveBundleCache.ts && Date.now() - _liveBundleCache.ts < ttl) {
      const buffering = (_liveBundleCache.live || []).filter(s => s.buffering);
      renderBufferingBanner(buffering);
      updateDashboardBufferBadge(buffering.length);
      notifyNewBuffering(buffering);
      return _liveBundleCache.live || [];
    }
    const liveBundle = await window.DashboardApi.fetchBundle('live');
    if (liveBundle && !liveBundle.error) {
      _syncLiveCacheFromBundle(liveBundle);
      const buffering = (liveBundle.live || []).filter(s => s.buffering);
      renderBufferingBanner(buffering);
      updateDashboardBufferBadge(buffering.length);
      notifyNewBuffering(buffering);
      return liveBundle.live || [];
    }
  }

  if (onDash && dashFresh && dashBundle && !opts.force) {
    _syncLiveCacheFromBundle(dashBundle);
    const buffering = (dashBundle.live || []).filter(s => s.buffering);
    renderBufferingBanner(buffering);
    updateDashboardBufferBadge(buffering.length);
    notifyNewBuffering(buffering);
    return dashBundle.live || [];
  }
  const stale = !_liveBundleCache.ts || Date.now() - _liveBundleCache.ts >= DASH_LIVE_POLL_MS;
  const bundle = await fetchLiveBundle(!!opts.force && stale, { fast: onDash });
  const buffering = (bundle.live || []).filter(s => s.buffering);
  renderBufferingBanner(buffering);
  updateDashboardBufferBadge(buffering.length);
  notifyNewBuffering(buffering);
  if (onDash && typeof renderDashActivity === 'function') {
    renderDashActivity({ bundle, refreshLive: true });
  }
  return bundle.live || [];
}

function startDashLivePolling() {
  clearInterval(_dashLiveTimer);
  _dashLiveTimer = setInterval(() => {
    const dash = document.getElementById('page-dashboard');
    if (!dash || !dash.classList.contains('on')) return;
    pollLivePlaybackNotifications();
  }, DASH_LIVE_POLL_MS);
}

function stopDashLivePolling() {
  clearInterval(_dashLiveTimer);
  _dashLiveTimer = null;
}

window.fetchLiveBundle = fetchLiveBundle;
