// Home page 4-step onboarding checklist (persisted in user_config).
(function () {
  const STEPS = [
    { id: 'server', label: 'Add your first server', page: 'servers' },
    { id: 'catalogs', label: 'Set up catalogs', page: 'catalogs' },
    { id: 'streaming', label: 'Set streaming preferences', page: 'streaming' },
    { id: 'install', label: 'Install addon to Stremio', page: 'install' },
    { id: 'test', label: 'Test a stream in Stremio', page: 'dashboard' },
  ];

  function esc(t) {
    return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function hasStreamingPrefs(cfg) {
    if (!cfg) return false;
    if (cfg.onboarding && cfg.onboarding.visitedStreaming) return true;
    return !!(
      cfg.sortOrder || cfg.audioRank || cfg.ping || cfg.recommend || cfg.autoSelect
      || cfg.excludeRes || cfg.maxBitrate || (cfg.prefCodec && cfg.prefCodec !== 'any')
      || cfg.perfMode || cfg.mode
    );
  }

  function hasCatalogSetup(cfg) {
    if (!cfg) return false;
    if (cfg.onboarding && cfg.onboarding.visitedCatalogs) return true;
    const rows = cfg.externalCatalogs || [];
    const hasRows = rows.some(r => r && r.enabled !== false);
    const libOn = cfg.showCatalog !== false;
    return hasRows || (libOn && Array.isArray(cfg.libraryRows) && cfg.libraryRows.length > 0);
  }

  function deriveSteps(cfg, manifestUrl, hasStreamLog) {
    const servers = (cfg && cfg.servers) || [];
    const hasServer = servers.some(s => s.url && s.apiKey && s.userId);
    return {
      server: hasServer,
      catalogs: hasCatalogSetup(cfg),
      streaming: hasStreamingPrefs(cfg),
      install: !!manifestUrl,
      test: !!(cfg && cfg.onboarding && cfg.onboarding.testedStream) || hasStreamLog,
    };
  }

  async function fetchState() {
    const [cfgRes, manRes, meRes] = await Promise.all([
      fetch('/api/user/config', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/user/manifest', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
    ]);
    if (!meRes || !meRes.user) return null;
    const cfg = (cfgRes && cfgRes.config) || {};
    let hasStreamLog = false;
    try {
      const log = await fetch('/api/request-log', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : []);
      hasStreamLog = Array.isArray(log) && log.some(e => e.found);
    } catch {}
    if (localStorage.getItem('meb-onboard-done') && !cfg.onboarding) {
      fetch('/api/user/config-patch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: { dismissed: true } }),
      }).catch(() => {});
      localStorage.removeItem('meb-onboard-done');
    }
    return {
      cfg,
      manifestUrl: manRes && manRes.url,
      done: deriveSteps(cfg, manRes && manRes.url, hasStreamLog),
      dismissed: !!(cfg.onboarding && cfg.onboarding.dismissed),
    };
  }

  function render(state) {
    const el = document.getElementById('home-onboard');
    if (!el || !state) { if (el) el.style.display = 'none'; return; }
    const allDone = STEPS.every(s => state.done[s.id]);
    if (state.dismissed || allDone) {
      el.style.display = 'none';
      if (allDone && !state.cfg.onboarding?.completedAt) {
        fetch('/api/user/config-patch', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboarding: { ...(state.cfg.onboarding || {}), completedAt: new Date().toISOString() } }),
        }).catch(() => {});
      }
      return;
    }
    const completed = STEPS.filter(s => state.done[s.id]).length;
    el.style.display = 'block';
    el.innerHTML = `
      <div class="home-panel-head">
        <div class="home-panel-head-l">
          <div class="home-ph-dot" style="background:linear-gradient(90deg,var(--accent-a),var(--accent-b))"></div>
          <span>Getting started</span>
        </div>
        <span class="home-panel-btn-mute">${completed}/${STEPS.length} complete</span>
      </div>
      <div class="home-onboard-steps">
        ${STEPS.map(s => `<button type="button" class="home-ob-step${state.done[s.id] ? ' done' : ''}" data-page="${s.page}">
          <span class="home-ob-check">${state.done[s.id] ? '✓' : ''}</span>
          <span>${esc(s.label)}</span>
        </button>`).join('')}
      </div>
      <div class="home-onboard-foot">
        <button type="button" class="home-panel-btn" id="home-onboard-dismiss">Dismiss</button>
      </div>`;
    el.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = '#/' + btn.dataset.page; });
    });
    el.querySelector('#home-onboard-dismiss').addEventListener('click', async () => {
      await fetch('/api/user/config-patch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: { dismissed: true } }),
      }).catch(() => {});
      el.style.display = 'none';
    });
  }

  async function refresh() {
    render(await fetchState());
  }

  window.MEBOnboarding = { refresh };

  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('hashchange', () => {
    const page = (location.hash || '').replace(/^#\//, '');
    if (page === 'streaming') {
      fetch('/api/user/config-patch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: { visitedStreaming: true } }),
      }).catch(() => {});
    }
    if (page === 'catalogs') {
      fetch('/api/user/config-patch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: { visitedCatalogs: true } }),
      }).catch(() => {});
    }
    if (page === 'home') refresh();
  });

  const origShow = window.onPageShow;
  window.onPageShow = function (name) {
    if (origShow) origShow(name);
    if (name === 'home') refresh();
  };
})();