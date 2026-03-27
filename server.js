const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 7000;

// ─── Profile storage ──────────────────────────────────────────────────────────
// Persistent: DATA_DIR/profiles.json (set DATA_DIR env var for Railway volume)
// Falls back to ./data/profiles.json — always cached in memory so even if
// the filesystem is unavailable, profiles survive until the process restarts.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

let profilesCache = null; // in-memory cache — survives failed disk writes

function loadProfiles() {
  if (profilesCache) return profilesCache;
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      profilesCache = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    } else {
      profilesCache = {};
    }
  } catch {
    profilesCache = {};
  }
  return profilesCache;
}

function saveProfiles(profiles) {
  profilesCache = profiles; // always save to memory first
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Could not write profiles file:', err.message);
    return false; // still saved in memory
  }
}

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

// ─── CORS (required by Stremio) ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Config encode/decode ─────────────────────────────────────────────────────

function decodeConfig(encoded) {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStreamId(type, id) {
  if (type === 'movie') {
    return { imdbId: id, season: null, episode: null };
  }
  const parts = id.split(':');
  return {
    imdbId: parts[0],
    season: parseInt(parts[1], 10),
    episode: parseInt(parts[2], 10),
  };
}

function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function detectSourceLabel(source) {
  const str = ((source.Path || '') + ' ' + (source.Name || '')).toLowerCase();
  if (str.includes('remux'))                            return 'REMUX';
  if (str.includes('web-dl') || str.includes('webdl'))  return 'WEB-DL';
  if (str.includes('webrip'))                           return 'WEB-RIP';
  if (str.includes('bluray') || str.includes('blu-ray')) return 'BluRay';
  if (str.includes('hdtv'))                             return 'HDTV';
  return null;
}

// ─── Auto-renewing API key cache ─────────────────────────────────────────────
// When a server returns 401, we re-authenticate using stored credentials and
// cache the fresh token. All subsequent requests use the cached token.
// The config URL never needs updating — renewal is fully automatic.

const tokenCache = new Map(); // serverUrl → fresh apiKey string

function getEffectiveApiKey(server) {
  return tokenCache.get(server.url) || server.apiKey;
}

async function reauthenticate(server) {
  if (!server.username || !server.password) return false;
  console.log(`[${server.label}] API key expired — re-authenticating automatically...`);
  try {
    const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-auto-auth", Version="1.0.0"';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch(`${server.url}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'X-Emby-Authorization': authHeader,
        },
        body: JSON.stringify({ Username: server.username, Pw: server.password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      console.error(`[${server.label}] Re-auth failed: HTTP ${resp.status}`);
      return false;
    }
    const data = await resp.json();
    if (data.AccessToken) {
      tokenCache.set(server.url, data.AccessToken);
      console.log(`[${server.label}] Re-authenticated successfully ✓`);
      return true;
    }
  } catch (err) {
    console.error(`[${server.label}] Re-auth error:`, err.message);
  }
  return false;
}

// ─── Server-aware fetch with auto-retry on 401 ───────────────────────────────

async function apiFetch(server, buildUrl, timeoutMs = server._timeout || 10000) {
  // buildUrl: () => URL object (called fresh on each attempt so new key is applied)
  const attempt = async () => {
    const url = buildUrl();
    appendAuth(url, server);
    const headers = authHeaders(server);
    return fetchWithTimeout(url.toString(), timeoutMs, { headers });
  };
  try {
    return await attempt();
  } catch (err) {
    if (err.status === 401 && await reauthenticate(server)) {
      return await attempt(); // retry with fresh cached key
    }
    throw err;
  }
}

function buildStreamUrl(server, itemId, sourceId, container) {
  const ext = container ? `.${container.toLowerCase()}` : '';
  const key = getEffectiveApiKey(server);
  if (server.type === 'jellyfin') {
    let url = `${server.url}/Videos/${itemId}/stream${ext}?Static=true`;
    if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
    url += `&api_key=${key}`;
    return url;
  }
  let url = `${server.url}/Videos/${itemId}/stream${ext}?api_key=${key}&Static=true`;
  if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
  return url;
}

function authHeaders(server) {
  const key = getEffectiveApiKey(server);
  if (server.type === 'jellyfin') {
    return {
      'Authorization': `MediaBrowser Token="${key}"`,
      'X-MediaBrowser-Token': key,
    };
  }
  return { 'X-Emby-Token': key };
}

function appendAuth(url, server) {
  if (server.type !== 'jellyfin') {
    url.searchParams.set('api_key', getEffectiveApiKey(server));
  }
}

// ─── Resolve IMDB ID → movie/series name via multiple metadata sources ───────

async function resolveImdbName(imdbId, type) {
  // Strategy 1: Stremio cinemeta meta endpoint
  try {
    const metaType = type === 'series' ? 'series' : 'movie';
    const resp = await fetchWithTimeout(
      `https://v3-cinemeta.strem.io/meta/${metaType}/${imdbId}.json`, 6000
    );
    const data = await resp.json();
    if (data.meta?.name) return data.meta.name;
  } catch { /* continue to next strategy */ }

  // Strategy 2: IMDB suggestions API (free, no key needed)
  try {
    const resp = await fetchWithTimeout(
      `https://v3.sg.media-imdb.com/suggestion/x/${imdbId}.json`, 5000
    );
    const data = await resp.json();
    const match = (data.d || []).find(d => d.id === imdbId);
    if (match?.l) {
      // Verify the IMDB result type matches what we're looking for
      // qid: "movie", "tvSeries", "tvEpisode", "tvMiniSeries", etc.
      const qid = (match.qid || '').toLowerCase();
      if (type === 'series' && (qid === 'tvseries' || qid === 'tvminiseries')) return match.l;
      if (type === 'movie' && (qid === 'movie' || qid === 'tvmovie')) return match.l;
      // If type doesn't match (e.g., searching for series but got a tvEpisode), skip this result
      console.log(`[resolveImdbName] IMDB suggestion type mismatch: wanted ${type}, got qid=${qid} name="${match.l}" — skipping`);
    }
  } catch { /* continue */ }

  // Strategy 3: Stremio cinemeta catalog search (searches by IMDB ID as text)
  try {
    const metaType = type === 'series' ? 'series' : 'movie';
    const resp = await fetchWithTimeout(
      `https://v3-cinemeta.strem.io/catalog/${metaType}/top/search=${encodeURIComponent(imdbId)}.json`, 5000
    );
    const data = await resp.json();
    if (data.metas?.[0]?.name) return data.metas[0].name;
  } catch { /* continue */ }

  return null;
}

// ─── Provider ID validation (matches Streambridge _isMatchingProviderId) ─────

function isMatchingProviderId(providerIds, imdbId) {
  if (!providerIds || !imdbId) return false;
  const val = providerIds.Imdb || providerIds.imdb || providerIds.IMDB || '';
  if (!val) return false;
  if (val === imdbId) return true;
  if (val.toLowerCase() === imdbId.toLowerCase()) return true;
  const normalize = (id) => id.replace(/^tt0*/i, '');
  return normalize(val) === normalize(imdbId);
}

// ─── PlaybackInfo — get all MediaSources for a single item ───────────────────

async function fetchPlaybackInfo(server, itemId) {
  const resp = await apiFetch(server, () => {
    const url = new URL(`${server.url}/Items/${itemId}/PlaybackInfo`);
    url.searchParams.set('UserId', server.userId);
    return url;
  });
  const data = await resp.json();
  return data.MediaSources || [];
}

// ─── Stream building from PlaybackInfo MediaSources ──────────────────────────

function mediaSourcesToStreams(server, itemId, mediaSources) {
  const streams = [];
  for (const source of mediaSources) {
    const sizeBytes = source.Size || 0;
    const bitrate   = source.Bitrate || 0;
    const mediaStreams = source.MediaStreams || [];

    const videoStream = mediaStreams.find((s) => s.Type === 'Video');
    const audioStream = mediaStreams.find((s) => s.Type === 'Audio');

    // ── Resolution
    // Use both width AND height for resolution detection.
    // Many films use 2.39:1 scope aspect — 3840×2152 is still 4K, not 1080p.
    const resW = videoStream?.Width  || 0;
    const resH = videoStream?.Height || 0;
    const resLabel = resH
      ? (resH >= 2160 || resW >= 3840 ? '4K'
        : resH >= 1080 || resW >= 1920 ? '1080p'
        : resH >= 720  || resW >= 1280 ? '720p'
        : `${resH}p`)
      : null;

    const dimsLabel = videoStream && videoStream.Width && videoStream.Height
      ? `${videoStream.Width}x${videoStream.Height}`
      : null;

    // ── HDR
    let hdrLabel = null;
    if (videoStream) {
      const rangeType = (videoStream.VideoRangeType || videoStream.VideoRange || '').toUpperCase();
      if (rangeType === 'DOVI' || rangeType.includes('DOLBY')) hdrLabel = 'DV';
      else if (rangeType === 'HDR10PLUS' || rangeType === 'HDR10+')      hdrLabel = 'HDR10+';
      else if (rangeType === 'HDR10')                                     hdrLabel = 'HDR10';
      else if (rangeType === 'HLG')                                       hdrLabel = 'HLG';
      else if (rangeType === 'HDR')                                       hdrLabel = 'HDR';
    }

    // ── Video codec + bit depth
    let codecLabel = null;
    if (videoStream) {
      const c = (videoStream.Codec || '').toLowerCase();
      const bitDepth = videoStream.BitDepth ? ` ${videoStream.BitDepth}bit` : '';
      if (c === 'hevc' || c === 'h265')        codecLabel = `HEVC${bitDepth}`;
      else if (c === 'h264' || c === 'avc')    codecLabel = `H.264${bitDepth}`;
      else if (c === 'av1')                    codecLabel = `AV1${bitDepth}`;
      else if (c === 'vp9')                    codecLabel = `VP9${bitDepth}`;
      else if (c)                              codecLabel = videoStream.Codec.toUpperCase() + bitDepth;
    }

    // ── Audio codec + channels + quality rank
    // Rank: TrueHD Atmos > TrueHD > DTS-MA > DTS > DD+ > DD > AAC > other
    let audioLabel = null;
    let audioRank = 99; // lower = better
    if (audioStream) {
      const ac = (audioStream.Codec || '').toLowerCase();
      const profile = (audioStream.Profile || '').toLowerCase();
      let codecName = '';
      if (ac.includes('truehd'))                       { codecName = 'TrueHD'; audioRank = profile.includes('atmos') ? 0 : 1; }
      else if (ac === 'dts-ma' || ac === 'dtshd')      { codecName = 'DTS-MA'; audioRank = 2; }
      else if (ac.includes('dts'))                     { codecName = 'DTS'; audioRank = 3; }
      else if (ac === 'eac3')                          { codecName = 'DD+'; audioRank = profile.includes('atmos') ? 0 : 4; }
      else if (ac === 'ac3')                           { codecName = 'DD'; audioRank = 5; }
      else if (ac.includes('aac'))                     { codecName = 'AAC'; audioRank = 6; }
      else if (ac)                                     { codecName = audioStream.Codec.toUpperCase(); audioRank = 7; }

      const ch = audioStream.Channels;
      const chStr = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch ? `${ch}ch` : '';
      // More channels = better (tiebreaker within same codec)
      audioRank = audioRank * 10 - (ch || 0);
      audioLabel = [codecName, chStr].filter(Boolean).join(' ');
    }

    // ── Bitrate in Mbps
    const bitrateLabel = bitrate ? `${(bitrate / 1e6).toFixed(1)}Mbps` : null;

    // ── Source label (REMUX, WEB-DL, etc. from filename)
    const sourceLabel = detectSourceLabel(source);
    const container = source.Container ? source.Container.toUpperCase() : null;

    // ── Assemble description (multi-line, Streambridge-style)
    const descLines = [
      [resLabel, dimsLabel].filter(Boolean).join(' · '),
      [hdrLabel, codecLabel].filter(Boolean).join(' · '),
      sourceLabel,
      audioLabel,
      [container, bitrateLabel, formatFileSize(sizeBytes)].filter(Boolean).join(' · '),
    ].filter(Boolean);

    streams.push({
      url: buildStreamUrl(server, itemId, source.Id, source.Container),
      name: [server.label, resLabel].filter(Boolean).join(' '),
      description: descLines.join('\n') || 'Unknown quality',
      _sizeBytes: sizeBytes,
      _bitrate: bitrate,
      _audioRank: audioRank,
      _mediaSourceId: source.Id,
      _resLabel: resLabel,
    });
  }
  return streams;
}

// ─── Server queries (Streambridge-matching logic) ────────────────────────────

const DEFAULT_FIELDS = 'ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber,MediaStreams';

async function queryServerForMovie(server, imdbId) {
  // Helper: query an endpoint with params, validate ProviderIds
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
    const validated = rawItems.filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
    console.log(`[${server.label}] ${basePath} ${JSON.stringify(params)}: ${rawItems.length} raw → ${validated.length} validated`);
    return validated;
  };

  let items = [];

  const numericImdbId = imdbId.replace(/^tt0*/i, '');

  if (server.type === 'jellyfin') {
    // Jellyfin: ImdbId= and AnyProviderIdEquals= are broken on most versions.
    // Strategy 1: AnyProviderIdEquals with multiple formats (sometimes works)
    for (const val of [`imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}`]) {
      if (items.length > 0) break;
      try { items = await queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: val }); }
      catch (err) { console.error(`[${server.label}] Jellyfin ${val} failed:`, err.message); }
    }
    // Strategy 2: Name-based search — no ProviderIds validation needed (name is the filter)
    if (items.length === 0) {
      try {
        const movieName = await resolveImdbName(imdbId, 'movie');
        if (movieName) {
          console.log(`[${server.label}] Jellyfin: searching movie by name "${movieName}"`);
          // Name search — skip ProviderIds check since IDs may legitimately differ
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
          // Accept exact name matches only
          items = (data.Items || []).filter(i => {
            const sn = (i.Name || '').toLowerCase().trim();
            const qn = movieName.toLowerCase().trim();
            return sn === qn || sn.includes(qn) || qn.includes(sn);
          });
          console.log(`[${server.label}] Jellyfin name movie search "${movieName}": ${(data.Items||[]).length} raw → ${items.length} name-matched`);
        }
      } catch (err) {
        console.error(`[${server.label}] Jellyfin name search failed:`, err.message);
      }
    }
  } else {
    // Emby: sequential fallback strategies
    const strategies = [
      () => queryItems('/Items', { ImdbId: imdbId }),
      () => queryItems(`/Users/${server.userId}/Items`, { ImdbId: imdbId }),
      () => queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: `imdb.${imdbId}` }),
    ];

    for (const tryFn of strategies) {
      if (items.length > 0) break;
      try {
        items = await tryFn();
      } catch (err) {
        console.error(`[${server.label}] Emby strategy failed:`, err.message);
      }
    }

    // Emby fallback: name-based search if provider queries all failed
    if (items.length === 0) {
      try {
        const movieName = await resolveImdbName(imdbId, 'movie');
        if (movieName) {
          console.log(`[${server.label}] Resolved ${imdbId} → "${movieName}", searching by name`);
          items = await queryItems(`/Users/${server.userId}/Items`, { SearchTerm: movieName }, 20);
        }
      } catch (err) {
        console.error(`[${server.label}] Emby name search failed:`, err.message);
      }
    }
  }

  // Deduplicate by Item Id
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
}

