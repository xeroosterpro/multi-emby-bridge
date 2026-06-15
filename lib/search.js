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

// Light fields for library search — real clients fetch PlaybackInfo separately.
const SEARCH_FIELDS = 'ProviderIds,Name,Id,ProductionYear,SeriesName,IndexNumber,ParentIndexNumber';
const DEFAULT_FIELDS = SEARCH_FIELDS;

/** Try lookup strategies one at a time (Shield-like), not parallel bursts. */
async function tryQueries(fns) {
  for (const fn of fns) {
    try {
      const r = await fn();
      if (Array.isArray(r) && r.length > 0) return r;
    } catch (err) {
      if (err.circuitOpen) throw err;
    }
  }
  return [];
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
}

async function queryServerForMovie(server, imdbId) {
  const cached = getResolved(server, 'movie', imdbId, null, null);
  if (cached !== undefined) return cached;

  const queryItems = async (basePath, params, limit = 10) => {
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
    const validated = rawItems.filter((i) => isMatchingProviderId(i.ProviderIds, imdbId));
    console.log(`[${server.label}] ${basePath} ${JSON.stringify(params)}: ${rawItems.length} raw → ${validated.length} validated`);
    return validated;
  };

  let items = [];
  const numericImdbId = imdbId.replace(/^tt0*/i, '');

  if (server.type === 'jellyfin') {
    const metaPromise = resolveImdbName(imdbId, 'movie');

    items = await tryQueries(
      [`imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}`].map((val) =>
        () => queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: val })
      )
    );

    const meta = await metaPromise;
    const metaYear = meta?.year;
    if (items.length > 0 && metaYear) {
      const yearFiltered = items.filter((i) => !i.ProductionYear || Math.abs(i.ProductionYear - metaYear) <= 1);
      if (yearFiltered.length > 0) items = yearFiltered;
    }

    if (items.length === 0) {
      try {
        const movieName = meta?.name;
        if (movieName) {
          console.log(`[${server.label}] Jellyfin: searching movie by name "${movieName}"`);
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
          items = (data.Items || []).filter((i) => {
            const sn = (i.Name || '').toLowerCase().trim();
            const qn = movieName.toLowerCase().trim();
            if (!(sn === qn || sn.includes(qn))) return false;
            if (metaYear && i.ProductionYear) return Math.abs(i.ProductionYear - metaYear) <= 1;
            return true;
          });
          console.log(`[${server.label}] Jellyfin name movie search "${movieName}": ${(data.Items || []).length} raw → ${items.length} name-matched`);
        }
      } catch (err) {
        console.error(`[${server.label}] Jellyfin name search failed:`, err.message);
      }
    }
  } else {
    const metaPromise = resolveImdbName(imdbId, 'movie');

    items = await tryQueries([
      () => queryItems(`/Users/${server.userId}/Items`, { ImdbId: imdbId }),
      () => queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: `imdb.${imdbId}` }),
      () => queryItems('/Items', { ImdbId: imdbId }),
    ]);

    const meta = await metaPromise;
    const metaYear = meta?.year;
    if (items.length > 0 && metaYear) {
      const yearFiltered = items.filter((i) => !i.ProductionYear || Math.abs(i.ProductionYear - metaYear) <= 1);
      if (yearFiltered.length > 0) items = yearFiltered;
    }

    if (items.length === 0) {
      try {
        const movieName = meta?.name;
        if (movieName) {
          console.log(`[${server.label}] Resolved ${imdbId} → "${movieName}", searching Emby by name`);
          const resp = await apiFetch(server, () => {
            const url = new URL(`${server.url}/Users/${server.userId}/Items`);
            url.searchParams.set('SearchTerm', movieName);
            url.searchParams.set('Fields', DEFAULT_FIELDS);
            url.searchParams.set('Recursive', 'true');
            url.searchParams.set('Limit', '20');
            url.searchParams.set('IncludeItemTypes', 'Movie');
            url.searchParams.set('Filters', 'IsNotFolder');
            return url;
          });
          const data = await resp.json();
          items = (data.Items || []).filter((i) => {
            const sn = (i.Name || '').toLowerCase().trim();
            const qn = movieName.toLowerCase().trim();
            if (!(sn === qn || sn.includes(qn))) return false;
            if (metaYear && i.ProductionYear) return Math.abs(i.ProductionYear - metaYear) <= 1;
            return true;
          });
          console.log(`[${server.label}] Emby name movie search "${movieName}": ${(data.Items || []).length} raw → ${items.length} name-matched`);
        }
      } catch (err) {
        console.error(`[${server.label}] Emby name search failed:`, err.message);
      }
    }
  }

  const out = dedupeItems(items);
  setResolved(server, 'movie', imdbId, null, null, out);
  return out;
}

