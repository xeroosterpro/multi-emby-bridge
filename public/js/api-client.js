// ─── Resilient fetch layer ───────────────────────────────────────────────────
// Two parts:
//  1) A drop-in window.api()/window.apiJson() helper for app code — timeout,
//     bounded transient retry, safe JSON, optional error toast.
//  2) A narrow global fetch hardening: ONLY same-origin /api/* requests that the
//     caller didn't already give a signal (i.e. unguarded "naked" calls) get an
//     abort-timeout + one transient retry. Cross-origin (Emby probes), demo-mode,
//     static assets, and caller-controlled fetches are passed through untouched —
//     so this can't interfere with the client-side server probing or upstream 401s.
(function () {
  const DEFAULT_TIMEOUT = 20000;
  const prevFetch = window.fetch.bind(window);

  const backoff = (attempt) => new Promise((r) => setTimeout(r, 200 + attempt * 250 + Math.floor(Math.random() * 150)));

  function isTransientError(err) {
    return !!err && (err.name === 'AbortError' || /failed to fetch|networkerror|load failed/i.test(err.message || ''));
  }
  function isSameOriginApi(input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    return url.startsWith('/api/') || url.startsWith(location.origin + '/api/');
  }

  // Core resilient request used by both the global hardening and window.api().
  async function resilient(fetchImpl, input, init, { timeout = DEFAULT_TIMEOUT, retries = 1 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetchImpl(input, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        // Return whatever the server said — we never retry HTTP 5xx (that would
        // amplify load during an outage). Only network/timeout errors retry.
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (isTransientError(err) && attempt < retries) { await backoff(attempt); continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  // Narrow global hardening — only naked same-origin /api/* calls.
  window.fetch = function (input, init) {
    init = init || {};
    if (init.signal || !isSameOriginApi(input)) return prevFetch(input, init);
    return resilient(prevFetch, input, init);
  };

  // Explicit helper for app code that wants consistent handling.
  async function api(url, opts = {}) {
    const { timeout, retries, silent, ...init } = opts;
    if (!('credentials' in init)) init.credentials = 'same-origin';
    try {
      return await resilient(prevFetch, url, init, { timeout, retries });
    } catch (err) {
      if (!silent && typeof window.toast === 'function') {
        window.toast(err.name === 'AbortError' ? 'Request timed out. Check your connection.' : 'Network error. Please try again.');
      }
      throw err;
    }
  }
  async function apiJson(url, opts) {
    const res = await api(url, opts);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    if (!res.ok) { const e = new Error((body && body.error) || ('HTTP ' + res.status)); e.status = res.status; e.body = body; throw e; }
    return body;
  }

  window.api = api;
  window.apiJson = apiJson;
})();
