const { apiFetch, getEffectiveApiKey } = require('../auth');
const { normUrl } = require('./servers');

const CONN_TIMEOUT_MS = 12000;
const CONN_CONCURRENCY = 3;

function bridgeMsFromHealth(healthHistory, url) {
  const key = normUrl(url);
  const rows = healthHistory[key] || healthHistory[url] || [];
  const latest = rows[0];
  if (!latest?.up || latest.ms == null) return null;
  const age = Date.now() - (latest.ts || 0);
  if (age > 5 * 60 * 1000) return null;
  return latest.ms;
}

async function testOneConnection(server, healthHistory) {
  const label = server.label || server.url || '?';
  const url = server.url;
  const sentKey = server.apiKey;
  const bridgeMs = bridgeMsFromHealth(healthHistory, url);
  try {
    const resp = await apiFetch(server, () => new URL(`${server.url}/System/Info`), CONN_TIMEOUT_MS);
    await resp.json();
    const out = { url, label, ok: true, bridgeMs, error: null };
    const refreshed = getEffectiveApiKey(server);
    if (refreshed && refreshed !== sentKey) out.apiKey = refreshed;
    return out;
  } catch (err) {
    const msg = err.status === 401 || err.status === 403
      ? 'Authentication failed'
      : err.name === 'AbortError'
        ? 'Connection timed out'
        : (err.message || 'Connection failed');
    return { url, label, ok: false, bridgeMs, error: msg };
  }
}

async function fetchConnections(servers, healthHistory, mapPool) {
  return mapPool(servers, (s) => testOneConnection(s, healthHistory), CONN_CONCURRENCY);
}

module.exports = {
  CONN_TIMEOUT_MS,
  CONN_CONCURRENCY,
  bridgeMsFromHealth,
  testOneConnection,
  fetchConnections,
};