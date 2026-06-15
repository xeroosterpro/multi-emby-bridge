// configure/form-state.js — localStorage collect/restore + debounced auto-save

let saveTimer = null;

function collectFormState() {
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const state = {
    streamProfile: STREAM_PROFILE_VERSION,
    mode,
    timeoutValue: document.getElementById('timeout-value')?.value,
    sortOrder: document.getElementById('sort-order')?.value,
    excludeRes: [...document.querySelectorAll('.res-cb:checked')].map(cb => cb.value),
    recommend: document.getElementById('show-recommend')?.checked,
    showPing: document.getElementById('show-ping')?.checked,
    pingDetail: document.getElementById('ping-detail')?.checked,
    audioLang: document.getElementById('audio-lang')?.value,
    prefCodec: document.getElementById('pref-codec')?.value,
    codecMode: document.getElementById('codec-mode')?.value,
    audioRank: document.getElementById('audio-rank')?.value === 'on',
    audioOrder: [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token),
    audioDisabled: [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')].map(cb => cb.closest('.audio-rank-row').dataset.token),
    audioRankMode: document.getElementById('audio-rank-mode')?.value,
    audioDisableAction: document.getElementById('audio-disable-action')?.value,
    surroundPriority: document.getElementById('surround-priority')?.value === 'on',
    audioPresets: [...document.querySelectorAll('#audio-preset-chips .chip.on')].map(c => c.dataset.preset),
    maxBitrate: document.getElementById('max-bitrate')?.value,
    autoSelect: document.getElementById('auto-select')?.checked,
    labelPreset: document.getElementById('label-preset')?.value,
    pingOrigin: document.getElementById('ping-origin')?.value,
    showSummary: document.getElementById('show-summary')?.checked,
    summaryStyle: document.getElementById('summary-style')?.value,
    qualityBadge: document.getElementById('quality-badge')?.value || '',
    flagEmoji: document.getElementById('flag-emoji')?.value || '',
    bitrateBar: document.getElementById('bitrate-bar')?.value || '',
    subsStyle: document.getElementById('subs-style')?.value || 'full',
    showCatalog: document.getElementById('show-catalog')?.checked ?? true,
    catalogContent: document.getElementById('catalog-content')?.value || 'recent',
    libraryRows: ['recent','resume','nextup','favorites'].filter(function(k){
      var el = document.getElementById('libchk-' + k); return el && el.checked;
    }),
    rpdbKey: document.getElementById('rpdb-key')?.value.trim() || '',
    traktClientId:    document.getElementById('trakt-client-id')?.value.trim() || '',
    mdblistApiKey:    document.getElementById('mdblist-api-key')?.value.trim() || '',
    tmdbApiKey:       document.getElementById('tmdb-api-key')?.value.trim() || '',
    externalCatalogs: window.collectExternalCatalogs ? window.collectExternalCatalogs() : [],
    catalogLang: document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "",
    noDupes: document.getElementById("no-dupes")?.checked ?? false,
    failoverHideDown: document.getElementById('failover-hide-down')?.checked ?? false,
    customNameFields: Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;}),
    customDescFields: Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;}),
    servers: [],
  };
  document.querySelectorAll('.server-block').forEach(block => {
    state.servers.push({
      label: block.querySelector('.f-label')?.value || '',
      type: block.querySelector('.f-type')?.value || 'emby',
      url: block.querySelector('.f-url')?.value || '',
      apiKey: block.querySelector('.f-apikey')?.value || '',
      userId: block.querySelector('.f-userid')?.value || '',
      username: block.querySelector('.f-username')?.value || '',
      password: block.querySelector('.f-password')?.value || '',
      thumbnail: block.querySelector('.f-thumbnail')?.value || '',
      emoji: block.querySelector('.f-emoji')?.value || '',
      enabled: block.querySelector('.f-enabled')?.checked ?? true,
      collapsed: block.classList.contains('collapsed'),
      cost: block.querySelector('.f-cost')?.value !== '' ? Number(block.querySelector('.f-cost')?.value) : undefined,
      costPeriod: block.querySelector('.f-cost-period')?.value || 'none',
      priority: parseInt(block.querySelector('.f-priority')?.value || '5', 10),
    });
  });
  return state;
}

