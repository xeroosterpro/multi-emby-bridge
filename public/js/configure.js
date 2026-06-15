// configure.js — orchestrator (minimal: servers, media sources, install)

window.onPageShow = function(name) {
  if (name === 'servers') renderServersPage();
  if (name === 'streaming' || name === 'appearance') {
    if (typeof updateMediaSourceStats === 'function') updateMediaSourceStats();
    if (typeof refreshMediaPreview === 'function') refreshMediaPreview();
  }
  if (name === 'install') loadInstallPage().catch(() => updateInstallStats());
  if (window.Controls) Controls.syncAll();
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.getElementById('servers-container')) return;
  try {
    const auth = await getAuth();
    if (auth?.user?.username) setActiveUsername(auth.user.username);
  } catch { /* */ }
  await initAudioCard();
  if (!restoreFromLocalStorage()) addServer();
  await ensureAccountConfigLoaded();
  _updateServersEmptyState();
  if (_isServersPageActive()) {
    await renderServersPage({ full: true });
  }
  [updateLabelPreview, toggleCustomPreset, onShowPingChange]
    .forEach(fn => { try { fn(); } catch (_) {} });
  document.addEventListener('input', autoSave);
  document.addEventListener('change', autoSave);
  if (window.Controls) Controls.bindAll();
  wireRankingUX();
  window.getAuth = getAuth;
  window.ensureAccountConfigLoaded = ensureAccountConfigLoaded;
});