async function queryServerForEpisode(server, imdbId, season, episode) {
  const numericImdbId = imdbId.replace(/^tt0*/i, ''); // "tt14588078" → "14588078"

  // findSeriesById: uses provider ID param + validates ProviderIds in response
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
    const validated = (data.Items || []).filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
    console.log(`[${server.label}] findSeriesById ${JSON.stringify(params)}: ${(data.Items||[]).length} raw → ${validated.length} validated`);
    return validated;
  };

  // findSeriesByName: name search — NO ProviderIds validation (name is the filter)
  // Used when IMDB IDs differ between Stremio catalog and server metadata
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
    // Accept only exact or near-exact name matches (not just any partial match)
    const results = (data.Items || []).filter(i => {
      const sn = (i.Name || '').toLowerCase().trim();
      const qn = name.toLowerCase().trim();
      return sn === qn || sn.includes(qn) || qn.includes(sn);
    });
    console.log(`[${server.label}] findSeriesByName "${name}": ${(data.Items||[]).length} raw → ${results.length} name-matched`);
    return results;
  };

  let seriesItems = [];

  try {
    // Strategy 1: ImdbId= param (works on well-configured servers)
    if (seriesItems.length === 0) {
      seriesItems = await findSeriesById({ ImdbId: imdbId });
    }
    // Strategy 2: AnyProviderIdEquals with multiple formats (Streambridge approach)
    if (seriesItems.length === 0) {
      for (const val of [`imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}`]) {
        seriesItems = await findSeriesById({ AnyProviderIdEquals: val });
        if (seriesItems.length > 0) break;
      }
    }

    // Strategy 3: Name-based search — skips ProviderIds validation
    // Handles mismatched IMDB IDs between Stremio catalog and server
    if (seriesItems.length === 0) {
      const seriesName = await resolveImdbName(imdbId, 'series');
      if (seriesName) {
        console.log(`[${server.label}] Name-based series search: "${seriesName}"`);
        seriesItems = await findSeriesByName(seriesName);
      }
    }
  } catch (err) {
    console.error(`[${server.label}] Series search failed:`, err.message);
  }

  if (seriesItems.length === 0) {
    return queryServerForEpisodeDirect(server, imdbId, season, episode);
  }

  // Deduplicate series by Id
  const seenSeries = new Set();
  const uniqueSeries = seriesItems.filter(item => {
    if (seenSeries.has(item.Id)) return false;
    seenSeries.add(item.Id);
    return true;
  });

  // Query ALL matching series in parallel for episodes
  const perSeriesResults = await Promise.allSettled(
    uniqueSeries.map(async (series) => {
      const epResp = await apiFetch(server, () => {
        const epUrl = new URL(`${server.url}/Shows/${series.Id}/Episodes`);
        epUrl.searchParams.set('Season', String(season));
        epUrl.searchParams.set('Fields', DEFAULT_FIELDS);
        epUrl.searchParams.set('UserId', server.userId);
        return epUrl;
      });
      const epData = await epResp.json();
      return (epData.Items || []).filter((ep) => ep.IndexNumber === episode);
    })
  );

  const seen = new Set();
  return perSeriesResults
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((ep) => {
      if (seen.has(ep.Id)) return false;
      seen.add(ep.Id);
      return true;
    });
}

