const { apiFetch, getEffectiveApiKey } = require('./auth');
const { apiPathVariants } = require('./serverPaths');

async function fetchLibraryCounts(server, timeoutMs = 15000) {
  if (!server?.url || !server?.userId) {
    const err = new Error('url and userId are required');
    err.status = 400;
    throw err;
  }
  const variants = apiPathVariants(server.url, '/Items/Counts');
  let lastErr = null;
  for (const variant of variants) {
    try {
      const resp = await apiFetch(server, () => {
        const u = new URL(variant.toString());
        u.searchParams.set('UserId', server.userId);
        return u;
      }, timeoutMs);
      const data = await resp.json();
      return {
        movies: data.MovieCount || 0,
        shows: data.SeriesCount || 0,
        episodes: data.EpisodeCount || 0,
      };
    } catch (err) {
      lastErr = err;
      if (err.status === 401 || err.status === 403) throw err;
    }
  }
  if (lastErr) throw lastErr;
  const err = new Error('Library stats unavailable');
  err.status = 502;
  throw err;
}

function libraryStatsPayload(server, sentKey) {
  const refreshed = getEffectiveApiKey(server);
  const out = {};
  if (refreshed && refreshed !== sentKey) out.apiKey = refreshed;
  return out;
}

module.exports = { fetchLibraryCounts, libraryStatsPayload };