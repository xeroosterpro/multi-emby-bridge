// ─── Cache IMDB → library item resolution (cuts repeat stream lookups) ───────
const { makeLruCache } = require('./lruCache');

const RESOLVE_TTL_MS = 10 * 60 * 1000;
const cache = makeLruCache({ max: 400, ttlMs: RESOLVE_TTL_MS });

function resolveKey(server, type, imdbId, season, episode) {
  return [
    server.url || '',
    server.userId || '',
    type,
    imdbId,
    season ?? '',
    episode ?? '',
  ].join('|');
}

function getResolved(server, type, imdbId, season, episode) {
  return cache.get(resolveKey(server, type, imdbId, season, episode));
}

function setResolved(server, type, imdbId, season, episode, items) {
  if (!items || !items.length) return;
  const slim = items.map((i) => ({ Id: i.Id, Name: i.Name, Type: i.Type, SeriesName: i.SeriesName,
    ParentIndexNumber: i.ParentIndexNumber, IndexNumber: i.IndexNumber, ProviderIds: i.ProviderIds }));
  cache.set(resolveKey(server, type, imdbId, season, episode), slim);
}

module.exports = { getResolved, setResolved, RESOLVE_TTL_MS };