// Direct episode search (fallback — only used when series-based search fails)
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
    return url; // apiFetch will call appendAuth
  };

  let items = [];
  try {
    if (server.type === 'jellyfin') {
      // Jellyfin: AnyProviderIdEquals is broken — search by name instead
      const seriesName = await resolveImdbName(imdbId, 'series');
      if (seriesName) {
        console.log(`[${server.label}] Direct episode fallback: searching episodes by name "${seriesName}"`);
        const resp = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }), 10000);
        items = (await resp.json()).Items || [];
      }
    } else {
      // Emby: try AnyProviderIdEquals first
      const resp1 = await apiFetch(server, () => makeUrl({ AnyProviderIdEquals: `imdb.${imdbId}` }), 10000);
      items = (await resp1.json()).Items || [];

      // If AnyProviderIdEquals returned 0, try name-based search
      if (items.length === 0) {
        const seriesName = await resolveImdbName(imdbId, 'series');
        if (seriesName) {
          console.log(`[${server.label}] Direct episode fallback: searching Emby episodes by name "${seriesName}"`);
          const resp2 = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }), 10000);
          items = (await resp2.json()).Items || [];
        }
      }
    }
  } catch (err) {
    console.error(`[${server.label}] Direct episode search failed:`, err.message);
    return [];
  }

  // Filter by correct season + episode
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

