(function () {
  const SCOPES = ['full', 'live', 'stats', 'health'];

  let backoffUntil = 0;
  let backoffMs = 0;
  const BACKOFF_INITIAL_MS = 5000;
  const BACKOFF_MAX_MS = 120000;

  function inBackoff() {
    return Date.now() < backoffUntil;
  }

  function applyBackoff() {
    backoffMs = backoffMs ? Math.min(backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_INITIAL_MS;
    backoffUntil = Date.now() + backoffMs;
  }

  function clearBackoff() {
    backoffMs = 0;
    backoffUntil = 0;
  }

  async function fetchBundle(scope = 'full', opts = {}) {
    if (inBackoff()) {
      return {
        error: 'Too many requests. Please try again later.',
        status: 429,
        retryAfterMs: backoffUntil - Date.now(),
      };
    }
    const s = SCOPES.includes(scope) ? scope : 'full';
    const qs = `scope=${encodeURIComponent(s)}`;
    const url = `/api/dashboard/bundle?${qs}`;
    const resp = await fetch(url, { credentials: 'same-origin', signal: opts.signal });
    if (resp.status === 401) return { error: 'sign in required', status: 401 };
    if (resp.status === 429) {
      applyBackoff();
      const err = await resp.json().catch(() => ({}));
      return {
        error: err.error || 'Too many requests. Please try again later.',
        status: 429,
        retryAfterMs: backoffUntil - Date.now(),
      };
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.error || `HTTP ${resp.status}`, status: resp.status };
    }
    clearBackoff();
    return resp.json();
  }

  window.DashboardApi = { fetchBundle, SCOPES, inBackoff };
})();