const { fetchLibraryCounts, libraryStatsPayload } = require('../libraryStats');

const LIB_TIMEOUT_MS = 20000;
const LIB_CONCURRENCY = 3;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOneLibrary(server) {
  const label = server.label || server.url || '?';
  const sentKey = server.apiKey;
  const maxRetries = 2;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // use slightly longer timeout on retries for resilience on flaky servers
      const to = LIB_TIMEOUT_MS + (attempt * 5000);
      const stats = await fetchLibraryCounts(server, to);
      return {
        url: server.url,
        label: server.label || '',
        ok: true,
        ...stats,
        ...libraryStatsPayload(server, sentKey),
      };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        // jittered backoff: 500-1500ms + 1s*attempt
        const jitter = 500 + Math.random() * 1000 + (attempt * 1000);
        await sleep(jitter);
      }
    }
  }
  const err = lastErr;
  const msg = err && (err.status === 401 || err.status === 403)
    ? 'Authentication failed'
    : err && err.name === 'AbortError'
      ? 'Connection timed out'
      : (err && err.message) || 'Library stats failed';
  return { url: server.url, label: server.label || '', ok: false, error: msg };
}

async function fetchLibraryBatch(servers, mapPool) {
  // Per-item safety timeout slightly above worker timeout acts as backstop so one stuck server cannot hang the dashboard bundle
  return mapPool(servers, fetchOneLibrary, LIB_CONCURRENCY, LIB_TIMEOUT_MS + 5000);
}

module.exports = { LIB_TIMEOUT_MS, LIB_CONCURRENCY, fetchOneLibrary, fetchLibraryBatch };