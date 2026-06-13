(function () {
  const { bumpLoadGen, staleLoadGen, setLifecycle, setBundle, setError } = window.DashboardStateApi;
  const Lifecycle = window.DashboardLifecycle;
  const { fetchBundle } = window.DashboardApi;
  const console = window.DashboardConsole;
  const polling = window.DashboardPolling;

  let loadInflight = null;
  let lastLoadTs = 0;
  const LOAD_DEDUPE_MS = 3000;

  async function refreshScope(scope) {
    if (window.DashboardApi?.inBackoff?.()) {
      console.log(`Skipping refresh — rate limited (${scope})`, 'warn');
      return null;
    }
    console.log(`Refreshing · scope=${scope}`, 'busy');
    const bundle = await fetchBundle(scope);
    if (bundle?.error) {
      const level = bundle.status === 429 ? 'warn' : 'err';
      console.log(`Bundle failed — ${bundle.error}`, level);
      return null;
    }
    if (typeof window.applyDashboardBundle === 'function') {
      await window.applyDashboardBundle(bundle, { partial: scope !== 'full' });
    } else {
      setBundle(bundle, scope);
    }
    const merged = window.DashboardState?.lastBundle || bundle;
    console.logBundle(merged);
    return merged;
  }

  async function load() {
    if (loadInflight) return loadInflight;
    if (lastLoadTs && Date.now() - lastLoadTs < LOAD_DEDUPE_MS && window.DashboardState?.lastBundle) {
      return window.DashboardState.lastBundle;
    }

    loadInflight = (async () => {
      const gen = bumpLoadGen();
      setLifecycle(Lifecycle.loading);
      console.start('Opening dashboard…');

      if (typeof window.renderDashActivityShell === 'function') {
        window.renderDashActivityShell();
      }

      console.log('GET /api/dashboard/bundle?scope=full', 'busy');

      await (window.getAuth?.() || Promise.resolve());
      await (window.ensureAccountConfigLoaded?.() || Promise.resolve());
      if (staleLoadGen(gen)) return;

      let bundle;
      try {
        bundle = await fetchBundle('full');
      } catch (e) {
        setError(e);
        console.log(`Bundle request failed — ${e.message}`, 'err');
        return;
      }
      if (staleLoadGen(gen)) return;

      if (bundle?.error) {
        setError(new Error(bundle.error));
        console.log(bundle.error === 'sign in required' ? 'Sign in required' : bundle.error, 'warn');
        if (typeof window.renderDashActivity === 'function') {
          await window.renderDashActivity();
        }
        return;
      }

      if (typeof window.applyDashboardBundle === 'function') {
        await window.applyDashboardBundle(bundle, { gen, full: true });
      }

      setBundle(bundle, 'full');
      window._dashLastFullLoad = Date.now();
      setLifecycle(Lifecycle.ready);
      console.logBundle(bundle);
      console.log('Dashboard ready', 'ok');

      if (typeof window.pollLivePlaybackNotifications === 'function') {
        window.pollLivePlaybackNotifications();
      }
      if (typeof window.renderOnboarding === 'function') window.renderOnboarding();
      if (typeof window.replayDashTileAnimations === 'function') window.replayDashTileAnimations();

      polling.start({
        onLive: () => refreshScope('live'),
        onHealth: () => {
          window._kickHealthPingThrottled?.();
          refreshScope('health');
        },
        onStats: () => refreshScope('stats'),
      });

      return bundle;
    })();

    try {
      return await loadInflight;
    } finally {
      loadInflight = null;
      lastLoadTs = Date.now();
    }
  }

  function stop() {
    polling.stop();
    setLifecycle(Lifecycle.idle);
  }

  window.Dashboard = {
    load,
    stop,
    refreshScope,
    refreshStats: () => refreshScope('stats'),
    refreshLive: () => refreshScope('live'),
    get lastBundle() { return window.DashboardState?.lastBundle || null; },
  };
})();