async function queryServerForEpisode(server, imdbId, season, episode) {
  const cached = getResolved(server, 'series', imdbId, season, episode);
  if (cached !== undefined) return cached;

  const numericImdbId = imdbId.replace(/^tt0*/i, '');

  const findSeriesById = async (params) => {
    const resp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set('IncludeItemTypes', 'Series');
      url.searchParams.set('Fields', DEFAULT_FIELDS);
      url.searchParams.set('Recursive', 'true');
      url.searchParams.set('Limit', '10');
      return url;
    });
    const data = await resp.json();
    const validated = (data.Items || []).filter((i) => isMatchingProviderId(i.ProviderIds, imdbId));
    console.log(`[${server.label}] findSeriesById ${JSON.stringify(params)}: ${(data.Items || []).length} raw → ${validated.length} validated`);
    return validated;
  };

  const findSeriesByName = async (name) => {
    const resp = await apiFetch(server, () => {
      const url = new URL(`${server.url}/Users/${server.userId}/Items`);
      url.searchParams.set('SearchTerm', name);
      url.searchParams.set('IncludeItemTypes', 'Series');
      url.searchParams.set('Fields', DEFAULT_FIELDS);
      url.searchParams.set('Recursive', 'true');
      url.searchParams.set('Limit', '5');
      return url;
    });
    const data = await resp.json();
    const results = (data.Items || []).filter((i) => {
      const sn = (i.Name || '').toLowerCase().trim();
      const qn = name.toLowerCase().trim();
      return sn === qn || sn.includes(qn);
    });
    console.log(`[${server.label}] findSeriesByName "${name}": ${(data.Items || []).length} raw → ${results.length} name-matched`);
    return results;
  };

  let seriesItems = [];

  try {
    const metaPromise = resolveImdbName(imdbId, 'series');

    seriesItems = await tryQueries([
      () => findSeriesById({ ImdbId: imdbId }),
      ...[`imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}`]
        .map((val) => () => findSeriesById({ AnyProviderIdEquals: val })),
    ]);

    if (seriesItems.length === 0) {
      const seriesName = (await metaPromise)?.name;
      if (seriesName) {
        console.log(`[${server.label}] Name-based series search: "${seriesName}"`);
        seriesItems = await findSeriesByName(seriesName);
      }
    }
  } catch (err) {
    console.error(`[${server.label}] Series search failed:`, err.message);
  }

  if (seriesItems.length === 0) {
    const out = await queryServerForEpisodeDirect(server, imdbId, season, episode);
    setResolved(server, 'series', imdbId, season, episode, out);
    return out;
  }

  const uniqueSeries = dedupeItems(seriesItems);

  let out = [];
  for (const series of uniqueSeries) {
    try {
      const epResp = await apiFetch(server, () => {
        const epUrl = new URL(`${server.url}/Shows/${series.Id}/Episodes`);
        epUrl.searchParams.set('Season', String(season));
        epUrl.searchParams.set('Fields', SEARCH_FIELDS);
        epUrl.searchParams.set('UserId', server.userId);
        return epUrl;
      });
      const epData = await epResp.json();
      const eps = (epData.Items || []).filter((ep) => ep.IndexNumber === episode);
      if (eps.length) {
        out = eps;
        break;
      }
    } catch (err) {
      if (err.circuitOpen) throw err;
      console.error(`[${server.label}] Episodes for series ${series.Id} failed:`, err.message);
    }
  }
  out = dedupeItems(out);
  setResolved(server, 'series', imdbId, season, episode, out);
  return out;
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
