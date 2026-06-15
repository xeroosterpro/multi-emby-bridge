// ─── Cache IMDB → library item resolution (L2 tier) ─────────────────────────
const { get: cacheGet, set: cacheSet, TTL_MS } = require('./embyCache');
const { recordCacheHit } = require('./apiTraffic');

const RESOLVE_TTL_MS = TTL_MS;

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
  if (v !== undefined) {
    recordCacheHit('L2', 'Stremio play — cached title lookup');
  }
  return v;
}

function setResolved(server, type, imdbId, season, episode, items) {
  if (!items || !items.length) return;
  const slim = items.map((i) => ({
    Id: i.Id, Name: i.Name, Type: i.Type, SeriesName: i.SeriesName,
    ParentIndexNumber: i.ParentIndexNumber, IndexNumber: i.IndexNumber, ProviderIds: i.ProviderIds,
  }));
  cacheSet('L2', resolveKey(server, type, imdbId, season, episode), slim);
}

module.exports = { getResolved, setResolved, RESOLVE_TTL_MS };