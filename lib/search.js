// ─── IMDB resolution + server search logic ──────────────────────────────────
const fs = require('fs');
const path = require('path');
const { fetchWithTimeout, apiFetch } = require('./auth');
const { isMatchingProviderId } = require('./utils');
const { getResolved, setResolved } = require('./resolveCache');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const IMDB_CACHE_FILE = path.join(DATA_DIR, 'imdb-cache.json');
const IMDB_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── IMDB name cache (persisted to disk) ─────────────────────────────────────
let imdbCache = {};

function loadImdbCache() {
  try {
    if (fs.existsSync(IMDB_CACHE_FILE)) {
      imdbCache = JSON.parse(fs.readFileSync(IMDB_CACHE_FILE, 'utf8'));
      // Prune expired entries
      const now = Date.now();
      let pruned = 0;
      for (const key of Object.keys(imdbCache)) {
        if (imdbCache[key].ts && (now - imdbCache[key].ts) > IMDB_CACHE_TTL) {
          delete imdbCache[key];
          pruned++;
        }
      }
      if (pruned > 0) saveImdbCache();
      console.log(`IMDB cache loaded: ${Object.keys(imdbCache).length} entries`);
    }
  } catch { /* start fresh */ }
}

function saveImdbCache() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(IMDB_CACHE_FILE, JSON.stringify(imdbCache, null, 2), 'utf8');
  } catch { /* non-critical */ }
}

// Debounced write: avoid serializing the whole growing cache file on every
// cache miss, which blocks the event loop. Flush 1s after the last change.
let _imdbSaveTimer = null;
function scheduleImdbSave() {
  if (_imdbSaveTimer) return;
  _imdbSaveTimer = setTimeout(() => { _imdbSaveTimer = null; saveImdbCache(); }, 1000);
  if (_imdbSaveTimer.unref) _imdbSaveTimer.unref();
}

// Load on module init
loadImdbCache();

// ─── Resolve IMDB ID → movie/series name via multiple metadata sources ───────

async function resolveImdbName(imdbId, type) {
  // Check cache first
  const cacheKey = `${imdbId}:${type}`;
  const cached = imdbCache[cacheKey];
  if (cached && cached.ts && (Date.now() - cached.ts) < IMDB_CACHE_TTL) {
    return cached.result;
  }

  const metaType = type === 'series' ? 'series' : 'movie';

  const tryCinemetaMeta = async () => {
    const resp = await fetchWithTimeout(
      `https://v3-cinemeta.strem.io/meta/${metaType}/${imdbId}.json`, 6000
    );
    const data = await resp.json();
    if (data.meta?.name) {
      return { name: data.meta.name, year: data.meta.year ? parseInt(data.meta.year, 10) : null };
    }
    return null;
  };

  const tryImdbSuggestion = async () => {
    const resp = await fetchWithTimeout(
      `https://v3.sg.media-imdb.com/suggestion/x/${imdbId}.json`, 5000
    );
    const data = await resp.json();
    const match = (data.d || []).find(d => d.id === imdbId);
    if (!match?.l) return null;
    const qid = (match.qid || '').toLowerCase();
    if (type === 'series' && (qid === 'tvseries' || qid === 'tvminiseries')) {
      return { name: match.l, year: match.y ?? null };
    }
    if (type === 'movie' && (qid === 'movie' || qid === 'tvmovie')) {
      return { name: match.l, year: match.y ?? null };
    }
    return null;
  };

  const tryCinemetaSearch = async () => {
    const resp = await fetchWithTimeout(
      `https://v3-cinemeta.strem.io/catalog/${metaType}/top/search=${encodeURIComponent(imdbId)}.json`, 5000
    );
    const data = await resp.json();
    if (data.metas?.[0]?.name) {
      return {
        name: data.metas[0].name,
        year: data.metas[0].releaseInfo ? parseInt(data.metas[0].releaseInfo, 10) : null,
      };
    }
    return null;
  };

  const settled = await Promise.allSettled([
    tryCinemetaMeta(),
    tryImdbSuggestion(),
    tryCinemetaSearch(),
  ]);
  let result = null;
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) { result = s.value; break; }
  }

  // Cache the result (even null — prevents repeated failed lookups)
  imdbCache[cacheKey] = { result, ts: Date.now() };
  scheduleImdbSave();

  return result;
}

