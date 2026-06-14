// configure/dashboard-library.js — library stats batch + hydration
function _batchLibOriginKey(url) {
  try { return 'origin:' + new URL(url).origin.toLowerCase(); } catch { return null; }
}

function _batchLibRow(batchMap, server) {
  if (!batchMap) return null;
  const labelKey = 'label:' + String(server.label || '').trim().toLowerCase();
  if (server.label && batchMap.has(labelKey)) return batchMap.get(labelKey);
  const urlKey = _normServerUrl(server.url);
  if (batchMap.has(urlKey)) return batchMap.get(urlKey);
  const originKey = _batchLibOriginKey(server.url);
  if (originKey && batchMap.has(originKey)) return batchMap.get(originKey);
  return null;
}

async function _fetchDashboardLibraryStatsBatch() {
  try {
    // Shortish client timeout on batch so one problematic server doesn't delay the whole dashboard library hydration
    const r = await _fetchWithTimeout('/api/dashboard/library-stats', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    }, 9000);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}`, map: null };
    const map = new Map();
    (data.servers || []).forEach(row => {
      map.set(_normServerUrl(row.url), row);
      if (row.label) map.set('label:' + String(row.label).trim().toLowerCase(), row);
      const originKey = _batchLibOriginKey(row.url);
      if (originKey) map.set(originKey, row);
    });
    return { ok: true, map };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'timeout', map: null };
    return { ok: false, error: err?.message || 'Batch library stats failed', map: null };
  }
}

async function _applyDashLibraryStats(card, server, opts) {
  const { setStats, force, cachedLib, now, batchMap } = opts;
  const label = _dashServerLabel(server);
  const k = _libKey(server);
  // Batch (authoritative DB creds) wins over local cache — cache was blocking fresh counts.
  const batchRow = batchMap ? _batchLibRow(batchMap, server) : null;
  if (batchRow) {
    if (batchRow.ok) {
      setStats({ movies: batchRow.movies, shows: batchRow.shows, episodes: batchRow.episodes });
      _libStatsCache[k] = {
        movies: batchRow.movies || 0,
        shows: batchRow.shows || 0,
        episodes: batchRow.episodes || 0,
        ts: now,
      };
      _saveLibCache();
      _recalcDashLibTiles();
      dashConsoleLog(
        `Library stats · ${label} — ${(batchRow.movies || 0).toLocaleString()} movies, ${(batchRow.shows || 0).toLocaleString()} shows (batch)`,
        'ok',
      );
      if (batchRow.apiKey) {
        const block = [...document.querySelectorAll('.server-block')].find(b =>
          _normServerUrl(b.querySelector('.f-url')?.value) === _normServerUrl(server.url)
        );
        if (block) _applyRefreshedApiKey(block, batchRow.apiKey);
      }
    } else {
      _applyDashLibStatsError(card, batchRow.error);
      dashConsoleLog(`Library stats · ${label} — ${batchRow.error || 'failed'}`, 'err');
    }
    return;
  }
  if (batchMap && !batchRow) {
    dashConsoleLog(`Library stats · ${label} — no batch row (check label/URL match)`, 'warn');
  }
  if (!force && cachedLib) {
    setStats(cachedLib);
    _recalcDashLibTiles();
    dashConsoleLog(`Library stats · ${label} — from cache (${(cachedLib.movies || 0).toLocaleString()} movies)`, 'ok');
    return;
  }
  dashConsoleLog(`Library stats · ${label} — POST /api/library-stats`, 'busy');
  try {
    const res = await _fetchLibraryStats(server);
    if (res.ok) {
      setStats(res.stats);
      _libStatsCache[k] = {
        movies: res.stats.movies || 0,
        shows: res.stats.shows || 0,
        episodes: res.stats.episodes || 0,
        ts: now,
      };
      _saveLibCache();
      _recalcDashLibTiles();
      dashConsoleLog(
        `Library stats · ${label} — ${(res.stats.movies || 0).toLocaleString()} movies, ${(res.stats.shows || 0).toLocaleString()} shows`,
        'ok',
      );
    } else {
      _applyDashLibStatsError(card, res.error);
      dashConsoleLog(`Library stats · ${label} — ${res.error || 'failed'}`, 'err');
    }
  } catch (err) {
    _applyDashLibStatsError(card, err?.message || 'Library stats failed');
    dashConsoleLog(`Library stats · ${label} — ${err?.message || 'failed'}`, 'err');
  }
}

try { _libStatsCache = JSON.parse(localStorage.getItem('meb-libstats-cache') || '{}'); } catch { _libStatsCache = {}; }
function _libKey(s) {
  if (_useAccountCredsForApi()) return _normServerUrl(s.url);
  return [s.url, s.apiKey, s.userId].join('|');
}
function _saveLibCache(){ try { localStorage.setItem('meb-libstats-cache', JSON.stringify(_libStatsCache)); } catch {} }
const LIB_TTL_MS = 60 * 60 * 1000; // 1 hour
const LIB_STATS_CONCURRENCY = 3;

function _recalcDashLibTiles() {
  const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  let movies = 0;
  let shows = 0;
  document.querySelectorAll('#dash-cards .gcard[data-server-url]').forEach(card => {
    const m = parseInt((card.querySelector('[data-st=movies]')?.textContent || '').replace(/,/g, ''), 10);
    const sh = parseInt((card.querySelector('[data-st=shows]')?.textContent || '').replace(/,/g, ''), 10);
    if (!isNaN(m)) movies += m;
    if (!isNaN(sh)) shows += sh;
  });
  setTxt('tile-movies', movies.toLocaleString());
  setTxt('tile-shows', shows.toLocaleString());
}

function _applyDashLibStatsError(card, message) {
  ['movies', 'shows', 'episodes'].forEach((k, i) => {
    const el = card.querySelector(`[data-st=${k}]`);
    if (!el) return;
    el.textContent = i === 0 ? '!' : '—';
    el.title = message || 'Library stats unavailable';
    el.classList.add('gchip-err');
  });
}

function _dashCardForServer(cards, server) {
  const sUrl = _normServerUrl(server.url);
  const label = String(server.label || '').trim();
  return [...cards].find(c => {
    if (_normServerUrl(c.dataset.serverUrl) === sUrl) return true;
    const nm = c.querySelector('.gcard-nm')?.textContent?.trim();
    return label && nm === label;
  }) || null;
}

function _makeDashSetStats(card) {
  return (st) => {
    ['movies', 'shows', 'episodes'].forEach(k => {
      const el = card.querySelector(`[data-st=${k}]`);
      if (!el) return;
      el.textContent = (st[k] || 0).toLocaleString();
      el.title = '';
      el.classList.remove('gchip-err');
    });
  };
}

async function hydrateDashLibraryStats(force = false) {
  const hydrateGen = ++_libHydrateGen;
  const cards = document.querySelectorAll('#dash-cards .gcard[data-server-url]');
  if (!cards.length) return;

  const servers = _mergeAccountCredsIntoServers(_collectDashboardServers());
  const now = Date.now();
  dashConsoleLog(force ? 'Refreshing library stats for all servers…' : 'Hydrating library stats…', 'busy');
  let batchLibMap = null;
  if (_useAccountCredsForApi()) {
    dashConsoleLog('POST /api/dashboard/library-stats (batch)', 'busy');
    const batch = await _fetchDashboardLibraryStatsBatch();
    if (hydrateGen !== _libHydrateGen) return;
    if (batch.ok) {
      batchLibMap = batch.map;
      const rows = batch.map ? [...batch.map.values()] : [];
      const n = new Set(rows.map(r => _normServerUrl(r.url))).size;
      dashConsoleLog(`Batch library stats — ${n} server row(s) received`, 'ok');
    } else {
      dashConsoleLog(`Batch library stats — ${batch.error || 'failed'}`, 'err');
    }
  }

  // HUGE LOAD WIN: show any cached last-known lib counts *immediately* (optimistic, non-blocking).
  // Good boxes get numbers/history fast; only missing/forced ones do real work.
  servers.forEach(s => {
    const card = _dashCardForServer(Array.from(cards), s);
    if (!card) return;
    const setStats = _makeDashSetStats(card);
    const cacheKey = _libKey(s);
    const cachedLib = (!force && _libStatsCache[cacheKey] && (now - _libStatsCache[cacheKey].ts < LIB_TTL_MS))
      ? _libStatsCache[cacheKey] : null;
    if (cachedLib) {
      setStats(cachedLib);
    }
  });
  _recalcDashLibTiles();

  await _mapPool(servers, async (s) => {
    if (hydrateGen !== _libHydrateGen) return;
    const card = _dashCardForServer(cards, s);
    if (!card) return;
    const setStats = _makeDashSetStats(card);
    const cacheKey = _libKey(s);
    const cachedLib = (!force && _libStatsCache[cacheKey] && (now - _libStatsCache[cacheKey].ts < LIB_TTL_MS))
      ? _libStatsCache[cacheKey] : null;
    if (cachedLib) {
      setStats(cachedLib);
      _recalcDashLibTiles();
    }
    const shouldFetch = force || batchLibMap || _useAccountCredsForApi() || !cachedLib;
    if (!shouldFetch) return;
    if (!cachedLib || force) {
      dashConsoleLog(`Loading library for ${_dashServerLabel(s)}…`, 'busy');
    }
    await _applyDashLibraryStats(card, s, {
      setStats,
      force,
      cachedLib: (force || batchLibMap) ? null : cachedLib,
      now,
      batchMap: batchLibMap,
    });
  }, LIB_STATS_CONCURRENCY);

  if (hydrateGen === _libHydrateGen) {
    _recalcDashLibTiles();
    dashConsoleLog('Library stats hydration complete', 'ok');
  }
}

async function _fetchLibraryStats(server) {
  try {
    const r = await _fetchWithTimeout('/api/library-stats', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_serverApiBody(server)),
    }, 8000);
    const data = await r.json().catch(() => ({}));
    if (data.apiKey) {
      const block = [...document.querySelectorAll('.server-block')].find(b =>
        _normServerUrl(b.querySelector('.f-url')?.value) === _normServerUrl(server.url)
      );
      if (block) _applyRefreshedApiKey(block, data.apiKey);
    }
    if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` };
    return { ok: true, stats: data };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false };
  }
}

window.hydrateDashLibraryStats = hydrateDashLibraryStats;