// ─── Main stream collection (Streambridge-matching: PlaybackInfo per item) ───

async function getStreamsFromServer(server, type, imdbId, season, episode) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryServerForMovie(server, imdbId);
    } else {
      items = await queryServerForEpisode(server, imdbId, season, episode);
    }

    // For EACH validated item, call PlaybackInfo to get ALL MediaSources
    // This matches Streambridge's getPlaybackStreams() approach
    const allStreams = [];
    const playbackResults = await Promise.allSettled(
      items.map(async (item) => {
        try {
          const mediaSources = await fetchPlaybackInfo(server, item.Id);
          return { itemId: item.Id, mediaSources };
        } catch (err) {
          console.error(`[${server.label}] PlaybackInfo failed for ${item.Id}:`, err.message);
          // Fallback: use MediaSources from the Items query directly
          return { itemId: item.Id, mediaSources: item.MediaSources || [] };
        }
      })
    );

    for (const result of playbackResults) {
      if (result.status === 'fulfilled') {
        const { itemId, mediaSources } = result.value;
        const streams = mediaSourcesToStreams(server, itemId, mediaSources);
        allStreams.push(...streams);
      }
    }

    // Deduplicate by mediaSourceId via Map (Streambridge's exact approach)
    const deduped = new Map(allStreams.map(s => [s._mediaSourceId, s]));
    // Per-server spec dedup: same description = same size + specs = same file indexed in multiple libraries
    const specSeen = new Set();
    const result = [...deduped.values()].filter(s => {
      const key = s.description;
      if (specSeen.has(key)) return false;
      specSeen.add(key);
      return true;
    });
    if (result.length === 0) {
      return [{
        name: server.label, description: 'No results found\nFile not in library',
        url: `${server.url}/no-stream-available`, _noResults: true,
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `noresults:${server.label}`,
      }];
    }
    return result;
  } catch (err) {
    console.error(`[${server.label}] Query failed:`, err.message);
    return [{
      name: server.label, description: 'Server offline or unreachable',
      url: `${server.url}/no-stream-available`, _noResults: true,
      _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `offline:${server.label}`,
    }];
  }
}