const DEFAULT_FIELDS = 'ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber,MediaStreams,ProductionYear,SeriesName';

async function queryItems(server, basePath, params, imdbId, limit = 10) {
  const resp = await apiFetch(server, () => {
    const url = new URL(`${server.url}${basePath}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Limit', String(limit));
    url.searchParams.set('IncludeItemTypes', 'Movie');
    url.searchParams.set('Filters', 'IsNotFolder');
    return url;
  });
  const data = await resp.json();
  const rawItems = data.Items || [];
  return rawItems.filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
}

async function queryServerForMovie(server, imdbId) {
  const cached = getResolved(server, 'movie', imdbId, null, null);
  if (cached) return cached;

  const numericImdbId = imdbId.replace(/^tt0*/i, '');
  let items = [];
  const attempts = server.type === 'jellyfin'
    ? [
      { path: `/Users/${server.userId}/Items`, params: { AnyProviderIdEquals: `imdb.${imdbId}` } },
      { path: `/Users/${server.userId}/Items`, params: { AnyProviderIdEquals: `imdb.${numericImdbId}` } },
    ]
    : [
      { path: `/Users/${server.userId}/Items`, params: { ImdbId: imdbId } },
      { path: `/Users/${server.userId}/Items`, params: { AnyProviderIdEquals: `imdb.${imdbId}` } },
      { path: '/Items', params: { ImdbId: imdbId } },
    ];

  for (const { path, params } of attempts) {
    try {
      items = await queryItems(server, path, params, imdbId);
      if (items.length) break;
    } catch { /* try next */ }
  }

  if (items.length === 0) {
    try {
      const meta = await resolveImdbName(imdbId, 'movie');
      const movieName = meta?.name;
      const metaYear = meta?.year;
      if (movieName) {
        const resp = await apiFetch(server, () => {
          const url = new URL(`${server.url}/Users/${server.userId}/Items`);
          url.searchParams.set('SearchTerm', movieName);
          url.searchParams.set('Fields', DEFAULT_FIELDS);
          url.searchParams.set('Recursive', 'true');
          url.searchParams.set('Limit', '10');
          url.searchParams.set('IncludeItemTypes', 'Movie');
          url.searchParams.set('Filters', 'IsNotFolder');
          return url;
        });
        const data = await resp.json();
        items = (data.Items || []).filter(i => {
          const sn = (i.Name || '').toLowerCase().trim();
          const qn = movieName.toLowerCase().trim();
          if (!(sn === qn || sn.includes(qn))) return false;
          if (metaYear && i.ProductionYear) return Math.abs(i.ProductionYear - metaYear) <= 1;
          return isMatchingProviderId(i.ProviderIds, imdbId) || sn === qn;
        });
      }
    } catch { /* optional fallback */ }
  }

  const seen = new Set();
  const out = items.filter(item => {
    if (seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  }).slice(0, 1);
  setResolved(server, 'movie', imdbId, null, null, out);
  return out;
}

async function queryServerForEpisode(server, imdbId, season, episode) {
  const cached = getResolved(server, 'series', imdbId, season, episode);
  if (cached) return cached;

  const numericImdbId = imdbId.replace(/^tt0*/i, '');

  const findSeriesById = async (params) => {
    const resp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('IncludeItemTypes', 'Series');
      url.searchParams.set('Fields', DEFAULT_FIELDS);
      url.searchParams.set('Recursive', 'true');
      url.searchParams.set('Limit', '5');
      return url;
    });
    const data = await resp.json();
    return (data.Items || []).filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
  };

  let seriesItems = [];
  const seriesAttempts = [
    { ImdbId: imdbId },
    { AnyProviderIdEquals: `imdb.${imdbId}` },
    { AnyProviderIdEquals: `imdb.${numericImdbId}` },
  ];
  for (const params of seriesAttempts) {
    try {
      seriesItems = await findSeriesById(params);
      if (seriesItems.length) break;
    } catch { /* next */ }
  }

  if (seriesItems.length === 0) {
    try {
      const seriesName = (await resolveImdbName(imdbId, 'series'))?.name;
      if (seriesName) {
        const resp = await apiFetch(server, () => {
          const url = new URL(`${server.url}/Users/${server.userId}/Items`);
          url.searchParams.set('SearchTerm', seriesName);
          url.searchParams.set('IncludeItemTypes', 'Series');
          url.searchParams.set('Fields', DEFAULT_FIELDS);
          url.searchParams.set('Recursive', 'true');
          url.searchParams.set('Limit', '3');
          return url;
        });
        const data = await resp.json();
        const qn = seriesName.toLowerCase().trim();
        seriesItems = (data.Items || []).filter(i => {
          const sn = (i.Name || '').toLowerCase().trim();
          return sn === qn || sn.includes(qn);
        });
      }
    } catch { /* fallback below */ }
  }

  if (seriesItems.length === 0) {
    const direct = await queryServerForEpisodeDirect(server, imdbId, season, episode);
    const out = direct.slice(0, 1);
    setResolved(server, 'series', imdbId, season, episode, out);
    return out;
  }

  const series = seriesItems[0];
  try {
    const epResp = await apiFetch(server, () => {
      const epUrl = new URL(`${server.url}/Shows/${series.Id}/Episodes`);
      epUrl.searchParams.set('Season', String(season));
      epUrl.searchParams.set('Fields', DEFAULT_FIELDS);
      epUrl.searchParams.set('UserId', server.userId);
      return epUrl;
    });
    const epData = await epResp.json();
    const eps = (epData.Items || []).filter((ep) => ep.IndexNumber === episode).slice(0, 1);
    setResolved(server, 'series', imdbId, season, episode, eps);
    return eps;
  } catch {
    const direct = await queryServerForEpisodeDirect(server, imdbId, season, episode);
    const out = direct.slice(0, 1);
    setResolved(server, 'series', imdbId, season, episode, out);
    return out;
  }
}

async function queryServerForEpisodeDirect(server, imdbId, season, episode) {
  const makeUrl = (params) => {
    const url = new URL(`${server.url}/Users/${server.userId}/Items`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('IncludeItemTypes', 'Episode');
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('ParentIndexNumber', String(season));
    url.searchParams.set('IndexNumber', String(episode));
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Limit', '50');
    return url;
  };

  let items = [];
  try {
    const metaPromise = resolveImdbName(imdbId, 'series');

    const seriesNameMatches = (item, expectedName) => {
      if (!expectedName || !item.SeriesName) return true;
      const sn = item.SeriesName.toLowerCase().trim();
      const qn = expectedName.toLowerCase().trim();
      return sn === qn || sn.includes(qn) || qn.includes(sn);
    };

    if (server.type === 'jellyfin') {
      const seriesName = (await metaPromise)?.name;
      if (seriesName) {
        console.log(`[${server.label}] Direct episode fallback: searching episodes by name "${seriesName}"`);
        const resp = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }));
        items = ((await resp.json()).Items || []).filter(i => seriesNameMatches(i, seriesName));
      }
    } else {
      const [providerItems, seriesMeta] = await Promise.all([
        apiFetch(server, () => makeUrl({ AnyProviderIdEquals: `imdb.${imdbId}` }))
          .then(r => r.json()).then(d => d.Items || []).catch(() => []),
        metaPromise,
      ]);
      const seriesName = seriesMeta?.name;

      if (providerItems.length > 0) {
        items = providerItems;
      } else if (seriesName) {
        console.log(`[${server.label}] Direct episode fallback: searching Emby episodes by name "${seriesName}"`);
        const resp2 = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }));
        items = ((await resp2.json()).Items || []).filter(i => seriesNameMatches(i, seriesName));
      }
    }
  } catch (err) {
    console.error(`[${server.label}] Direct episode search failed:`, err.message);
    return [];
  }

  const seen = new Set();
  const filtered = items
    .filter((item) => item.ParentIndexNumber === season && item.IndexNumber === episode)
    .filter((item) => {
      if (seen.has(item.Id)) return false;
      seen.add(item.Id);
      return true;
    });

  console.log(`[${server.label}] Direct episode fallback: ${items.length} raw → ${filtered.length} after validation`);
  return filtered;
}

// ─── Catalog search (unified across all servers) ──────────────────────────────
async function searchServersForCatalog(servers, type, query, timeoutMs = 8000, rpdbKey = null, catalogLang = null) {
  const itemType  = type === 'movie' ? 'Movie' : 'Series';
  const qn        = query.toLowerCase().trim();
  const posterKey = rpdbKey || 't2-3b15b466-4b6f-42bd-a2eb-adf50aba65b2';

  const results = await Promise.allSettled(servers.map(async (server) => {
    const resp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      url.searchParams.set('SearchTerm',       query);
      url.searchParams.set('IncludeItemTypes', itemType);
      url.searchParams.set('Fields',           `${DEFAULT_FIELDS},Overview,ProductionYear,CommunityRating,VoteCount`);
      url.searchParams.set('Recursive',        'true');
      url.searchParams.set('Limit',            '20');
      url.searchParams.set('EnableImages',     'false');
      if (catalogLang) {
        const langMap = { en: 'eng', fr: 'fre', es: 'spa', de: 'ger', ja: 'jpn', ko: 'kor', pt: 'por' };
        const code3 = langMap[catalogLang];
        if (code3) url.searchParams.set('AudioLanguages', code3);
      }
      return url;
    }, timeoutMs);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.Items || []).filter(item => {
      const sn = (item.Name || '').toLowerCase().trim();
      return sn === qn || sn.includes(qn);
    });
  }));

  const seen = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      const imdbId = item.ProviderIds?.Imdb || item.ProviderIds?.imdb;
      if (!imdbId || !imdbId.startsWith('tt')) continue;
      if (seen.has(imdbId)) continue;
      const sn = (item.Name || '').toLowerCase().trim();
      const relevance = sn === qn ? 3 : sn.startsWith(qn) ? 2 : 1;
      const popularity = (item.CommunityRating || 0) * Math.log1p(item.VoteCount || 0);
      const year = item.ProductionYear || 0;
      seen.set(imdbId, {
        id: imdbId, type, name: item.Name,
        poster: `https://api.ratingposterdb.com/${posterKey}/imdb/poster-default/${imdbId}.jpg`,
        _relevance: relevance, _popularity: popularity, _year: year,
        ...(item.Overview       && { description: item.Overview }),
        ...(item.ProductionYear && { releaseInfo: String(item.ProductionYear) }),
      });
    }
  }

  return [...seen.values()]
    .sort((a, b) =>
      (b._relevance - a._relevance) ||
      (b._popularity - a._popularity) ||
      (b._year - a._year)
    )
    .map(({ _relevance, _popularity, _year, ...meta }) => meta);
}

