const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 7000;

// ─── CORS (required by Stremio) ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
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
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

function itemsToStreams(server, items) {
  const streams = [];
  for (const item of items) {
    const sources = item.MediaSources || [];
    for (const source of sources) {
      const sizeBytes = source.Size || 0;
      const parts = [
        formatFileSize(sizeBytes),
        source.Container ? source.Container.toUpperCase() : null,
        source.VideoType || null,
      ].filter(Boolean);

      // Add bitrate if available
      if (source.Bitrate) {
        parts.push(`${Math.round(source.Bitrate / 1000)} kbps`);
      }

      streams.push({
        url: buildStreamUrl(server, item.Id, source.Id),
        name: server.label,
        description: parts.join(' · '),
        _sizeBytes: sizeBytes,
      });
    }
  }
  return streams;
}

// ─── Emby queries ─────────────────────────────────────────────────────────────

async function queryEmbyForMovie(server, imdbId) {
  const url = new URL(`${server.url}/Items`);
  url.searchParams.set('AnyProviderIdEquals', `imdb.${imdbId}`);
  url.searchParams.set('IncludeItemTypes', 'Movie');
  url.searchParams.set('Fields', 'MediaSources');
  url.searchParams.set('Recursive', 'true');
  url.searchParams.set('api_key', server.apiKey);
  url.searchParams.set('UserId', server.userId);

  const resp = await fetchWithTimeout(url.toString(), 10000);
  const data = await resp.json();
  return data.Items || [];
}

async function queryEmbyForEpisode(server, imdbId, season, episode) {
  const url = new URL(`${server.url}/Items`);
  url.searchParams.set('AnyProviderIdEquals', `imdb.${imdbId}`);
  url.searchParams.set('IncludeItemTypes', 'Episode');
  url.searchParams.set('Fields', 'MediaSources');
  url.searchParams.set('ParentIndexNumber', season);
  url.searchParams.set('IndexNumber', episode);
  url.searchParams.set('Recursive', 'true');
  url.searchParams.set('api_key', server.apiKey);
  url.searchParams.set('UserId', server.userId);

  const resp = await fetchWithTimeout(url.toString(), 10000);
  const data = await resp.json();
  const items = data.Items || [];

  // Client-side filter as safety net — some Emby builds ignore the query params
  return items.filter(
    (item) =>
      item.ParentIndexNumber === season && item.IndexNumber === episode
  );
}

async function getStreamsFromServer(server, type, imdbId, season, episode) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryEmbyForMovie(server, imdbId);
    } else {
      items = await queryEmbyForEpisode(server, imdbId, season, episode);
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

  // Sort largest file first
  allStreams.sort((a, b) => b._sizeBytes - a._sizeBytes);

  // Strip internal sort key
  return allStreams.map(({ _sizeBytes, ...stream }) => stream);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Credential helper — server-side proxy to avoid CORS issues with Emby/Jellyfin
app.post('/api/fetch-credentials', express.json(), async (req, res) => {
  const { url, username, password } = req.body || {};
  if (!url || !username || !password) {
    return res.status(400).json({ error: 'url, username and password are required.' });
  }

  const authHeader = 'MediaBrowser Client="MultiEmbyBridge", Device="Web", DeviceId="meb-setup", Version="1.0.0"';
  const authUrl = `${url.replace(/\/$/, '')}/Users/AuthenticateByName`;
  try {
    const resp = await fetchWithTimeout(authUrl, 10000, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Send both header names — Emby uses X-Emby-Authorization, Jellyfin accepts both
        'X-Emby-Authorization': authHeader,
        'Authorization': authHeader,
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    });
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

// Manifest
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
    description: `Streams from: ${names || 'Emby servers'}`,
    types: ['movie', 'series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt'],
    behaviorHints: { configurable: false },
  });
});

// Stream handler
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

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Multi-Emby Bridge running → http://localhost:${PORT}/configure`);
});
