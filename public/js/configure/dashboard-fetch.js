// configure/dashboard-fetch.js — timed fetch helpers for dashboard API calls
async function _mapPool(items, worker, concurrency = 3) {
  if (!items.length) return;
  let idx = 0;
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  }));
}
const BRIDGE_FRESH_MS = 90 * 1000; // align with 30s health pings (+ buffer)
const DASH_GRAPH_POLL_MS = 15000; // sparklines + health-based ONLINE/OFFLINE (reduced for smoother feel, less frequent updates)
const DASH_CONN_POLL_MS = 30000; // full authenticated connection test
const DASH_HEALTH_PING_MS = 10000; // aggressive pings while dashboard open to detect downs faster (bulletproof wiring)

function _bridgeMsFromHealth(healthByUrl, url) {
  const lat = healthByUrl[_normServerUrl(url)]?.history?.[0];
  if (!lat?.up || lat.ms == null || Date.now() - lat.ts > BRIDGE_FRESH_MS) return null;
  return lat.ms;
}

const OPENING_FETCH_TIMEOUT_MS = 6000; // cap per-server waits so one slow/timeout server (e.g. auth fail, unreachable) doesn't make "Opening dashboard" hang forever

async function _fetchWithTimeout(url, options = {}, timeoutMs = OPENING_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function _testServerConnection(s) {
  if (!s.url) return { ok: false };
  if (!_useAccountCredsForApi() && (!s.apiKey || !s.userId)) return { ok: false };
  try {
    const r = await _fetchWithTimeout('/api/test-connection', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_serverApiBody(s)),
    }, 5000);
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data.ok, apiKey: data.apiKey };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false };
  }
}