// ─── Next Up catalog ─────────────────────────────────────────────────────────
async function getNextUp(servers, timeoutMs, rpdbKey) {
  const posterKey = rpdbKey || 't2-3b15b466-4b6f-42bd-a2eb-adf50aba65b2';
  const seen = new Map();
  await Promise.allSettled(servers.map(async (server) => {
    // 1) next-up episodes (carry SeriesId + SeriesName)
    const epResp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Shows/NextUp`);
      url.searchParams.set('UserId', server.userId);
      url.searchParams.set('Limit', '24');
      url.searchParams.set('Fields', 'SeriesId,SeriesName');
      return url;
    }, timeoutMs);
    if (!epResp.ok) return;
    const epData = await epResp.json();
    const eps = Array.isArray(epData) ? epData : (epData?.Items || []);
    const localSids = new Set();
    const order = [];
    for (const ep of eps) {
      if (!ep.SeriesId || localSids.has(ep.SeriesId)) continue;
      localSids.add(ep.SeriesId);
      order.push({ sid: ep.SeriesId, sname: ep.SeriesName });
    }
    const seriesIds = [...localSids];
    if (!seriesIds.length) return;
    // 2) resolve those series → ProviderIds (imdb)
    const seResp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      url.searchParams.set('Ids', seriesIds.join(','));
      url.searchParams.set('IncludeItemTypes', 'Series');
      url.searchParams.set('Fields', 'ProviderIds');
      return url;
    }, timeoutMs);
    if (!seResp.ok) return;
    const seData = await seResp.json();
    const seItems = Array.isArray(seData) ? seData : (seData?.Items || []);
    const imdbBySid = new Map();
    for (const s of seItems) {
      const imdb = s.ProviderIds?.Imdb || s.ProviderIds?.imdb;
      if (imdb && imdb.startsWith('tt')) imdbBySid.set(s.Id, { imdb, name: s.Name });
    }
    for (const { sid, sname } of order) {
      const hit = imdbBySid.get(sid);
      if (!hit || seen.has(hit.imdb)) continue;
      seen.set(hit.imdb, {
        id: hit.imdb, type: 'series', name: hit.name || sname || hit.imdb,
        poster: `https://api.ratingposterdb.com/${posterKey}/imdb/poster-default/${hit.imdb}.jpg`,
      });
    }
  }));
  return [...seen.values()].slice(0, 20);
}