async function getAllStreams(servers, type, imdbId, season, episode, sortOrder, excludeRes, recommend) {
  const results = await Promise.allSettled(
    servers.map((server) =>
      getStreamsFromServer(server, type, imdbId, season, episode)
    )
  );

  const allStreams = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  // Separate real streams from no-results/offline placeholders
  let realStreams = allStreams.filter(s => !s._noResults);
  const noResStreams = allStreams.filter(s => s._noResults);

  // Filter excluded resolutions
  if (excludeRes && excludeRes.length > 0) {
    realStreams = realStreams.filter(s => {
      const r = s._resLabel;
      if (excludeRes.includes('SD') && r !== '4K' && r !== '1080p' && r !== '720p') return false;
      if (r && excludeRes.includes(r)) return false;
      return true;
    });
  }

  // Sort real streams by user preference
  realStreams.sort((a, b) => {
    if (sortOrder === 'audio') {
      const d = (a._audioRank || 99) - (b._audioRank || 99);
      return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
    }
    if (sortOrder === 'bitrate') {
      const d = (b._bitrate || 0) - (a._bitrate || 0);
      return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
    }
    // Default: size first
    const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
    if (sizeDiff !== 0) return sizeDiff;
    const audioDiff = (a._audioRank || 99) - (b._audioRank || 99);
    if (audioDiff !== 0) return audioDiff;
    return (b._bitrate || 0) - (a._bitrate || 0);
  });

  // Mark top result as recommended
  if (recommend && realStreams.length > 0) {
    realStreams[0] = { ...realStreams[0], name: `★ ${realStreams[0].name}` };
  }

  // No-results/offline placeholders always at the bottom
  return [...realStreams, ...noResStreams]
    .map(({ _sizeBytes, _bitrate, _audioRank, _mediaSourceId, _noResults, _resLabel, ...stream }) => stream);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Profile: save ────────────────────────────────────────────────────────────
app.post('/api/profile/save', express.json(), (req, res) => {
  const { username, password, config } = req.body || {};
  if (!username || !password || !config) {
    return res.status(400).json({ error: 'username, password and config are required.' });
  }
  if (!/^[a-zA-Z0-9_\-. ]{1,40}$/.test(username)) {
    return res.status(400).json({ error: 'Username may only contain letters, numbers, spaces, _ - . (max 40 chars).' });
  }

  const profiles = loadProfiles();
  const existing = profiles[username.toLowerCase()];

  if (existing) {
    const attempt = hashPassword(password, existing.salt);
    if (attempt !== existing.passwordHash) {
      return res.status(401).json({ error: 'Wrong password for that profile name.' });
    }
    existing.config = config;
    existing.updatedAt = new Date().toISOString();
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    profiles[username.toLowerCase()] = {
      displayName: username,
      salt,
      passwordHash: hashPassword(password, salt),
      config,
      updatedAt: new Date().toISOString(),
    };
  }

  const persisted = saveProfiles(profiles);
  res.json({
    ok: true,
    message: persisted
      ? 'Profile saved.'
      : 'Profile saved in memory (will persist until server restarts).',
  });
});

// ─── Profile: load ────────────────────────────────────────────────────────────
app.post('/api/profile/load', express.json(), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }

  const profiles = loadProfiles();
  const profile = profiles[username.toLowerCase()];

  if (!profile) {
    return res.status(404).json({ error: 'No profile found with that name.' });
  }

  const attempt = hashPassword(password, profile.salt);
  if (attempt !== profile.passwordHash) {
    return res.status(401).json({ error: 'Wrong password.' });
  }

  res.json({ config: profile.config, updatedAt: profile.updatedAt });
});

