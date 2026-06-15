// ─── Cache IMDB → library item resolution (L2 tier) ─────────────────────────
const { get: cacheGet, set: cacheSet, TTL_MS } = require('./embyCache');
const { recordCacheHit } = require('./apiTraffic');

const RESOLVE_TTL_MS = TTL_MS;
const MISS_TTL_MS = 10 * 60 * 1000; // 10 minutes for "not on server"

function resolveKey(server, type, imdbId, season, episode) {
  return [
    'L2',
    server.url || '',
    server.userId || '',
    type,
    imdbId,
    season ?? '',
    episode ?? '',
  ].join('|');
}

function getResolved(server, type, imdbId, season, episode) {
  const key = resolveKey(server, type, imdbId, season, episode);
  const v = cacheGet('L2', key);
  if (v === undefined) return undefined;
  recordCacheHit('L2', 'Stremio play — cached title lookup');
  if (v && v.miss === true) return [];
  return v;
}

function setResolved(server, type, imdbId, season, episode, items) {
  const key = resolveKey(server, type, imdbId, season, episode);
  if (!items || !items.length) {
    cacheSet('L2', key, { miss: true }, MISS_TTL_MS);
    return;
  }
  const slim = items.map((i) => ({
    Id: i.Id, Name: i.Name, Type: i.Type, SeriesName: i.SeriesName,
    ParentIndexNumber: i.ParentIndexNumber, IndexNumber: i.IndexNumber, ProviderIds: i.ProviderIds,
    MediaSources: i.MediaSources,
  }));
  cacheSet('L2', key, slim);
}

module.exports = { getResolved, setResolved, RESOLVE_TTL_MS, MISS_TTL_MS };