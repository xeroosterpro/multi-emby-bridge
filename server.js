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

function buildStreamUrl(server, itemId, sourceId, container) {
  const ext = container ? `.${container.toLowerCase()}` : '';
  if (server.type === 'jellyfin') {
    // Jellyfin: no api_key in URL, use headers only
    let url = `${server.url}/Videos/${itemId}/stream${ext}?Static=true`;
    if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
    url += `&api_key=${server.apiKey}`;
    return url;
  }
  let url = `${server.url}/Videos/${itemId}/stream${ext}?api_key=${server.apiKey}&Static=true`;
  if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
  return url;
}

// Jellyfin requires an Authorization header — api_key URL param can cause 401
// on newer Jellyfin versions. Emby uses api_key URL param.
function authHeaders(server) {
  if (server.type === 'jellyfin') {
    return {
      'Authorization': `MediaBrowser Token="${server.apiKey}"`,
      'X-MediaBrowser-Token': server.apiKey,
    };
  }
  return { 'X-Emby-Token': server.apiKey };
}

// Append api_key to URL only for Emby; Jellyfin uses headers exclusively
function appendAuth(url, server) {
  if (server.type !== 'jellyfin') {
    url.searchParams.set('api_key', server.apiKey);
  }
}

// ─── Provider ID validation (matches Streambridge _isMatchingProviderId) ─────

function isMatchingProviderId(providerIds, imdbId) {
  if (!providerIds || !imdbId) return false;
  const val = providerIds.Imdb || providerIds.imdb || providerIds.IMDB || '';
  if (!val) return false;
  const normalize = (id) => id.replace(/^tt/i, '').toLowerCase();
  return normalize(val) === normalize(imdbId);
}

// ─── PlaybackInfo — get all MediaSources for a single item ───────────────────

async function fetchPlaybackInfo(server, itemId) {
  const headers = authHeaders(server);
  const url = new URL(`${server.url}/Items/${itemId}/PlaybackInfo`);
  appendAuth(url, server);
  url.searchParams.set('UserId', server.userId);
  const resp = await fetchWithTimeout(url.toString(), 10000, { headers });
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
    const resLabel = videoStream && videoStream.Height
      ? (videoStream.Height >= 2160 ? '4K'
        : videoStream.Height >= 1080 ? '1080p'
        : videoStream.Height >= 720  ? '720p'
        : `${videoStream.Height}p`)
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

    // ── Audio codec + channels
    let audioLabel = null;
    if (audioStream) {
      const ac = (audioStream.Codec || '').toLowerCase();
      let codecName = '';
      if (ac.includes('truehd'))                       codecName = 'TrueHD';
      else if (ac === 'dts-ma' || ac === 'dtshd')      codecName = 'DTS-MA';
      else if (ac.includes('dts'))                     codecName = 'DTS';
      else if (ac === 'eac3')                          codecName = 'DD+';
      else if (ac === 'ac3')                           codecName = 'DD';
      else if (ac.includes('aac'))                     codecName = 'AAC';
      else if (ac)                                     codecName = audioStream.Codec.toUpperCase();

      const ch = audioStream.Channels;
      const chStr = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch ? `${ch}ch` : '';
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
      _mediaSourceId: source.Id,
    });
  }
  return streams;
}

// ─── Server queries (Streambridge-matching logic) ────────────────────────────

const DEFAULT_FIELDS = 'ProviderIds,Name,MediaSources,Path,Id,IndexNumber,ParentIndexNumber,MediaStreams';

