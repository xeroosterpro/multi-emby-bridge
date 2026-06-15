(function () {
  const LIVE_MS = 8000;
  const HEALTH_MS = 15000;
  const CONN_MS = 30000;
  const CONN_WATCH_MS = 5000;

  let liveTimer = null;
  let healthTimer = null;
  let connTimer = null;
  let connWatchTimer = null;

  let onVisible = null;

  function onDash() {
    const dash = document.getElementById('page-dashboard');
    return dash && dash.classList.contains('on');
  }
  // Poll only when the dashboard is open AND the tab is visible — a backgrounded
  // tab burns no requests and won't fire a stale burst; we refresh on return.
  function active() { return onDash() && !document.hidden; }

  function stop() {
    clearInterval(liveTimer);
    clearInterval(healthTimer);
    clearInterval(connTimer);
    clearInterval(connWatchTimer);
    liveTimer = healthTimer = connTimer = connWatchTimer = null;
    if (onVisible) { document.removeEventListener('visibilitychange', onVisible); onVisible = null; }
  }

  function start(handlers = {}) {
    stop();
    connWatchTimer = setInterval(() => { if (active()) handlers.onConn?.(); }, CONN_WATCH_MS);
    liveTimer = setInterval(() => { if (active()) handlers.onLive?.(); }, LIVE_MS);
    healthTimer = setInterval(() => { if (active()) handlers.onHealth?.(); }, HEALTH_MS);
    connTimer = setInterval(() => { if (active()) handlers.onStats?.(); }, CONN_MS);
    // Immediate refresh when the tab regains focus on the dashboard (don't wait
    // up to 30s for the next tick after the user comes back).
    onVisible = () => { if (active()) { handlers.onConn?.(); handlers.onLive?.(); } };
    document.addEventListener('visibilitychange', onVisible);
  }

  window.DashboardPolling = { start, stop, LIVE_MS, HEALTH_MS, CONN_MS, CONN_WATCH_MS };
})();