const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 7000;

// ─── Request History Log ─────────────────────────────────────────────────────
const REQUEST_LOG = [];
const MAX_LOG = 200;
function addLogEntry(entry) {
  REQUEST_LOG.unshift(entry);
  if (REQUEST_LOG.length > MAX_LOG) REQUEST_LOG.pop();
}

// ─── Health monitoring ────────────────────────────────────────────────────────
// Runs 24/7 in the backend — no API key needed, just pings /System/Ping.
// Servers registered via POST /api/health/register (called when generating link).
// History persisted to DATA_DIR/health-history.json + DATA_DIR/health-servers.json
// Max 2016 entries per server (~1 week at 5-min intervals).

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


// ─── Health monitoring state ──────────────────────────────────────────────────
const HEALTH_SERVERS_FILE = path.join(DATA_DIR, 'health-servers.json');
const HEALTH_HISTORY_FILE = path.join(DATA_DIR, 'health-history.json');
const MAX_HEALTH_ENTRIES  = 2016; // ~1 week at 5-min intervals
const HEALTH_INTERVAL_MS  = 5 * 60 * 1000; // 5 minutes

let healthServers = [];  // [{ url, label, type }]
let healthHistory = {};  // { [url]: [{ ts, up, ms }] }

function loadHealthData() {
  try {
    if (fs.existsSync(HEALTH_SERVERS_FILE))
      healthServers = JSON.parse(fs.readFileSync(HEALTH_SERVERS_FILE, 'utf8'));
  } catch { healthServers = []; }
  try {
    if (fs.existsSync(HEALTH_HISTORY_FILE))
      healthHistory = JSON.parse(fs.readFileSync(HEALTH_HISTORY_FILE, 'utf8'));
  } catch { healthHistory = {}; }
}

function saveHealthData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HEALTH_SERVERS_FILE, JSON.stringify(healthServers), 'utf8');
    fs.writeFileSync(HEALTH_HISTORY_FILE, JSON.stringify(healthHistory), 'utf8');
  } catch (err) {
    console.error('Health save error:', err.message);
  }
}

function registerHealthServers(servers) {
  // servers = [{ url, label, type }] — no API keys stored
  let changed = false;
  for (const s of servers) {
    if (!s.url) continue;
    const url = s.url.replace(/\/+$/, '');
    if (!healthServers.find(h => h.url === url)) {
      healthServers.push({ url, label: s.label || url, type: s.type || 'emby' });
      changed = true;
    } else {
      // Update label/type if changed
      const existing = healthServers.find(h => h.url === url);
      if (existing.label !== s.label || existing.type !== s.type) {
        existing.label = s.label || url;
        existing.type  = s.type || 'emby';
        changed = true;
      }
    }
  }
  if (changed) saveHealthData();
}

async function pingHealthServers() {
  if (healthServers.length === 0) return;
  await Promise.all(healthServers.map(async (server) => {
    const t0 = Date.now();
    let up = false, ms = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        await fetch(`${server.url}/System/Ping`, { signal: controller.signal });
        up = true;
        ms = Date.now() - t0;
      } finally { clearTimeout(timer); }
    } catch { /* offline */ }
    if (!healthHistory[server.url]) healthHistory[server.url] = [];
    healthHistory[server.url].unshift({ ts: Date.now(), up, ms, label: server.label });
    if (healthHistory[server.url].length > MAX_HEALTH_ENTRIES)
      healthHistory[server.url] = healthHistory[server.url].slice(0, MAX_HEALTH_ENTRIES);
  }));
  saveHealthData();
}

// Boot: load persisted data then start background pinger
loadHealthData();
setInterval(pingHealthServers, HEALTH_INTERVAL_MS);
// Ping immediately on startup (after 10s to let server settle)
setTimeout(pingHealthServers, 10000);

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

