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

function buildStreamUrl(server, itemId, sourceId) {
  let url = `${server.url}/Videos/${itemId}/stream?api_key=${server.apiKey}&static=true`;
  if (sourceId) url += `&MediaSourceId=${encodeURIComponent(sourceId)}`;
  return url;
}

// Jellyfin requires an Authorization header — api_key URL param alone is unreliable
function jellyfinHeaders(server) {
  if (server.type === 'jellyfin') {
    return { 'Authorization': `MediaBrowser Token="${server.apiKey}"` };
  }
  return {};
}

// Provider ID format varies across Jellyfin versions; Emby always uses lowercase
// For Jellyfin we query BOTH formats in parallel and merge — see jellyfinItems()
function providerParam(imdbId, capital = false) {
  return capital ? `Imdb.${imdbId}` : `imdb.${imdbId}`;
}

// For Jellyfin: run the same query with both 'imdb.' and 'Imdb.', dedupe by item Id
async function jellyfinItems(server, buildUrl) {
  const [lowercase, titlecase] = await Promise.allSettled([
    (async () => {
      const url = buildUrl('imdb');
      const resp = await fetchWithTimeout(url, 10000, { headers: jellyfinHeaders(server) });
      const data = await resp.json();
      return data.Items || [];
    })(),
    (async () => {
      const url = buildUrl('Imdb');
      const resp = await fetchWithTimeout(url, 10000, { headers: jellyfinHeaders(server) });
      const data = await resp.json();
      return data.Items || [];
    })(),
  ]);

  const seen = new Set();
  return [
    ...(lowercase.status === 'fulfilled' ? lowercase.value : []),
    ...(titlecase.status === 'fulfilled' ? titlecase.value : []),
  ].filter(item => {
    if (seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
}

function itemsToStreams(server, items) {
  const streams = [];
  for (const item of items) {
    const sources = item.MediaSources || [];
    // Some Emby/Jellyfin versions put MediaStreams at item level, not inside each source
    const itemLevelStreams = item.MediaStreams || [];

    for (const source of sources) {
      const sizeBytes = source.Size || 0;
      const bitrate   = source.Bitrate || 0;

      // Use source-level MediaStreams, falling back to item-level
      const mediaStreams = (source.MediaStreams && source.MediaStreams.length > 0)
        ? source.MediaStreams
        : itemLevelStreams;

      const videoStream = mediaStreams.find((s) => s.Type === 'Video');
      let codecLabel = null;
      if (videoStream) {
        const c = (videoStream.Codec || '').toLowerCase();
        if (c === 'hevc' || c === 'h265') codecLabel = 'H.265';
        else if (c === 'h264' || c === 'avc') codecLabel = 'H.264';
        else if (c === 'av1') codecLabel = 'AV1';
        else if (c === 'vp9') codecLabel = 'VP9';
        else if (c) codecLabel = videoStream.Codec.toUpperCase();
      }

      // Resolution label
      const resLabel = videoStream && videoStream.Height
        ? (videoStream.Height >= 2160 ? '4K'
          : videoStream.Height >= 1080 ? '1080p'
          : videoStream.Height >= 720  ? '720p'
          : `${videoStream.Height}p`)
        : null;

      const parts = [
        formatFileSize(sizeBytes),
        source.Container ? source.Container.toUpperCase() : null,
        resLabel,
        codecLabel,
        bitrate ? `${Math.round(bitrate / 1000)} kbps` : null,
      ].filter(Boolean);

      streams.push({
        url: buildStreamUrl(server, item.Id, source.Id),
        name: server.label,
        description: parts.join(' · ') || 'Unknown quality',
        _sizeBytes: sizeBytes,
        _bitrate: bitrate,
      });
    }
  }
  return streams;
}

// ─── Server queries ───────────────────────────────────────────────────────────

async function queryServerForMovie(server, imdbId) {
  const buildUrl = (prefix) => {
    const url = new URL(`${server.url}/Items`);
    url.searchParams.set('AnyProviderIdEquals', `${prefix}.${imdbId}`);
    url.searchParams.set('IncludeItemTypes', 'Movie');
    url.searchParams.set('Fields', 'MediaSources,MediaStreams');
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('api_key', server.apiKey);
    url.searchParams.set('UserId', server.userId);
    return url.toString();
  };

  if (server.type === 'jellyfin') {
    return jellyfinItems(server, buildUrl);
  }

  const resp = await fetchWithTimeout(buildUrl('imdb'), 10000);
  const data = await resp.json();
  return data.Items || [];
}

async function queryServerForEpisode(server, imdbId, season, episode) {
  // Step 1: Find the Series by its IMDB ID
  const buildSeriesUrl = (prefix) => {
    const url = new URL(`${server.url}/Items`);
    url.searchParams.set('AnyProviderIdEquals', `${prefix}.${imdbId}`);
    url.searchParams.set('IncludeItemTypes', 'Series');
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('api_key', server.apiKey);
    url.searchParams.set('UserId', server.userId);
    return url.toString();
  };

  let seriesItems;
  if (server.type === 'jellyfin') {
    seriesItems = await jellyfinItems(server, buildSeriesUrl);
  } else {
    const resp = await fetchWithTimeout(buildSeriesUrl('imdb'), 10000);
    const data = await resp.json();
    seriesItems = data.Items || [];
  }

  if (seriesItems.length === 0) {
    return queryServerForEpisodeDirect(server, imdbId, season, episode);
  }

  // Step 2: Fetch episodes for that series + season
  const seriesId = seriesItems[0].Id;
  const epUrl = new URL(`${server.url}/Shows/${seriesId}/Episodes`);
  epUrl.searchParams.set('Season', String(season));
  epUrl.searchParams.set('Fields', 'MediaSources,MediaStreams');
  epUrl.searchParams.set('api_key', server.apiKey);
  epUrl.searchParams.set('UserId', server.userId);

  const epResp = await fetchWithTimeout(epUrl.toString(), 10000, {
    headers: jellyfinHeaders(server),
  });
  const epData = await epResp.json();
  const episodes = epData.Items || [];

  return episodes.filter((ep) => ep.IndexNumber === episode);
}

// Direct episode search (fallback — works if server stores series IMDB on episodes)
async function queryServerForEpisodeDirect(server, imdbId, season, episode) {
  const buildUrl = (prefix) => {
    const url = new URL(`${server.url}/Items`);
    url.searchParams.set('AnyProviderIdEquals', `${prefix}.${imdbId}`);
    url.searchParams.set('IncludeItemTypes', 'Episode');
    url.searchParams.set('Fields', 'MediaSources,MediaStreams');
    url.searchParams.set('ParentIndexNumber', String(season));
    url.searchParams.set('IndexNumber', String(episode));
    url.searchParams.set('Recursive', 'true');
    url.searchParams.set('api_key', server.apiKey);
    url.searchParams.set('UserId', server.userId);
    return url.toString();
  };

  let items;
  if (server.type === 'jellyfin') {
    items = await jellyfinItems(server, buildUrl);
  } else {
    const resp = await fetchWithTimeout(buildUrl('imdb'), 10000);
    const data = await resp.json();
    items = data.Items || [];
  }

  return items.filter(
    (item) => item.ParentIndexNumber === season && item.IndexNumber === episode
  );
}

async function getStreamsFromServer(server, type, imdbId, season, episode) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryServerForMovie(server, imdbId);
    } else {
      items = await queryServerForEpisode(server, imdbId, season, episode);
    }
    return itemsToStreams(server, items);
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

  // Sort: biggest file first; fall back to highest bitrate when size is unavailable
  allStreams.sort((a, b) => {
    const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
    if (sizeDiff !== 0) return sizeDiff;
    return (b._bitrate || 0) - (a._bitrate || 0);
  });

  // Strip internal sort keys
  return allStreams.map(({ _sizeBytes, _bitrate, ...stream }) => stream);
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

  // If profile exists, verify password before allowing overwrite
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

    // Handle auth failures with a clear message instead of generic "could not reach"
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
// Without this, malformed JSON in POST bodies returns Express's default HTML error
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
