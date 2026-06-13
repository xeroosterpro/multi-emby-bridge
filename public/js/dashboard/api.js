(function () {
  const SCOPES = ['full', 'live', 'stats', 'health'];

  async function fetchBundle(scope = 'full', opts = {}) {
    const s = SCOPES.includes(scope) ? scope : 'full';
    const qs = `scope=${encodeURIComponent(s)}`;
    const url = `/api/dashboard/bundle?${qs}`;
    const resp = await fetch(url, { credentials: 'same-origin', signal: opts.signal });
    if (resp.status === 401) return { error: 'sign in required', status: 401 };
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.error || `HTTP ${resp.status}`, status: resp.status };
    }
    return resp.json();
  }

  window.DashboardApi = { fetchBundle, SCOPES };
})();