function saveToLocalStorage() {
  try {
    const newState = collectFormState();
    const existing = JSON.parse(localStorage.getItem(lsKey()) || '{}');
    if (!newState.traktClientId && existing.traktClientId) newState.traktClientId = existing.traktClientId;
    if (!newState.mdblistApiKey && existing.mdblistApiKey) newState.mdblistApiKey = existing.mdblistApiKey;
    if (!newState.tmdbApiKey && existing.tmdbApiKey) newState.tmdbApiKey = existing.tmdbApiKey;
    if (!newState.streamProfile && existing.streamProfile) newState.streamProfile = existing.streamProfile;
    localStorage.setItem(lsKey(), JSON.stringify(newState));
  } catch {}
  const ind = document.getElementById('autosave-indicator');
  if (ind) {
    ind.textContent = '✓ Settings saved';
    ind.classList.add('visible');
    clearTimeout(ind._t);
    ind._t = setTimeout(() => { ind.classList.remove('visible'); ind.textContent = ''; }, 1800);
  }
}

const _AUTOSAVE_IGNORE = '#rlog-search,.rlog-search,#tkt-search,.tkt-search,#adm-search,#bill-code,#cmdk-input,.cmdk-input,[data-no-autosave]';
function autoSave(e) {
  if (e && e.target && e.target.closest && e.target.closest(_AUTOSAVE_IGNORE)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToLocalStorage();
    scheduleAccountConfigSync();
    if (typeof updateInstallStats === 'function') updateInstallStats();
  }, 600);
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return false;
    const state = JSON.parse(raw);
    const profileUpgraded = upgradeStreamProfileState(state);
    try {
      const lastRaw = localStorage.getItem(lsLastKey());
      if (lastRaw) {
        const last = JSON.parse(atob(lastRaw.replace(/-/g,'+').replace(/_/g,'/')));
        if (!state.traktClientId && last.traktClientId) state.traktClientId = last.traktClientId;
        if (!state.mdblistApiKey && last.mdblistApiKey) state.mdblistApiKey = last.mdblistApiKey;
        if (!state.tmdbApiKey && last.tmdbApiKey) state.tmdbApiKey = last.tmdbApiKey;
        if ((!state.externalCatalogs || !state.externalCatalogs.length) && last.externalCatalogs && last.externalCatalogs.length)
          state.externalCatalogs = last.externalCatalogs;
      }
    } catch(e) {}

    if (state.servers && state.servers.length > 0) {
      document.getElementById('servers-container').innerHTML = '';
      nextId = 0;
      state.servers.forEach(s => {
        const id = nextId;
        addServer(s, { skipRefresh: true });
        const block = document.getElementById(`server-${id}`);
        if (!block) return;
        if (s.enabled === false) {
          block.querySelector('.f-enabled').checked = false;
          block.classList.add('disabled');
        }
        if (s.collapsed) {
          block.classList.add('collapsed');
          block.querySelector('.btn-collapse').textContent = '\u25B6';
          updateSummary(id);
        }
      });
      if (_isServersPageActive()) renderServersPage({ force: true });
    }

    if (state.mode) {
      const radio = document.querySelector(`input[name="perf-mode"][value="${state.mode}"]`);
      if (radio) { radio.checked = true; onModeChange(); }
    }

    const restored = { ...STREMIO_STREAM_DEFAULTS, ...state };
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = v; };
    setVal('timeout-value', restored.timeoutValue);
    setVal('sort-order', restored.sortOrder);
    setVal('audio-lang', restored.audioLang);
    setVal('pref-codec', restored.prefCodec);
    setVal('codec-mode', restored.codecMode);
    setAudioRankToggle(restored.audioRank ? 'on' : 'off');
    setVal('audio-rank-mode', restored.audioRankMode || 'audioFirst');
    setVal('audio-disable-action', restored.audioDisableAction || 'hide');
    setSurroundPriorityToggle(restored.surroundPriority ? 'on' : 'off');
    const _audioOrder = (restored.audioOrder && restored.audioOrder.length) ? restored.audioOrder : AUDIO_FORMATS.map(f => f.token);
    renderAudioRankList(_audioOrder, restored.audioDisabled || []);
    (restored.audioPresets || []).forEach(id => {
      const chip = document.querySelector('#audio-preset-chips .chip[data-preset="' + id + '"]');
      if (chip) chip.classList.add('on');
    });
    setVal('max-bitrate', restored.maxBitrate);
    setVal('label-preset', restored.labelPreset || 'compact');
    setVal('ping-origin', restored.pingOrigin);
    setChk('show-recommend', restored.recommend);
    setChk('failover-hide-down', restored.failoverHideDown);
    setChk('show-ping', restored.showPing);
    setChk('ping-detail', restored.pingDetail);
    setChk('auto-select', restored.autoSelect);
    setChk('show-summary', restored.showSummary);
    setVal('summary-style', restored.summaryStyle || 'compact');
    if (restored.showSummary) {
      const opts = document.getElementById('summary-options');
      if (opts) opts.style.display = 'flex';
      updateSummaryPreview();
    }
    setVal('quality-badge', state.qualityBadge);
    setVal('flag-emoji', state.flagEmoji);
    setVal('bitrate-bar', state.bitrateBar);
    setVal('subs-style', state.subsStyle);
    if (state.showCatalog === false) {
      setChk('show-catalog', false);
      if (window.toggleCatalogOptions) window.toggleCatalogOptions();
    }
    setVal('catalog-content', state.catalogContent);
    var savedRows = Array.isArray(state.libraryRows) ? state.libraryRows
                   : (state.catalogContent ? [state.catalogContent] : ['recent']);
    ['recent','resume','nextup','favorites'].forEach(function(k){
      var el = document.getElementById('libchk-' + k); if (el) el.checked = savedRows.indexOf(k) !== -1;
    });
    if (window.CatalogsWizard && window.CatalogsWizard.syncLibChips) window.CatalogsWizard.syncLibChips();
    if (window.Controls) Controls.syncAll();
    setVal('rpdb-key', state.rpdbKey);
    if (state.traktClientId) setVal('trakt-client-id', state.traktClientId);
    if (state.mdblistApiKey) setVal('mdblist-api-key', state.mdblistApiKey);
    if (state.tmdbApiKey) setVal('tmdb-api-key', state.tmdbApiKey);
    if (window.refreshKeyPills) window.refreshKeyPills();
    if (Array.isArray(state.externalCatalogs) && state.externalCatalogs.length) {
      const catList = document.getElementById('catalog-list');
      if (catList && window.addExternalCatalog) { catList.innerHTML = ''; window.nextCatId = 0; state.externalCatalogs.forEach(function(cat){ window.addExternalCatalog(cat, { autoTest: false }); }); }
    }

    if (state.catalogLang) setVal("catalog-lang", state.catalogLang);
    if (state.noDupes) { const cb = document.getElementById("no-dupes"); if (cb) cb.checked = true; }
    if (Array.isArray(state.customNameFields) && state.customNameFields.length) {
      document.querySelectorAll(".cn-field").forEach(function(cb){ cb.checked = state.customNameFields.indexOf(cb.value) >= 0; });
    }
    if (Array.isArray(state.customDescFields) && state.customDescFields.length) {
      document.querySelectorAll(".cd-field").forEach(function(cb){ cb.checked = state.customDescFields.indexOf(cb.value) >= 0; });
    }
    toggleCustomPreset();
    if (Array.isArray(state.excludeRes)) _applyExcludeRes(state.excludeRes);

    if (window.Controls) Controls.syncAll();
    updateRankingUX();
    if (profileUpgraded) {
      try { localStorage.setItem(lsKey(), JSON.stringify(state)); } catch {}
    }
    return true;
  } catch { return false; }
}

window.collectFormState = collectFormState;
window.saveToLocalStorage = saveToLocalStorage;
window.autoSave = autoSave;
window.restoreFromLocalStorage = restoreFromLocalStorage;