async function pingServer(server) {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try { await fetch(`${server.url}/System/Ping`, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    return Date.now() - t0;
  } catch { return null; }
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

// ─── Language → flag emoji lookup ────────────────────────────────────────────
const LANG_FLAGS = {
  eng: '🇺🇸', en: '🇺🇸',
  rus: '🇷🇺', ru: '🇷🇺',
  fra: '🇫🇷', fre: '🇫🇷', fr: '🇫🇷',
  deu: '🇩🇪', ger: '🇩🇪', de: '🇩🇪',
  spa: '🇪🇸', es: '🇪🇸',
  jpn: '🇯🇵', ja: '🇯🇵',
  zho: '🇨🇳', chi: '🇨🇳', cmn: '🇨🇳', zh: '🇨🇳',
  kor: '🇰🇷', ko: '🇰🇷',
  ita: '🇮🇹', it: '🇮🇹',
  por: '🇵🇹', pob: '🇧🇷', pt: '🇵🇹',
  ara: '🇸🇦', ar: '🇸🇦',
  hin: '🇮🇳', hi: '🇮🇳',
  tur: '🇹🇷', tr: '🇹🇷',
  pol: '🇵🇱', pl: '🇵🇱',
  nld: '🇳🇱', dut: '🇳🇱', nl: '🇳🇱',
  swe: '🇸🇪', sv: '🇸🇪',
  nor: '🇳🇴', no: '🇳🇴',
  dan: '🇩🇰', da: '🇩🇰',
  fin: '🇫🇮', fi: '🇫🇮',
  ces: '🇨🇿', cze: '🇨🇿', cs: '🇨🇿',
  slk: '🇸🇰', slo: '🇸🇰', sk: '🇸🇰',
  hun: '🇭🇺', hu: '🇭🇺',
  ron: '🇷🇴', rum: '🇷🇴', ro: '🇷🇴',
  bul: '🇧🇬', bg: '🇧🇬',
  hrv: '🇭🇷', hr: '🇭🇷',
  srp: '🇷🇸', sr: '🇷🇸',
  ukr: '🇺🇦', uk: '🇺🇦',
  heb: '🇮🇱', he: '🇮🇱',
  ell: '🇬🇷', gre: '🇬🇷', el: '🇬🇷',
  vie: '🇻🇳', vi: '🇻🇳',
  tha: '🇹🇭', th: '🇹🇭',
  ind: '🇮🇩', idn: '🇮🇩', id: '🇮🇩',
  msa: '🇲🇾', may: '🇲🇾', ms: '🇲🇾',
};
function langFlag(code) {
  return LANG_FLAGS[(code || '').toLowerCase()] || null;
}

// Bitrate quality bar (5 chars scaled to 0/5/10/20/35 Mbps, style-aware)
function buildBitrateBar(bps, style = 'blocks') {
  if (!bps) return '';
  const mbps = bps / 1e6;
  const filled = (mbps > 0 ? 1 : 0) + (mbps >= 5 ? 1 : 0) + (mbps >= 10 ? 1 : 0) + (mbps >= 20 ? 1 : 0) + (mbps >= 35 ? 1 : 0);
  const n = Math.min(filled, 5);
  const e = 5 - n;
  if (style === 'segments') return '▰'.repeat(n) + '▱'.repeat(e);
  if (style === 'dots')     return '●'.repeat(n) + '○'.repeat(e);
  return '█'.repeat(n) + '░'.repeat(e); // blocks (default)
}

// ─── Stream building from PlaybackInfo MediaSources ──────────────────────────

function mediaSourcesToStreams(server, itemId, mediaSources, labelPreset, streamOpts = {}) {
  // Each is a style string (e.g. 'emoji', 'flag', 'blocks') or falsy = off
  const qualityBadgeStyle = streamOpts.qualityBadge || null;
  const flagEmojiStyle    = streamOpts.flagEmoji    || null;
  const bitrateBarStyle   = streamOpts.bitrateBar   || null;
  const subsStyle         = streamOpts.subsStyle     || 'full';
  const displayLabel = server.emoji ? `${server.emoji} ${server.label}` : server.label;
  const streams = [];
  for (const source of mediaSources) {
    const sizeBytes = source.Size || 0;
    const bitrate   = source.Bitrate || 0;
    const mediaStreams = source.MediaStreams || [];

    const videoStream  = mediaStreams.find((s) => s.Type === 'Video');
    const audioStream  = mediaStreams.find((s) => s.Type === 'Audio');
    const audioStreams = mediaStreams.filter((s) => s.Type === 'Audio');
    const subStreams   = mediaStreams.filter((s) => s.Type === 'Subtitle');

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

    // ── Top audio badge for quality-badge feature
    let topAudioBadge = null;
    if (audioStream) {
      const _ac = (audioStream.Codec || '').toLowerCase();
      const _prof = (audioStream.Profile || '').toLowerCase();
      if (_prof.includes('atmos')) topAudioBadge = '🔊';
      else if (_ac.includes('truehd') || _ac === 'dts-ma' || _ac === 'dtshd') topAudioBadge = '🎵';
    }

    // ── All audio tracks (shown when > 1 track exists)
    const allAudioLabel = audioStreams.length > 1
      ? audioStreams.map(s => {
          const ac = (s.Codec || '').toLowerCase();
          const ch = s.Channels;
          const chStr = ch === 8 ? '7.1' : ch === 6 ? '5.1' : ch === 2 ? '2.0' : ch ? `${ch}ch` : '';
          let name = ac.includes('truehd') ? 'TrueHD' : (ac === 'dts-ma' || ac === 'dtshd') ? 'DTS-MA'
            : ac.includes('dts') ? 'DTS' : ac === 'eac3' ? 'DD+' : ac === 'ac3' ? 'DD'
            : ac.includes('aac') ? 'AAC' : (s.Codec || '').toUpperCase();
          const rawLang = s.Language ? s.Language.toUpperCase().slice(0, 3) : '';
          const flag = langFlag(s.Language);
          const lang = flagEmojiStyle === 'flag' ? (flag || rawLang)
                     : flagEmojiStyle === 'both' ? (flag ? flag + rawLang : rawLang)
                     : rawLang;
          return [lang, name, chStr].filter(Boolean).join(' ');
        }).join(' · ')
      : null;

    // ── Subtitle tracks — display varies by subsStyle
    let subsLabel = null;
    if (subsStyle !== 'hidden' && subStreams.length > 0) {
      const uniqueLangs = [...new Set(subStreams.map(s => (s.Language || s.DisplayTitle || '?').slice(0, 3).toUpperCase()))];
      if (subsStyle === 'count') {
        subsLabel = `💬 ${uniqueLangs.length} sub${uniqueLangs.length !== 1 ? 's' : ''}`;
      } else if (subsStyle === 'icons' || flagEmojiStyle) {
        // icons mode, or full+flag — show flag emoji per language
        subsLabel = '💬 ' + uniqueLangs.map(l => langFlag(l) || l).join(' ');
      } else {
        subsLabel = 'Subs: ' + uniqueLangs.join(' · ');
      }
    }

    // ── Raw codec ID (for filtering/preference)
    const rawCodec = videoStream ? (videoStream.Codec || '').toLowerCase() : null;
    const codecId = rawCodec === 'hevc' || rawCodec === 'h265' ? 'hevc'
      : rawCodec === 'h264' || rawCodec === 'avc' ? 'h264'
      : rawCodec === 'av1' ? 'av1'
      : rawCodec === 'vp9' ? 'vp9'
      : rawCodec ? 'other' : null;

    // ── Primary audio language (for preference sorting)
    const audioLangCode = audioStream ? (audioStream.Language || '').toLowerCase().slice(0, 3) || null : null;

    // ── Bitrate in Mbps (with optional visual bar)
    let bitrateLabel = bitrate ? `${(bitrate / 1e6).toFixed(1)}Mbps` : null;
    if (bitrateBarStyle && bitrate) {
      const bar = buildBitrateBar(bitrate, bitrateBarStyle);
      bitrateLabel = bitrateBarStyle === 'bar_only' ? bar : `${bar} ${bitrateLabel}`;
    }

    // ── Source label (REMUX, WEB-DL, etc. from filename)
    const sourceLabel = detectSourceLabel(source);
    const container = source.Container ? source.Container.toUpperCase() : null;

    // ── Build name + description based on label preset
    const sizeStr = formatFileSize(sizeBytes);

    let streamName, streamDesc;
    if (labelPreset === 'compact') {
      // Name: Server · Res · HDR · Codec  |  Desc: Audio · Bitrate · Size (one line)
      streamName = [displayLabel, resLabel, hdrLabel, codecLabel].filter(Boolean).join(' · ');
      streamDesc = [audioLabel, bitrateLabel, sizeStr].filter(Boolean).join(' · ') || 'Unknown quality';

    } else if (labelPreset === 'detailed') {
      // Name: Server · Res · HDR  |  Desc: Codec · Source / all audio tracks / subs / size
      streamName = [displayLabel, resLabel, hdrLabel].filter(Boolean).join(' · ');
      streamDesc = [
        [codecLabel, sourceLabel].filter(Boolean).join(' · '),
        allAudioLabel || audioLabel,
        subsLabel,
        [dimsLabel, bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'cinema') {
      // Name: Server · Res · HDR · Source  |  Desc: Codec / Audio / Subs / Size
      streamName = [displayLabel, resLabel, hdrLabel, sourceLabel].filter(Boolean).join(' · ');
      streamDesc = [
        codecLabel,
        allAudioLabel || audioLabel,
        subsLabel,
        sizeStr,
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'bandwidth') {
      // Name: Server · Res · Bitrate  |  Desc: Codec · HDR / Audio / Size
      streamName = [displayLabel, resLabel, bitrateLabel].filter(Boolean).join(' · ');
      streamDesc = [
        [codecLabel, hdrLabel].filter(Boolean).join(' · '),
        audioLabel,
        sizeStr,
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'audiophile') {
      // Name: Server · Res · Audio  |  Desc: Codec · HDR · Source / all audio / subs / size
      streamName = [displayLabel, resLabel, audioLabel].filter(Boolean).join(' · ');
      streamDesc = [
        [codecLabel, hdrLabel, sourceLabel].filter(Boolean).join(' · '),
        allAudioLabel,
        subsLabel,
        [bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'source') {
      // Name: Server · Res · Source  |  Desc: HDR · Codec / Audio / Size
      streamName = [displayLabel, resLabel, sourceLabel || 'Unknown'].filter(Boolean).join(' · ');
      streamDesc = [
        [hdrLabel, codecLabel].filter(Boolean).join(' · '),
        allAudioLabel || audioLabel,
        [bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean).join('\n') || 'Unknown quality';

    } else if (labelPreset === 'minimal') {
      // Name: Server · Res  |  Desc: Size only
      streamName = [displayLabel, resLabel].filter(Boolean).join(' · ');
      streamDesc = sizeStr || bitrateLabel || 'Unknown quality';

    } else {
      // standard (default) — name has HDR, desc has codec+source / audio / subs / size
      // Dims line removed (redundant — res already in name)
      streamName = [displayLabel, resLabel, hdrLabel].filter(Boolean).join(' · ');
      const descLines = [
        [codecLabel, sourceLabel].filter(Boolean).join(' · '),
        allAudioLabel || audioLabel,
        subsLabel,
        [container, bitrateLabel, sizeStr].filter(Boolean).join(' · '),
      ].filter(Boolean);
      streamDesc = descLines.join('\n') || 'Unknown quality';
    }

    // ── Quality badges — style controls placement and format
    if (qualityBadgeStyle) {
      const emojiBadges = [];
      if (sourceLabel === 'REMUX') emojiBadges.push('💎');
      if (resLabel === '4K')       emojiBadges.push('🎬');
      if (hdrLabel === 'DV')       emojiBadges.push('🌈');
      else if (hdrLabel)           emojiBadges.push('✨');
      if (topAudioBadge)           emojiBadges.push(topAudioBadge);

      if (qualityBadgeStyle === 'emoji' && emojiBadges.length > 0) {
        streamName = emojiBadges.join('') + ' ' + streamName;

      } else if (qualityBadgeStyle === 'minimal' && emojiBadges.length > 0) {
        // Single highest-priority badge only
        streamName = emojiBadges[0] + ' ' + streamName;

      } else if (qualityBadgeStyle === 'tags') {
        // Text tags in square brackets
        const tags = [];
        if (sourceLabel === 'REMUX') tags.push('[REMUX]');
        if (resLabel === '4K')       tags.push('[4K]');
        if (hdrLabel === 'DV')       tags.push('[DV]');
        else if (hdrLabel === 'HDR10+') tags.push('[HDR10+]');
        else if (hdrLabel)           tags.push('[HDR]');
        if (topAudioBadge === '🔊') tags.push('[Atmos]');
        else if (topAudioBadge === '🎵') tags.push('[Lossless]');
        if (tags.length > 0) streamName = tags.join('') + ' ' + streamName;

      } else if (qualityBadgeStyle === 'suffix' && emojiBadges.length > 0) {
        streamName = streamName + '  ' + emojiBadges.join('');
      }
    }

    streams.push({
      url: buildStreamUrl(server, itemId, source.Id, source.Container),
      name: streamName,
      description: streamDesc,
      ...(server.thumbnail ? { thumbnail: server.thumbnail } : {}),
      _sizeBytes: sizeBytes,
      _bitrate: bitrate,
      _audioRank: audioRank,
      _mediaSourceId: source.Id,
      _resLabel: resLabel,
      _codec: codecId,
      _audioLang: audioLangCode,
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

  // Helper: race multiple query fns in parallel, return first with results
  const raceQueries = (fns) =>
    Promise.any(fns.map(fn =>
      fn().then(r => { if (r.length === 0) throw new Error('empty'); return r; })
    )).catch(() => []);

  if (server.type === 'jellyfin') {
    // Pre-fetch the name in parallel — ready if provider ID strategies fail
    const namePromise = resolveImdbName(imdbId, 'movie');

    // Strategy: all AnyProviderIdEquals formats in parallel
    items = await raceQueries(
      [`imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}`].map(val =>
        () => queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: val }).catch(() => [])
      )
    );

    // Fallback: name-based search (name already being fetched above)
    if (items.length === 0) {
      try {
        const movieName = await namePromise;
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
    // Emby: pre-fetch name in parallel while provider ID strategies run
    const namePromise = resolveImdbName(imdbId, 'movie');

    // All provider ID strategies fire simultaneously
    items = await raceQueries([
      () => queryItems('/Items', { ImdbId: imdbId }),
      () => queryItems(`/Users/${server.userId}/Items`, { ImdbId: imdbId }),
      () => queryItems(`/Users/${server.userId}/Items`, { AnyProviderIdEquals: `imdb.${imdbId}` }),
    ]);

    // Fallback: name-based search (name already being fetched above)
    // NOTE: intentionally does NOT use queryItems() here — queryItems validates ProviderIds,
    // which would drop items that are in the library but missing their IMDB metadata.
    // Instead, do a raw fetch and match by name only (same approach as the Jellyfin path).
    if (items.length === 0) {
      try {
        const movieName = await namePromise;
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
          items = (data.Items || []).filter(i => {
            const sn = (i.Name || '').toLowerCase().trim();
            const qn = movieName.toLowerCase().trim();
            return sn === qn || sn.includes(qn) || qn.includes(sn);
          });
          console.log(`[${server.label}] Emby name movie search "${movieName}": ${(data.Items||[]).length} raw → ${items.length} name-matched`);
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
    // Pre-fetch series name in parallel — ready if provider ID strategies all fail
    const namePromise = resolveImdbName(imdbId, 'series');

    // Race all provider ID strategies simultaneously
    const raceSeriesQueries = (fns) =>
      Promise.any(fns.map(fn =>
        fn().then(r => { if (r.length === 0) throw new Error('empty'); return r; })
      )).catch(() => []);

    seriesItems = await raceSeriesQueries([
      () => findSeriesById({ ImdbId: imdbId }),
      ...[ `imdb.${imdbId}`, `imdb.${numericImdbId}`, `Imdb.${imdbId}` ]
          .map(val => () => findSeriesById({ AnyProviderIdEquals: val })),
    ]);

    // Strategy 3: Name-based search — uses pre-fetched name (already in flight above)
    // Handles mismatched IMDB IDs between Stremio catalog and server
    if (seriesItems.length === 0) {
      const seriesName = await namePromise;
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
    // Pre-fetch name in parallel — ready immediately if provider ID search fails
    const namePromise = resolveImdbName(imdbId, 'series');

    if (server.type === 'jellyfin') {
      // Jellyfin: AnyProviderIdEquals is broken — search by name
      const seriesName = await namePromise;
      if (seriesName) {
        console.log(`[${server.label}] Direct episode fallback: searching episodes by name "${seriesName}"`);
        const resp = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }));
        items = (await resp.json()).Items || [];
      }
    } else {
      // Emby: run AnyProviderIdEquals and name fetch in parallel
      const [providerItems, seriesName] = await Promise.all([
        apiFetch(server, () => makeUrl({ AnyProviderIdEquals: `imdb.${imdbId}` }))
          .then(r => r.json()).then(d => d.Items || []).catch(() => []),
        namePromise,
      ]);

      if (providerItems.length > 0) {
        items = providerItems;
      } else if (seriesName) {
        console.log(`[${server.label}] Direct episode fallback: searching Emby episodes by name "${seriesName}"`);
        const resp2 = await apiFetch(server, () => makeUrl({ SearchTerm: seriesName }));
        items = (await resp2.json()).Items || [];
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

async function getStreamsFromServer(server, type, imdbId, season, episode, labelPreset, streamOpts = {}) {
  try {
    let items;
    if (type === 'movie') {
      items = await queryServerForMovie(server, imdbId);
    } else {
      items = await queryServerForEpisode(server, imdbId, season, episode);
    }

    // Capture the content name from the first matched item
    const itemName = items[0]?.Name || null;

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
        const streams = mediaSourcesToStreams(server, itemId, mediaSources, labelPreset, streamOpts);
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
        url: `${server.url}/no-stream-available`, _noResults: true, _noResultsType: 'not_found',
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `noresults:${server.label}`,
        _serverLabel: server.label, _itemName: null,
      }];
    }
    // Tag every real stream with its server label and content name for log metadata
    return result.map(s => ({ ...s, _serverLabel: server.label, _itemName: itemName }));
  } catch (err) {
    console.error(`[${server.label}] Query failed:`, err.message);
    return [{
      name: server.label, description: 'Server offline or unreachable',
      url: `${server.url}/no-stream-available`, _noResults: true, _noResultsType: 'offline',
      _sizeBytes: 0, _bitrate: 0, _audioRank: 999, _mediaSourceId: `offline:${server.label}`,
      _serverLabel: server.label, _itemName: null,
    }];
  }
}

async function getAllStreams(servers, type, imdbId, season, episode, opts = {}) {
  const { sortOrder, excludeRes, recommend, ping, audioLang, maxBitrate, prefCodec, codecMode, labelPreset, pingDetail, autoSelect, qualityBadge, flagEmoji, bitrateBar, subsStyle } = opts;
  const streamOpts = { qualityBadge, flagEmoji, bitrateBar, subsStyle };

  // Pings and stream queries run concurrently — pings add zero extra wall time
  const [pingResults, streamResults] = await Promise.all([
    Promise.all(ping ? servers.map(pingServer) : servers.map(() => null)),
    Promise.allSettled(servers.map(server => {
      const query = getStreamsFromServer(server, type, imdbId, season, episode, labelPreset, streamOpts);
      // Always enforce a per-server pipeline cutoff so multiple sequential fallbacks
      // (provider ID → resolveImdbName → name search) can never hang forever.
      // Cap at 2× the per-call timeout (max 20s) so the whole allSettled finishes
      // within a predictable window and every server always returns a visible result.
      const cutoff = Math.min((server._timeout || 10000) * 2, 20000);
      return Promise.race([
        query,
        new Promise((_, reject) => setTimeout(() => reject(new Error('cutoff')), cutoff)),
      ]);
    })),
  ]);

  const allStreams = streamResults.flatMap((result, i) => {
    if (result.status === 'rejected') {
      // Server timed out or threw — show a visible placeholder so it doesn't silently vanish
      const srv = servers[i];
      const isTimeout = (result.reason?.message || '').includes('cutoff');
      return [{
        name: srv.label,
        description: isTimeout ? 'Server timed out' : 'Server error',
        url: `${srv.url}/no-stream-available`,
        _noResults: true,
        _noResultsType: isTimeout ? 'timeout' : 'error',
        _sizeBytes: 0, _bitrate: 0, _audioRank: 999,
        _mediaSourceId: `${isTimeout ? 'timeout' : 'error'}:${srv.label}`,
        _serverLabel: srv.label, _itemName: null,
      }];
    }
    const streams = result.value;
    return streams.map(s => ({ ...s, _pingMs: pingResults[i] }));
  });

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

  // Filter by max bitrate (maxBitrate is in bps)
  if (maxBitrate) {
    realStreams = realStreams.filter(s => !s._bitrate || s._bitrate <= maxBitrate);
  }

  // Filter to ONLY preferred codec — only applied if it wouldn't empty the results
  if (prefCodec && prefCodec !== 'any' && codecMode === 'only') {
    const filtered = realStreams.filter(s => s._codec === prefCodec);
    if (filtered.length > 0) realStreams = filtered;
  }

  // Sort with audio-language and codec preferences as highest-priority tiers
  realStreams.sort((a, b) => {
    // Tier 1: preferred audio language
    if (audioLang && audioLang !== 'any') {
      const aL = (a._audioLang || '').startsWith(audioLang) ? 0 : 1;
      const bL = (b._audioLang || '').startsWith(audioLang) ? 0 : 1;
      if (aL !== bL) return aL - bL;
    }
    // Tier 2: preferred codec (in 'prefer' mode)
    if (prefCodec && prefCodec !== 'any' && codecMode !== 'only') {
      const aC = a._codec === prefCodec ? 0 : 1;
      const bC = b._codec === prefCodec ? 0 : 1;
      if (aC !== bC) return aC - bC;
    }
    // Tier 3: primary quality sort
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

  // Mark streams from the fastest server (⚡) — only when there's a clear winner
  if (ping) {
    const distinctPings = [...new Set(realStreams.map(s => s._pingMs).filter(p => p != null))];
    if (distinctPings.length > 1) {
      const minPing = Math.min(...distinctPings);
      realStreams = realStreams.map(s =>
        s._pingMs === minPing ? { ...s, name: `⚡ ${s.name}` } : s
      );
    }
  }

  // Mark top result as recommended (★) — applied after ⚡ so order is ★ ⚡ Name
  if (recommend && realStreams.length > 0) {
    realStreams[0] = { ...realStreams[0], name: `★ ${realStreams[0].name}` };
  }

  // Add ping RTT to description if pingDetail enabled
  if (ping && pingDetail) {
    realStreams = realStreams.map(s =>
      s._pingMs != null ? { ...s, description: `${s.description}\n📡 ${s._pingMs}ms` } : s
    );
  }

  // Auto-select: return only the single best stream
  if (autoSelect && realStreams.length > 0) {
    realStreams = [realStreams[0]];
  }

  // ── Build log metadata BEFORE stripping internal fields ─────────────────────
  // Content name: first non-null _itemName from real streams, or from no-results
  const contentName = allStreams.map(s => s._itemName).find(n => n != null) || null;

  // Best server: the top real stream after all sorting/filtering
  const bestStream = realStreams[0] || null;
  const bestServer = bestStream ? {
    label:   bestStream._serverLabel,
    size:    bestStream._sizeBytes,
    bitrate: bestStream._bitrate,
  } : null;

  // Per-server status breakdown
  const serverStatus = servers.map(srv => {
    const srvStreams = allStreams.filter(s => s._serverLabel === srv.label);
    if (!srvStreams.length) return { label: srv.label, emoji: srv.emoji || null, status: 'timeout' };
    const placeholder = srvStreams.find(s => s._noResults);
    if (placeholder) return { label: srv.label, emoji: srv.emoji || null, status: placeholder._noResultsType || 'not_found' };
    const real = srvStreams.filter(s => !s._noResults);
    const best = real[0];
    const resLabels = [...new Set(real.map(s => s._resLabel).filter(Boolean))];
    return {
      label:     srv.label,
      emoji:     srv.emoji || null,
      status:    'found',
      count:     real.length,
      size:      best?._sizeBytes || 0,
      bitrate:   best?._bitrate || 0,
      resLabels,
    };
  });

  const meta = { contentName, bestServer, serverStatus };

  // No-results/offline placeholders always at the bottom
  const finalStreams = [...realStreams, ...noResStreams]
    .map(({ _sizeBytes, _bitrate, _audioRank, _mediaSourceId, _noResults, _noResultsType, _resLabel, _pingMs, _codec, _audioLang, _serverLabel, _itemName, ...stream }) => stream);

  return { streams: finalStreams, meta };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/configure'));

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));


// ─── Server info (ping origin label) ─────────────────────────────────────────
// Railway exposes RAILWAY_REGION (e.g. "us-west2"), RAILWAY_SERVICE_NAME, etc.
app.get('/api/server-info', (req, res) => {
  const region = process.env.RAILWAY_REGION || process.env.FLY_REGION || null;
  const service = process.env.RAILWAY_SERVICE_NAME || null;
  res.json({
    region:  region  || null,
    service: service || null,
    host:    req.hostname || null,
  });
});

// ─── Server health dashboard ──────────────────────────────────────────────────
app.get('/servers', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'servers.html'));
});
app.get('/:config/servers', (req, res) => {
  res.redirect(`/servers?cfg=${encodeURIComponent(req.params.config)}`);
});

// Register servers for 24/7 health monitoring (no API keys — URL+label+type only)
app.post('/api/health/register', express.json(), (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers must be array' });
  registerHealthServers(servers);
  res.json({ ok: true, monitoring: healthServers.length });
});

// Return full history for all monitored servers
app.get('/api/health/history', (req, res) => {
  const result = healthServers.map(s => ({
    url:     s.url,
    label:   s.label,
    type:    s.type,
    history: (healthHistory[s.url] || []),
  }));
  res.json(result);
});

// Trigger an immediate ping of all registered servers
app.post('/api/health/ping-now', async (req, res) => {
  await pingHealthServers();
  const result = healthServers.map(s => ({
    url:    s.url,
    label:  s.label,
    latest: (healthHistory[s.url] || [])[0] || null,
  }));
  res.json(result);
});

// ─── Request log routes ───────────────────────────────────────────────────────
app.get('/api/request-log', (req, res) => {
  res.json(REQUEST_LOG);
});
app.post('/api/clear-request-log', (req, res) => {
  REQUEST_LOG.length = 0;
  res.json({ ok: true });
});

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

// ─── Ping servers ─────────────────────────────────────────────────────────────
app.post('/api/ping-servers', express.json(), async (req, res) => {
  const { servers } = req.body || {};
  if (!Array.isArray(servers)) return res.status(400).json({ error: 'servers array required' });
  const results = await Promise.all(servers.map(async s => {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try { await fetch(`${s.url}/System/Ping`, { signal: controller.signal }); }
      finally { clearTimeout(timer); }
      return { label: s.label, ms: Date.now() - t0 };
    } catch {
      return { label: s.label, ms: null };
    }
  }));
  res.json({ results });
});

// ─── Library stats ────────────────────────────────────────────────────────────
app.post('/api/library-stats', express.json(), async (req, res) => {
  const { url, type, apiKey, userId } = req.body || {};
  if (!url || !apiKey || !userId) {
    return res.status(400).json({ error: 'url, apiKey, userId required' });
  }
  const server = { url: url.replace(/\/$/, ''), type: type || 'emby', apiKey, userId, label: '' };
  try {
    const statsUrl = new URL(`${server.url}/Items/Counts`);
    statsUrl.searchParams.set('UserId', userId);
    appendAuth(statsUrl, server);
    const resp = await fetchWithTimeout(statsUrl.toString(), 8000, { headers: authHeaders(server) });
    const data = await resp.json();
    res.json({
      movies:   data.MovieCount   || 0,
      shows:    data.SeriesCount  || 0,
      episodes: data.EpisodeCount || 0,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403)
      return res.json({ error: 'Authentication failed' });
    if (err.name === 'AbortError')
      return res.json({ error: 'Connection timed out' });
    res.json({ error: err.message });
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
    behaviorHints: { configurable: true, configurationRequired: false },
  });
});

// Clicking the gear icon in Stremio opens the addon base URL in a browser
app.get('/:config/configure', (req, res) => {
  res.redirect('/configure');
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

  const timeoutMs = (cfg.timeout && cfg.timeout >= 2000 && cfg.timeout <= 10000) ? cfg.timeout : 10000;
  const servers = (cfg.servers || [])
    .filter(s => s.url && s.apiKey && s.userId)
    .map(s => ({ ...s, _timeout: timeoutMs }));

  if (servers.length === 0) {
    return res.json({ streams: [] });
  }

  const _t0 = Date.now();
  try {
    const { streams, meta } = await getAllStreams(servers, type, imdbId, season, episode, {
      sortOrder:   cfg.sortOrder,
      excludeRes:  cfg.excludeRes,
      recommend:   cfg.recommend,
      ping:        cfg.ping,
      audioLang:   cfg.audioLang,
      maxBitrate:  cfg.maxBitrate,
      prefCodec:   cfg.prefCodec,
      codecMode:   cfg.codecMode,
      labelPreset:  cfg.labelPreset,
      pingDetail:   cfg.pingDetail,
      autoSelect:   cfg.autoSelect,
      qualityBadge: cfg.qualityBadge === true ? 'emoji'  : (cfg.qualityBadge || null),
      flagEmoji:    cfg.flagEmoji    === true ? 'flag'   : (cfg.flagEmoji    || null),
      bitrateBar:   cfg.bitrateBar   === true ? 'blocks' : (cfg.bitrateBar   || null),
      subsStyle:    cfg.hideSubs     === true ? 'hidden' : (cfg.subsStyle    || 'full'),
    });
    // ── Results summary card (optional — pinned to top of stream list) ──────────
    if (cfg.showSummary) {
      const found = meta.serverStatus.filter(s => s.status === 'found');
      const total = found.reduce((n, s) => n + (s.count || 0), 0);
      const style = cfg.summaryStyle || 'compact';
      // Truncate label; if server has emoji (2 chars + space), reduce available text width
      const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '…' : str;
      const eLabel = (s, maxLen) => {
        const prefix = s.emoji ? s.emoji + ' ' : '';
        return prefix + trunc(s.label, maxLen - prefix.length);
      };

      let summaryName, lines;

      if (style === 'detailed') {
        summaryName = `📊 ${total} streams · ${found.length} found`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
            return `✅ ${l} — ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `❌ ${l} — none`;
          if (s.status === 'timeout')   return `⏱ ${l} — timeout`;
          return                               `🔴 ${l} — offline`;
        });

      } else if (style === 'minimal') {
        summaryName = `${total} streams · ${found.length} servers`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ` (${s.resLabels[0]})` : '';
            return `${l}: ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `${l}: —`;
          if (s.status === 'timeout')   return `${l}: timeout`;
          return                               `${l}: offline`;
        });

      } else if (style === 'bar') {
        summaryName = `📊 Results · ${total} streams`;
        const maxCount = Math.max(...found.map(s => s.count), 1);
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 10);
          if (s.status === 'found') {
            const filled = Math.max(1, Math.round((s.count / maxCount) * 4));
            const bar = '█'.repeat(filled) + '░'.repeat(4 - filled);
            return `${l} ${bar} ${s.count}`;
          }
          if (s.status === 'not_found') return `${l} ░░░░ ✗`;
          if (s.status === 'timeout')   return `${l} ⏱`;
          return                               `${l} 🔴`;
        });

      } else if (style === 'scoreboard') {
        summaryName = `📊 ${total} streams · ${found.length} servers`;
        const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨'];
        let rank = 0;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 12);
          if (s.status === 'found') {
            const num = circled[rank++] || `${rank}.`;
            const res = s.resLabels?.length ? ' · ' + s.resLabels[0] : '';
            return `${num} ${l}  ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `✗  ${l}`;
          if (s.status === 'timeout')   return `⏱  ${l}`;
          return                               `🔴  ${l}`;
        });

      } else if (style === 'trophy') {
        // 🏆🥈🥉 ranking — found servers ranked by count, rest below
        summaryName = `🏆 ${total} streams · ${found.length} found`;
        const medals = ['🏆','🥈','🥉','🎖️','🎖️'];
        const sorted = [...meta.serverStatus].sort((a, b) => {
          if (a.status === 'found' && b.status !== 'found') return -1;
          if (b.status === 'found' && a.status !== 'found') return 1;
          return (b.count || 0) - (a.count || 0);
        });
        let mi = 0;
        lines = sorted.map(s => {
          const l = eLabel(s, 11);
          if (s.status === 'found') {
            const medal = medals[mi++] || '·';
            const res = s.resLabels?.length ? ' · ' + s.resLabels[0] : '';
            return `${medal} ${l} ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `  ✗ ${l}`;
          if (s.status === 'timeout')   return `  ⏱ ${l}`;
          return                               `  🔴 ${l}`;
        });

      } else if (style === 'pulse') {
        // 🟢🟡🔴 health monitoring style
        summaryName = `⬤ Live · ${found.length} of ${meta.serverStatus.length} online`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 13);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels[0] : '';
            return `🟢 ${l} · ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `🟡 ${l} · none`;
          if (s.status === 'timeout')   return `🟠 ${l} · slow`;
          return                               `🔴 ${l} · down`;
        });

      } else if (style === 'report') {
        // ARCTV: 4× 4K·HD  breakdown style
        summaryName = `📋 ${total} streams · ${found.length} servers`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 11);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? '  ' + s.resLabels.join('·') : '';
            return `${l}: ${s.count}×${res}`;
          }
          if (s.status === 'not_found') return `${l}: none`;
          if (s.status === 'timeout')   return `${l}: timed out`;
          return                               `${l}: offline`;
        });

      } else if (style === 'spark') {
        // Single sparkline char per server ▁▂▃▄▅▆▇█
        summaryName = `▇ ${total} streams · ${found.length} found`;
        const sparks = ' ▁▂▃▄▅▆▇█';
        const maxCount = Math.max(...found.map(s => s.count), 1);
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 13);
          if (s.status === 'found') {
            const idx = Math.max(1, Math.min(8, Math.round((s.count / maxCount) * 8)));
            const spark = sparks[idx];
            const res = s.resLabels?.length ? ' ' + s.resLabels[0] : '';
            return `${spark} ${l}  ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `▁ ${l}  ✗`;
          if (s.status === 'timeout')   return `▁ ${l}  ⏱`;
          return                               `▁ ${l}  🔴`;
        });

      } else if (style === 'dot') {
        // ●/○ minimal clean dots
        summaryName = `● ${total} streams · ${found.length} live`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels[0] : '';
            return `● ${l}  ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `○ ${l}  none`;
          if (s.status === 'timeout')   return `○ ${l}  ⏱`;
          return                               `○ ${l}  🔴`;
        });

      } else {
        // compact (default) — ✅ Label · N · 4K
        summaryName = `📊 ${total} streams · ${found.length} servers`;
        lines = meta.serverStatus.map(s => {
          const l = eLabel(s, 14);
          if (s.status === 'found') {
            const res = s.resLabels?.length ? ' · ' + s.resLabels.join('·') : '';
            return `✅ ${l} · ${s.count}${res}`;
          }
          if (s.status === 'not_found') return `❌ ${l}`;
          if (s.status === 'timeout')   return `⏱ ${l}`;
          return                               `🔴 ${l}`;
        });
      }

      streams.unshift({
        name:        total > 0 ? summaryName : `📊 No streams found`,
        description: lines.join('\n'),
        url:         `${req.protocol}://${req.get('host')}/stream-summary`,
      });
    }

    addLogEntry({
      ts:           new Date().toISOString(),
      type,
      imdbId,
      season:       season  || null,
      episode:      episode || null,
      contentName:  meta.contentName,
      bestServer:   meta.bestServer,
      serverStatus: meta.serverStatus,
      found:        (meta.serverStatus || []).some(s => s.status === 'found'),
      ms:           Date.now() - _t0,
    });
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