// ─── Recently Added catalog ──────────────────────────────────────────────────
async function getRecentlyAdded(servers, type, timeoutMs = 8000, rpdbKey = null, catalogContent = 'recent', catalogLang = null) {
  const itemType = type === 'movie' ? 'Movie' : 'Series';

  if (catalogContent === 'nextup') {
    if (type !== 'series') return [];   // Next Up is series-only
    return await getNextUp(servers, timeoutMs, rpdbKey);
  }
  const posterKey = rpdbKey || 't2-3b15b466-4b6f-42bd-a2eb-adf50aba65b2';
  const FIELDS = 'ProviderIds,Name,Overview,ProductionYear,CommunityRating';

  const results = await Promise.allSettled(servers.map(async (server) => {
    const resp = await apiFetch(server, () => {
      let url;
      if (catalogContent === 'resume') {
        url = new URL(`${server.url}/Users/${server.userId}/Items/Resume`);
        url.searchParams.set('MediaType', 'Video');
        url.searchParams.set('IncludeItemTypes', itemType);
      } else if (catalogContent === 'favorites') {
        url = new URL(`${server.url}/Users/${server.userId}/Items`);
        url.searchParams.set('IncludeItemTypes', itemType);
        url.searchParams.set('Filters', 'IsFavorite');
        url.searchParams.set('SortBy', 'DateCreated,SortName');
        url.searchParams.set('SortOrder', 'Descending');
      } else {
        // recently added (default)
        url = new URL(`${server.url}/Users/${server.userId}/Items/Latest`);
        url.searchParams.set('IncludeItemTypes', itemType);
      }
      url.searchParams.set('Fields', FIELDS);
      url.searchParams.set('Limit', '20');
      url.searchParams.set('EnableImages', 'false');
      return url;
    }, timeoutMs);
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = Array.isArray(data) ? data : (data?.Items || []);
    return items.filter(i => i.Type === itemType);
  }));

  const seen = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const items = Array.isArray(result.value) ? result.value : [];
    for (const item of items) {
      const imdbId = item.ProviderIds?.Imdb || item.ProviderIds?.imdb;
      if (!imdbId || !imdbId.startsWith('tt')) continue;
      if (seen.has(imdbId)) continue;
      seen.set(imdbId, {
        id: imdbId, type, name: item.Name,
        poster: `https://api.ratingposterdb.com/${posterKey}/imdb/poster-default/${imdbId}.jpg`,
        ...(item.Overview       && { description: item.Overview }),
        ...(item.ProductionYear && { releaseInfo: String(item.ProductionYear) }),
      });
    }
  }

  return [...seen.values()].slice(0, 20);
}

module.exports = {
  resolveImdbName,
  queryServerForMovie,
  queryServerForEpisode,
  queryServerForEpisodeDirect,
  searchServersForCatalog,
  getRecentlyAdded,
  DEFAULT_FIELDS,
};
