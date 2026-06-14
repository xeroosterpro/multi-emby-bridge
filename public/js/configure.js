// configure.js — orchestrator (modules in configure/*.js)

function renderOnboarding() {
  const el = document.getElementById('onboard');
  if (el) el.style.display = 'none';
}

// ── Page-show hook (router calls this when a page is shown) ────────────────
window.onPageShow = function(name) {
  if (name !== 'servers') _stopServersAutoRefresh();
  if (name === 'servers') { renderServersPage(); _startServersAutoRefresh(); }
  if (name === 'streaming' || name === 'appearance') {
    if (typeof updateMediaSourceStats === 'function') updateMediaSourceStats();
    if (typeof refreshMediaPreview === 'function') refreshMediaPreview();
  }
  if (name === 'install') loadInstallPage().catch(() => updateInstallStats());
  if (name === 'dashboard') {
    const dc = document.getElementById('dash-console');
    if (dc) dc.hidden = false;
    loadDashboardPage();
    initBuildBadge();
  } else {
    window.Dashboard?.stop?.();
    stopDashLivePolling();
    stopDashHealthPolling();
    _dashActivityGen++;
    // LIVE-1: _dashConsoleIdleTimer was removed in the dashboard module split but
    // this clearTimeout reference was left behind, throwing a ReferenceError on
    // every non-dashboard page show and aborting the rest of onPageShow. Guard it.
    if (typeof _dashConsoleIdleTimer !== 'undefined') clearTimeout(_dashConsoleIdleTimer);
    const dc = document.getElementById('dash-console');
    if (dc) dc.hidden = true;
  }
  if (name === 'health' && typeof window.startHealth === 'function') window.startHealth();
  if (name === 'log' && typeof refreshLog === 'function') refreshLog();
  if (name === 'catalogs' && window.CatalogsWizard) window.CatalogsWizard.onPageShow(name);
  if (window.Controls) Controls.syncAll();
};

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('servers-container')) return;
  try {
    const auth = await getAuth();
    if (auth?.user?.username) setActiveUsername(auth.user.username);
  } catch { /* */ }
  await initAudioCard();
  if (!restoreFromLocalStorage()) addServer();
  await ensureAccountConfigLoaded();
  try {
    const ls = JSON.parse(localStorage.getItem(lsKey()) || '{}');
    if (ls.streamProfile === STREAM_PROFILE_VERSION && typeof generateLinks === 'function') {
      generateLinks({ silent: true }).catch(() => {});
    }
  } catch {}
  _updateServersEmptyState();
  if (_isServersPageActive()) {
    await renderServersPage({ full: true });
    _startServersAutoRefresh();
  }
  [updateLabelPreview, toggleCustomPreset, onShowPingChange]
    .forEach(fn => { try { fn(); } catch (_) {} });
  if (window.toggleCatalogOptions) try { window.toggleCatalogOptions(); } catch {}
  document.addEventListener('input', autoSave);
  document.addEventListener('change', autoSave);
  const qi = document.getElementById('quick-install');
  if (qi) qi.addEventListener('click', () => { location.hash = '#/install'; generateLinks(); });
  const dashRefresh = document.getElementById('dash-refresh');
  if (dashRefresh) {
    dashRefresh.addEventListener('click', () => {
      dashRefresh.disabled = true;
      const done = () => { dashRefresh.disabled = false; };
      if (window.Dashboard?.refreshStats) {
        window.DashboardConsole?.start?.('Manual refresh requested');
        window.Dashboard.refreshStats().finally(() => { window._lastDashSyncTs = Date.now(); updateDashLastSync('just now'); done(); });
      } else {
        dashConsoleStart('Manual refresh requested');
        hydrateDashLibraryStats(true).finally(() => { window._lastDashSyncTs = Date.now(); updateDashLastSync('just now'); done(); });
      }
    });
  }

  if (typeof initBuildBadge === 'function') {
    try { initBuildBadge(); } catch {}
  }

  if (window.Controls) Controls.bindAll();
  wireRankingUX();
  window.getAuth = getAuth;
  window.ensureAccountConfigLoaded = ensureAccountConfigLoaded;
  window.renderDashActivityShell = renderDashActivityShell;
  window.renderOnboarding = renderOnboarding;
  window.replayDashTileAnimations = replayDashTileAnimations;
});


// ── Modules loaded via configure.html ──