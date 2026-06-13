(function () {
  const Lifecycle = {
    idle: 'idle',
    loading: 'loading',
    ready: 'ready',
    polling: 'polling',
    error: 'error',
  };

  const state = {
    lifecycle: Lifecycle.idle,
    loadGen: 0,
    activityGen: 0,
    lastBundle: null,
    lastScope: null,
    lastError: null,
    inflight: null,
  };

  function bumpLoadGen() {
    state.loadGen += 1;
    return state.loadGen;
  }

  function staleLoadGen(gen) {
    return gen !== state.loadGen;
  }

  function bumpActivityGen() {
    state.activityGen += 1;
    return state.activityGen;
  }

  function staleActivityGen(gen) {
    return gen !== state.activityGen;
  }

  function setLifecycle(next) {
    state.lifecycle = next;
  }

  function setBundle(bundle, scope) {
    state.lastBundle = bundle;
    state.lastScope = scope || bundle?.scope || null;
    state.lastError = null;
    window.DashboardState = state;
  }

  function setError(err) {
    state.lastError = err;
    state.lifecycle = Lifecycle.error;
  }

  window.DashboardState = state;
  window.DashboardLifecycle = Lifecycle;
  window.DashboardStateApi = {
    bumpLoadGen,
    staleLoadGen,
    bumpActivityGen,
    staleActivityGen,
    setLifecycle,
    setBundle,
    setError,
  };
})();