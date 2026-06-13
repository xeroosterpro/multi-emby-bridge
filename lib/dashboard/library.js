const { fetchLibraryCounts, libraryStatsPayload } = require('../libraryStats');

const LIB_TIMEOUT_MS = 20000;
const LIB_CONCURRENCY = 3;

async function fetchOneLibrary(server) {
  const label = server.label || server.url || '?';
  const sentKey = server.apiKey;
  try {
    const stats = await fetchLibraryCounts(server, LIB_TIMEOUT_MS);
    return {
      url: server.url,
      label: server.label || '',
      ok: true,
      ...stats,
      ...libraryStatsPayload(server, sentKey),
    };
  } catch (err) {
    const msg = err.status === 401 || err.status === 403
      ? 'Authentication failed'
      : err.name === 'AbortError'
        ? 'Connection timed out'
        : (err.message || 'Library stats failed');
    return { url: server.url, label: server.label || '', ok: false, error: msg };
  }
}

async function fetchLibraryBatch(servers, mapPool) {
  // Per-item safety timeout slightly above worker timeout acts as backstop so one stuck server cannot hang the dashboard bundle
  return mapPool(servers, fetchOneLibrary, LIB_CONCURRENCY, LIB_TIMEOUT_MS + 5000);
}

module.exports = { LIB_TIMEOUT_MS, LIB_CONCURRENCY, fetchOneLibrary, fetchLibraryBatch };