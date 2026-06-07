// ─── Health alert helpers — consecutive down detection (pure, no I/O) ─────────

function normUrl(url) {
  return (url || '').replace(/\/+$/, '');
}

/**
 * True when the last `consecutive` health entries for a URL are all down.
 * @param {object} healthHistory - map url -> [{ ts, up, ms, label }]
 * @param {string} url
 * @param {number} consecutive - default 3 (15 min at 5-min ping interval)
 */
function isServerDown(healthHistory, url, consecutive = 3) {
  const history = (healthHistory && healthHistory[normUrl(url)]) || [];
  if (history.length < consecutive) return false;
  const recent = history.slice(0, consecutive);
  return recent.every(e => e && e.up === false);
}

/**
 * Detect servers that have been down for N consecutive checks.
 * @returns {Array<{ url, label, failures, sinceTs }>}
 */
function detectDownServers(healthHistory, servers, opts = {}) {
  const consecutive = opts.consecutive != null ? opts.consecutive : 3;
  const out = [];
  for (const srv of servers || []) {
    const url = normUrl(srv.url);
    if (!url) continue;
    const history = (healthHistory && healthHistory[url]) || [];
    if (history.length < consecutive) continue;
    const recent = history.slice(0, consecutive);
    if (!recent.every(e => e && e.up === false)) continue;
    const sinceTs = recent[recent.length - 1]?.ts || recent[0]?.ts || null;
    out.push({
      url,
      label: srv.label || history[0]?.label || url,
      failures: consecutive,
      sinceTs,
    });
  }
  return out;
}

/**
 * Filter down-server list by snooze map: { [url]: iso expiry }.
 */
function filterSnoozed(downList, snoozed = {}) {
  const now = Date.now();
  return (downList || []).filter(d => {
    const exp = snoozed[normUrl(d.url)];
    if (!exp) return true;
    const t = new Date(exp).getTime();
    return Number.isNaN(t) || t <= now;
  });
}

module.exports = { normUrl, isServerDown, detectDownServers, filterSnoozed };