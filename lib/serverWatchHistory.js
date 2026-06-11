// ─── Native Emby/Jellyfin watch history for dashboard activity ───────────────
const { apiFetch } = require('./auth');
const { isDemoServer } = require('./demoServers');
const { buildItemTitle } = require('./streams');

const ITEM_FIELDS = 'ProviderIds,Name,Type,UserData,SeriesName,ParentIndexNumber,IndexNumber,RunTimeTicks,ProductionYear';

function progressFromItem(item, kind) {
  const ud = item.UserData || {};
  if (kind === 'resume') {
    if (ud.PlayedPercentage != null) return Math.min(100, Math.max(0, Math.round(ud.PlayedPercentage)));
    const run = Number(item.RunTimeTicks) || 0;
    const pos = ud.PlaybackPositionTicks != null ? Number(ud.PlaybackPositionTicks) : null;
    if (run > 0 && pos != null && pos >= 0) return Math.min(100, Math.max(0, Math.round((pos / run) * 100)));
    return 1;
  }
  if (ud.PlayedPercentage != null) return Math.min(100, Math.round(ud.PlayedPercentage));
  return 100;
}

function tsFromItem(item, kind) {
  const ud = item.UserData || {};
  return ud.LastPlayedDate || ud.DatePlayed || (kind === 'resume' ? new Date().toISOString() : null);
}

function mapServerItem(item, server, kind) {
  const title = buildItemTitle(item);
  if (!title) return null;
  const type = item.Type === 'Episode' ? 'series' : (item.Type === 'Movie' ? 'movie' : null);
  return {
    title,
    season: item.ParentIndexNumber ?? null,
    episode: item.IndexNumber ?? null,
    imdbId: item.ProviderIds?.Imdb || item.ProviderIds?.imdb || null,
    ts: tsFromItem(item, kind),
    source: 'server',
    server: server.label || server.url,
    serverType: server.type || 'emby',
    kind,
    progressPct: progressFromItem(item, kind),
    itemType: item.Type || null,
    year: item.ProductionYear || null,
    type,
  };
}

async function fetchEndpoint(server, path, limit, timeoutMs) {
  const base = String(server.url || '').replace(/\/+$/, '');
  const resp = await apiFetch(
    { ...server, url: base, _timeout: timeoutMs },
    () => {
      const u = new URL(`${base}${path}`);
      u.searchParams.set('Limit', String(limit));
      u.searchParams.set('Fields', ITEM_FIELDS);
      if (path.includes('Resume')) u.searchParams.set('MediaType', 'Video');
      return u;
    },
    timeoutMs,
  );
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : (data?.Items || []);
}

async function fetchServerWatchHistory(servers, opts = {}) {
  const limit = opts.limitPerEndpoint || 20;
  const timeoutMs = opts.timeoutMs || 5000;
  const active = (servers || []).filter(s => s?.url && s?.apiKey && s?.userId && s.enabled !== false && !isDemoServer(s));
  const entries = [];

  await Promise.all(active.map(async (server) => {
    const uid = encodeURIComponent(server.userId);
    try {
      const [resumeItems, playedItems] = await Promise.all([
        fetchEndpoint(server, `/Users/${uid}/Items/Resume`, limit, timeoutMs).catch(() => []),
        fetchEndpoint(server, `/Users/${uid}/PlayedItems`, limit, timeoutMs).catch(() => []),
      ]);
      for (const item of resumeItems) {
        const row = mapServerItem(item, server, 'resume');
        if (row?.ts) entries.push(row);
      }
      for (const item of playedItems) {
        const row = mapServerItem(item, server, 'played');
        if (row?.ts) entries.push(row);
      }
    } catch { /* skip unreachable server */ }
  }));

  return entries;
}

module.exports = { fetchServerWatchHistory, mapServerItem, progressFromItem };