async function queryServerForMovie(server, imdbId) {
  const headers = authHeaders(server);

  // Strategy 1: /Items with Filters=IsNotFolder (matches Streambridge findMovieItem)
  const tryStrategy1 = async (params) => {
    const url = new URL(`${server.url}/Items`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Limit', '10');
    url.searchParams.set('IncludeItemTypes', 'Movie');
    url.searchParams.set('Filters', 'IsNotFolder');
    appendAuth(url, server);
    const resp = await fetchWithTimeout(url.toString(), 10000, { headers });
    const data = await resp.json();
    return (data.Items || []).filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
  };

  // Strategy 2 (fallback): /Users/{userId}/Items with AnyProviderIdEquals
  const tryStrategy2 = async (params) => {
    const url = new URL(`${server.url}/Users/${server.userId}/Items`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Limit', '10');
    url.searchParams.set('IncludeItemTypes', 'Movie');
    appendAuth(url, server);
    const resp = await fetchWithTimeout(url.toString(), 10000, { headers });
    const data = await resp.json();
    return (data.Items || []).filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
  };

  let items = [];

  // Sequential fallback — try primary first, fall back only if 0 results
  try {
    if (server.type === 'jellyfin') {
      items = await tryStrategy1({ AnyProviderIdEquals: `imdb.${imdbId}` });
      if (items.length === 0) {
        items = await tryStrategy1({ AnyProviderIdEquals: `Imdb.${imdbId}` });
      }
    } else {
      items = await tryStrategy1({ ImdbId: imdbId });
    }
  } catch (err) {
    console.error(`[${server.label}] Strategy 1 failed:`, err.message);
  }

  if (items.length === 0) {
    try {
      items = await tryStrategy2({ AnyProviderIdEquals: `imdb.${imdbId}` });
      if (items.length === 0 && server.type === 'jellyfin') {
        items = await tryStrategy2({ AnyProviderIdEquals: `Imdb.${imdbId}` });
      }
    } catch (err) {
      console.error(`[${server.label}] Strategy 2 failed:`, err.message);
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
  const headers = authHeaders(server);

  const findSeries = async (params) => {
    const url = new URL(`${server.url}/Items`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('IncludeItemTypes', 'Series');
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('Limit', '10');
    url.searchParams.set('Filters', 'IsNotFolder');
    appendAuth(url, server);
    const resp = await fetchWithTimeout(url.toString(), 10000, { headers });
    const data = await resp.json();
    return (data.Items || []).filter(i => isMatchingProviderId(i.ProviderIds, imdbId));
  };

  let seriesItems = [];

  try {
    if (server.type === 'jellyfin') {
      seriesItems = await findSeries({ AnyProviderIdEquals: `imdb.${imdbId}` });
      if (seriesItems.length === 0) {
        seriesItems = await findSeries({ AnyProviderIdEquals: `Imdb.${imdbId}` });
      }
    } else {
      seriesItems = await findSeries({ ImdbId: imdbId });
      if (seriesItems.length === 0) {
        seriesItems = await findSeries({ AnyProviderIdEquals: `imdb.${imdbId}` });
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
      const epUrl = new URL(`${server.url}/Shows/${series.Id}/Episodes`);
      epUrl.searchParams.set('Season', String(season));
      epUrl.searchParams.set('Fields', DEFAULT_FIELDS);
      appendAuth(epUrl, server);
      epUrl.searchParams.set('UserId', server.userId);

      const epResp = await fetchWithTimeout(epUrl.toString(), 10000, {
        headers: authHeaders(server),
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

// Direct episode search (fallback)
async function queryServerForEpisodeDirect(server, imdbId, season, episode) {
  const headers = authHeaders(server);
  const makeUrl = (params) => {
    const url = new URL(`${server.url}/Users/${server.userId}/Items`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('IncludeItemTypes', 'Episode');
    url.searchParams.set('Fields', DEFAULT_FIELDS);
    url.searchParams.set('ParentIndexNumber', String(season));
    url.searchParams.set('IndexNumber', String(episode));
    url.searchParams.set('Recursive', 'true');
    appendAuth(url, server);
    return url.toString();
  };

  let items = [];
  try {
    if (server.type === 'jellyfin') {
      const resp1 = await fetchWithTimeout(makeUrl({ AnyProviderIdEquals: `imdb.${imdbId}` }), 10000, { headers });
      items = (await resp1.json()).Items || [];
      if (items.length === 0) {
        const resp2 = await fetchWithTimeout(makeUrl({ AnyProviderIdEquals: `Imdb.${imdbId}` }), 10000, { headers });
        items = (await resp2.json()).Items || [];
      }
    } else {
      const resp1 = await fetchWithTimeout(makeUrl({ AnyProviderIdEquals: `imdb.${imdbId}` }), 10000, { headers });
      items = (await resp1.json()).Items || [];
    }
  } catch (err) {
    console.error(`[${server.label}] Direct episode search failed:`, err.message);
    return [];
  }

  const seen = new Set();
  return items
    .filter((item) => item.ParentIndexNumber === season && item.IndexNumber === episode)
    .filter((item) => {
      if (seen.has(item.Id)) return false;
      seen.add(item.Id);
      return true;
    });
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
    return [...deduped.values()];
  } catch (err) {
    console.error(`[${server.label}] Query failed:`, err.message);
    return [];
  }
}

async function getAllStreams(servers, type, imdbId, season, episode) {
  const results = await Promise.allSettled(
    servers.map((server) =>
      getStreamsFromServer(server, type, imdbId, season, episode)
    )
  );

  const allStreams = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  // Sort: biggest file first; fall back to highest bitrate
  allStreams.sort((a, b) => {
    const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
    if (sizeDiff !== 0) return sizeDiff;
    return (b._bitrate || 0) - (a._bitrate || 0);
  });

  // Strip internal sort keys
  return allStreams.map(({ _sizeBytes, _bitrate, _mediaSourceId, ...stream }) => stream);
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

  const servers = (cfg.servers || []).filter(
    (s) => s.url && s.apiKey && s.userId
  );

  if (servers.length === 0) {
    return res.json({ streams: [] });
  }

  try {
    const streams = await getAllStreams(servers, type, imdbId, season, episode);
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
