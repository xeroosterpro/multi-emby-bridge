(function () {
  const { bumpLoadGen, staleLoadGen, setLifecycle, setBundle, setError } = window.DashboardStateApi;
  const Lifecycle = window.DashboardLifecycle;
  const { fetchBundle } = window.DashboardApi;
  const console = window.DashboardConsole;
  const polling = window.DashboardPolling;

  let loadInflight = null;
  let lastLoadTs = 0;
  const LOAD_DEDUPE_MS = 3000;
  const MEM_BUNDLE_TTL_MS = 10 * 60 * 1000;

  function startPolling() {
    polling.start({
      onLive: () => refreshScope('live'),
      onHealth: () => {
        window._kickHealthPingThrottled?.();
        refreshScope('health');
      },
      onStats: () => refreshScope('stats'),
    });
  }

  function afterReady() {
    if (typeof window.pollLivePlaybackNotifications === 'function') {
      window.pollLivePlaybackNotifications();
    }
    if (typeof window.renderOnboarding === 'function') window.renderOnboarding();
    if (typeof window.replayDashTileAnimations === 'function') window.replayDashTileAnimations();
  }

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
    console.logBundle(merged, { scope, errors: bundle?.errors });
    return merged;
  }

  async function stagedLoad(gen) {
    await refreshScope('health');
    if (staleLoadGen(gen)) return null;
    await refreshScope('stats');
    if (staleLoadGen(gen)) return null;
    const merged = window.DashboardState?.lastBundle;
    setLifecycle(Lifecycle.ready);
    window._dashLastFullLoad = Date.now();
    console.log('Dashboard ready', 'ok');
    startPolling();
    afterReady();
    refreshScope('live').catch(() => {});
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

      await (window.getAuth?.() || Promise.resolve());
      await (window.ensureAccountConfigLoaded?.() || Promise.resolve());
      if (staleLoadGen(gen)) return;

      const serverN = window.paintDashboardSkeleton?.() || 0;
      if (typeof window.renderDashActivityShell === 'function') {
        window.renderDashActivityShell(serverN);
      }

      const mem = window.DashboardState?.lastBundle;
      const memFresh = mem?.ts && (Date.now() - mem.ts < MEM_BUNDLE_TTL_MS) && mem.servers?.length;
      if (memFresh && typeof window.applyDashboardBundle === 'function') {
        await window.applyDashboardBundle(mem, { full: true });
        setLifecycle(Lifecycle.ready);
        window._dashLastFullLoad = Date.now();
        console.log('Restored last dashboard snapshot', 'ok');
        startPolling();
        afterReady();
        stagedLoad(gen).catch(() => {});
        return mem;
      }

      try {
        return await stagedLoad(gen);
      } catch (e) {
        setError(e);
        console.log(`Dashboard load failed — ${e.message}`, 'err');
        if (typeof window.renderDashActivity === 'function') {
          await window.renderDashActivity();
        }
        return null;
      }
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