// ─── Credential helper ────────────────────────────────────────────────────────
app.post('/api/fetch-credentials', express.json(), async (req, res) => {
  const { url, username, password } = req.body || {};
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username and password are required.' });
  }

  const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-setup", Version="1.0.0"';
  const authUrl = `${url.replace(/\/$/, '')}/Users/AuthenticateByName`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': authHeader,
          'Authorization': authHeader,
        },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 401 || resp.status === 403) {
      return res.status(400).json({ error: 'Authentication failed — wrong username or password.' });
    }
    if (!resp.ok) {
      return res.status(400).json({ error: `Server returned HTTP ${resp.status}. Check the URL.` });
    }

    const data = await resp.json();
    if (!data.AccessToken || !data.User?.Id) {
      return res.status(400).json({ error: 'Unexpected response — check your URL and credentials.' });
    }
    res.json({ apiKey: data.AccessToken, userId: data.User.Id });
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Connection timed out. Check the server URL.'
      : `Could not reach server: ${err.message}`;
    res.status(400).json({ error: msg });
  }
});

// ─── Test connection ──────────────────────────────────────────────────────────
app.post('/api/test-connection', express.json(), async (req, res) => {
  const { url, type, apiKey, userId } = req.body || {};
  if (!url || !apiKey || !userId) {
    return res.status(400).json({ error: 'url, apiKey and userId are required.' });
  }
  const server = { url: url.replace(/\/$/, ''), type: type || 'emby', apiKey, userId };
  try {
    const infoUrl = new URL(`${server.url}/System/Info`);
    appendAuth(infoUrl, server);
    const resp = await fetchWithTimeout(infoUrl.toString(), 8000, { headers: authHeaders(server) });
    const data = await resp.json();
    const name    = data.ServerName || data.ProductName || (type === 'jellyfin' ? 'Jellyfin' : 'Emby');
    const version = data.Version ? ` v${data.Version}` : '';
    res.json({ ok: true, message: `Connected — ${name}${version}` });
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.json({ ok: false, error: 'Authentication failed — check your API key.' });
    if (err.name === 'AbortError')
      return res.json({ ok: false, error: 'Connection timed out — check the server URL.' });
    res.json({ ok: false, error: `Could not connect: ${err.message}` });
  }
});

