(function () {
  const LIVE_MS = 8000;
  const HEALTH_MS = 15000;
  const CONN_MS = 30000;
  const CONN_WATCH_MS = 5000;

  let liveTimer = null;
  let healthTimer = null;
  let connTimer = null;
  let connWatchTimer = null;

  function onDash() {
    const dash = document.getElementById('page-dashboard');
    return dash && dash.classList.contains('on');
  }

  function stop() {
    clearInterval(liveTimer);
    clearInterval(healthTimer);
    clearInterval(connTimer);
    clearInterval(connWatchTimer);
    liveTimer = healthTimer = connTimer = connWatchTimer = null;
  }

  function start(handlers = {}) {
    stop();
    connWatchTimer = setInterval(() => {
      if (!onDash()) return;
      handlers.onConn?.();
    }, CONN_WATCH_MS);
    liveTimer = setInterval(() => {
      if (!onDash()) return;
      handlers.onLive?.();
    }, LIVE_MS);
    healthTimer = setInterval(() => {
      if (!onDash()) return;
      handlers.onHealth?.();
    }, HEALTH_MS);
    connTimer = setInterval(() => {
      if (!onDash()) return;
      handlers.onStats?.();
    }, CONN_MS);
  }

  window.DashboardPolling = { start, stop, LIVE_MS, HEALTH_MS, CONN_MS, CONN_WATCH_MS };
})();