// ─── Manifest ─────────────────────────────────────────────────────────────────
app.get('/:config/manifest.json', (req, res) => {
  let cfg;
  try {
    cfg = decodeConfig(req.params.config);
  } catch {
    return res.status(400).json({ error: 'Invalid config' });
  }

  const names = (cfg.servers || []).map((s) => s.label).join(', ');

  res.json({
    id: 'com.multiemby.bridge',
    version: '1.0.0',
    name: 'Multi-Emby Bridge',
    description: `Streams from: ${names || 'configured servers'}`,
    types: ['movie', 'series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt'],
    behaviorHints: { configurable: false },
  });
});

// ─── Stream handler ───────────────────────────────────────────────────────────
app.get('/:config/stream/:type/:id.json', async (req, res) => {
  let cfg;
  try {
    cfg = decodeConfig(req.params.config);
  } catch {
    return res.json({ streams: [] });
  }

  const { type, id } = req.params;
  const { imdbId, season, episode } = parseStreamId(type, id);

  if (!imdbId || !imdbId.startsWith('tt')) {
    return res.json({ streams: [] });
  }

  const timeoutMs = (cfg.timeout && cfg.timeout >= 3000 && cfg.timeout <= 10000) ? cfg.timeout : 10000;
  const servers = (cfg.servers || [])
    .filter(s => s.url && s.apiKey && s.userId)
    .map(s => ({ ...s, _timeout: timeoutMs }));

  if (servers.length === 0) {
    return res.json({ streams: [] });
  }

  try {
    const streams = await getAllStreams(servers, type, imdbId, season, episode, cfg.sortOrder, cfg.excludeRes, cfg.recommend);
    res.json({ streams });
  } catch (err) {
    console.error('Stream handler error:', err);
    res.json({ streams: [] });
  }
});

// ─── JSON error handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Multi-Emby Bridge running → http://localhost:${PORT}/configure`);
});
