// configure/streaming-settings.js
// ── Label preview — trimmed to 5 presets ─────────────────────────────────
function updateLabelPreview() {
  const preset = document.getElementById('label-preset').value;
  const previewEl = document.getElementById('label-preview');
  const previews = {
    standard: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nTrueHD 7.1\nMKV · 85.2Mbps · 58.32 GB' },
    compact:  { name: 'Server · 4K · TrueHD 7.1 · HEVC 10bit', desc: '85.2Mbps · 58.3GB' },
    detailed: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nENG TrueHD 7.1 · FRE DD+ 5.1\nSubs: EN · FR · ES\n3840x2160 · 85.2Mbps · 58.32 GB' },
    cinema:   { name: 'Server · 4K · DV · REMUX', desc: 'HEVC 10bit\nTrueHD 7.1\nSubs: EN · FR · ES\n58.32 GB' },
    minimal:  { name: 'Server · 4K', desc: '58.32 GB' },
    custom:   { name: 'Server Â· custom fields', desc: 'fields selected in Custom section below' },
  };
  const p = previews[preset] || previews.standard;
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Reflect the "Badges & extras" choices live in the preview.
  const v = id => document.getElementById(id)?.value;
  const qb = v('quality-badge'), fl = v('flag-emoji'), br = v('bitrate-bar'), ss = v('subs-style');
  let name = p.name;
  if (qb === 'emoji') name = '💎 ' + name;
  else if (qb === 'tags') name = '[REMUX][4K][HDR] ' + name;
  // For custom preset keep its own descriptive text; otherwise compose desc from the badges.
  let descSource = p.desc;
  if (preset !== 'custom' && preset !== 'compact') {
    const parts = [];
    if (fl === '') parts.push('ENG');
    else if (fl === 'flag') parts.push('🇬🇧');
    else if (fl === 'both') parts.push('🇬🇧 ENG');
    if (br === '') parts.push('85.2 Mbps');
    else if (br === 'blocks') parts.push('▰▰▰▱');
    else if (br === 'segments') parts.push('▰▰▱▱');
    if (ss === 'full') parts.push('Subs: EN · FR · ES');
    else if (ss === 'count') parts.push('Subs ×3');
    else if (ss === 'icons') parts.push('Subs 🇬🇧 🇫🇷 🇪🇸');
    parts.push('58.32 GB');
    descSource = parts.join(' · ');
  }
  const descHtml = esc(descSource).split('\n')
    .map(l => `<div style="color:var(--text-muted);font-size:0.72rem;line-height:1.55">${l}</div>`)
    .join('');
  previewEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.1rem 0">
      <div style="flex-shrink:0;width:26px;height:26px;background:var(--bg-elevated);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text-muted);margin-top:0.1rem">&#9654;</div>
      <div style="min-width:0">
        <div style="color:#d0c8ff;font-weight:600;font-size:0.8rem;line-height:1.4;margin-bottom:0.1rem">${esc(name)}</div>
        ${descHtml}
      </div>
    </div>`;
  updateMediaSourceStats();
  autoSave();
}

function toggleCustomPreset() {
  var preset = document.getElementById("label-preset").value;
  var panel = document.getElementById("custom-preset-panel");
  if (panel) panel.style.display = preset === "custom" ? "block" : "none";
}

// ── Summary preview — trimmed to 4 styles ────────────────────────────────
function toggleSummaryStyle() {
  const show = document.getElementById('show-summary').checked;
  const opts = document.getElementById('summary-options');
  if (opts) opts.style.display = show ? 'flex' : 'none';
  const pvWrap = document.getElementById('pv-summary-wrap');   // hide the preview's summary section when off
  if (pvWrap) pvWrap.style.display = show ? '' : 'none';
  if (show) updateSummaryPreview();
  autoSave();
}

// toggleCatalogOptions, refreshKeyPills — catalogs-wizard.js

const PREVIEW_SERVERS = [
  { label: 'Cloud Emby', emoji: '', type: 'emby', status: 'found', count: 5, resLabels: ['4K','1080p'], resCounts: {'4K':2,'1080p':3}, pingMs: 12 },
  { label: 'Home Jellyfin', emoji: '', type: 'jellyfin', status: 'found', count: 2, resLabels: ['1080p'], resCounts: {'1080p':2}, pingMs: 28 },
  { label: 'Backup NAS', emoji: '', type: 'emby', status: 'not_found', count: 0, resLabels: [], resCounts: {}, pingMs: null },
];

function updateSummaryPreview() {
  const el = document.getElementById('summary-preview');
  if (!el) return;
  const style = document.getElementById('summary-style')?.value || 'compact';
  const servers = PREVIEW_SERVERS;
  const found = servers.filter(s => s.status === 'found');
  const total = found.reduce((n, s) => n + s.count, 0);
  const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '...' : str;
  const eLabel = (s, maxLen) => {
    const prefix = s.emoji ? s.emoji + ' ' : '';
    return prefix + trunc(s.label, maxLen - prefix.length);
  };

  let name, lines;
  if (style === 'detailed') {
    name = `${total} streams · ${found.length} found`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} — ${s.count}${res}`; } return `- ${l} — none`; });
  } else if (style === 'minimal') {
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?` (${s.resLabels[0]})`:''; return `${l}: ${s.count}${res}`; } return `${l}: —`; });
  } else if (style === 'bar') {
    name = `Results · ${total} streams`;
    const maxC = Math.max(...found.map(s=>s.count),1);
    lines = servers.map(s => { const l = eLabel(s,10); if (s.status==='found') { const f=Math.max(1,Math.round((s.count/maxC)*4)); return `${l} ${'█'.repeat(f)}${'░'.repeat(4-f)} ${s.count}`; } return `${l} ░░░░ x`; });
  } else {
    // compact (default)
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} · ${s.count}${res}`; } return `- ${l}`; });
  }

  const linesHtml = lines.map(l =>
    `<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;white-space:pre;font-family:monospace">${escHtml(l)}</div>`
  ).join('');

  el.innerHTML = `
    <div style="font-size:0.62rem;color:var(--text-muted);letter-spacing:0.07em;text-transform:uppercase;margin-bottom:0.45rem;font-weight:600">Preview</div>
    <div style="display:flex;gap:0;align-items:stretch;background:var(--bg-base);border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)">
      <div style="flex:0 0 38%;padding:0.5rem 0.6rem;border-right:1px solid var(--border);display:flex;align-items:center">
        <div style="font-size:0.76rem;font-weight:700;color:#d0c8ff;line-height:1.4">${escHtml(name)}</div>
      </div>
      <div style="flex:1;padding:0.45rem 0.6rem;display:flex;flex-direction:column;justify-content:center">${linesHtml}</div>
    </div>`;
}

// ── Performance mode ──────────────────────────────────────────────────────
function onModeChange() {
  const mode = document.querySelector('input[name="perf-mode"]:checked').value;
  document.getElementById('timeout-row').classList.toggle('visible', mode === 'timeout');
  updateMediaSourceStats();
  updateInstallStats();
}

function onShowPingChange() {
  const enabled = document.getElementById('show-ping').checked;
  const pd = document.getElementById('ping-detail');
  const item = document.getElementById('ping-detail-item');
  if (pd) {
    pd.disabled = !enabled;
    if (!enabled) pd.checked = false;
  }
  if (item) item.style.opacity = enabled ? '1' : '0.4';
  if (window.Controls) Controls.syncAll();  // reflect ping-detail enabled/disabled on its switch tile
  autoSave();
}

// ─── Audio ranking card ──────────────────────────────────────────────────────
let AUDIO_FORMATS = [];
let AUDIO_PRESETS = [];
const AUDIO_CAT_LABEL = { object: 'Object-Based', lossless: 'Lossless', lossy: 'Lossy', other: 'Other' };

// Set a seg-backed hidden-canonical <select> programmatically.
function setSegSelect(id, v) {
  const sel = document.getElementById(id);
  if (sel) sel.value = v;
  if (window.Controls) Controls.syncAll();
}

function setAudioRankToggle(v) { setSegSelect('audio-rank', v); updateRankingUX(); }
function setSurroundPriorityToggle(v) { setSegSelect('surround-priority', v); updateRankingUX(); }

const _TIEBREAKER_LABELS = { size: 'largest file', audio: 'best legacy audio', bitrate: 'highest bitrate' };

function updateRankingUX() {
  const audioOn = document.getElementById('audio-rank')?.value === 'on';
  const sort = document.getElementById('sort-order')?.value || 'size';
  const mode = document.getElementById('audio-rank-mode')?.value || 'audioFirst';
  const surroundOn = document.getElementById('surround-priority')?.value === 'on';

  const sortLabel = document.getElementById('sort-order-label');
  const sortHint = document.getElementById('sort-order-hint');
  const sortField = document.getElementById('sort-order-field');
  const sortSeg = document.getElementById('sort-order-seg');
  const flow = document.getElementById('ranking-flow-hint');
  const modeHint = document.getElementById('audio-rank-mode-hint');
  const surroundField = document.getElementById('surround-priority-field');
  const surroundHint = document.getElementById('surround-priority-hint');
  const surroundSel = document.getElementById('surround-priority');

  if (sortLabel) sortLabel.textContent = audioOn ? 'Tiebreaker' : 'Sort by';
  if (sortSeg) {
    sortSeg.querySelectorAll('[data-val]').forEach(btn => {
      btn.classList.toggle('rec', audioOn && btn.getAttribute('data-val') === 'size');
    });
  }
  const sortClash = audioOn && sort === 'audio';
  if (sortField) sortField.classList.toggle('clash', sortClash);
  if (sortHint) {
    sortHint.textContent = audioOn
      ? (sortClash
        ? 'Sort Audio overlaps with Audio ranking below — use Size as tiebreaker instead.'
        : `Breaks ties after audio is equal — ${_TIEBREAKER_LABELS[sort] || sort}.`)
      : 'Primary sort when audio ranking is off.';
  }

  if (modeHint) {
    const modeHints = {
      audioFirst: 'Best audio format wins, then tiebreaker above.',
      resFirst: '4K beats 1080p first, then audio format, then tiebreaker.',
      tiebreak: 'Sort/tiebreaker above decides; audio only breaks exact ties.',
    };
    modeHint.textContent = audioOn ? (modeHints[mode] || modeHints.audioFirst) : 'Turn on Audio ranking to use this.';
  }

  if (surroundField && surroundSel) {
    surroundField.classList.toggle('locked', !audioOn);
    if (!audioOn && surroundOn) setSurroundPriorityToggle('off');
  }
  if (surroundHint) {
    surroundHint.textContent = audioOn
      ? (surroundOn
        ? 'On: 5.1/7.1 default track beats stereo (helps Stremio CPM on Shield/TV).'
        : 'Off: format list alone decides — fine if you never see stereo FLAC issues.')
      : 'Requires Audio ranking — picks multichannel default tracks over stereo.';
  }

  if (flow) {
    flow.classList.remove('warn');
    if (!audioOn) {
      flow.textContent = sort === 'audio'
        ? '★ Winner: best per-track audio, then largest file.'
        : `★ Winner: ${_TIEBREAKER_LABELS[sort] || sort} — audio ranking is off.`;
    } else {
      const tie = _TIEBREAKER_LABELS[sort] || sort;
      const steps = [];
      if (surroundOn) steps.push('surround channels');
      if (mode === 'resFirst') steps.push('resolution', 'audio format', tie);
      else if (mode === 'tiebreak') steps.push(tie, 'audio format');
      else steps.push('audio format', tie);
      flow.textContent = `★ Winner: ${steps.join(' → ')}.`;
      if (sortClash) {
        flow.textContent += ' Sort Audio + Audio ranking may double-sort — switch tiebreaker to Size.';
        flow.classList.add('warn');
      }
    }
  }
  if (window.Controls) Controls.syncAll();
}

function wireRankingUX() {
  ['sort-order', 'audio-rank', 'audio-rank-mode', 'surround-priority'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._rankUx) {
      el._rankUx = 1;
      el.addEventListener('change', updateRankingUX);
    }
  });
  updateRankingUX();
}

async function initAudioCard() {
  const data = window.MEB_AUDIO_FORMATS_DATA || {};
  AUDIO_FORMATS = data.formats || [];
  AUDIO_PRESETS = data.presets || [];
  renderAudioPresetChips();
  renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
}

function applyPresetStreamSettings(settings) {
  if (!settings) return;
  if (settings.surroundPriority) setSurroundPriorityToggle('on');
  if (settings.autoSelect === true) {
    const el = document.getElementById('auto-select');
    if (el) el.checked = true;
  } else if (settings.autoSelect === false) {
    const el = document.getElementById('auto-select');
    if (el) el.checked = false;
  }
  if (window.Controls) Controls.syncAll();
}

function tokenMeta(token) { return AUDIO_FORMATS.find(f => f.token === token) || null; }

function renderAudioRankList(orderTokens, disabledTokens) {
  const ol = document.getElementById('audio-rank-list');
  if (!ol) return;
  const disabled = new Set(disabledTokens || []);
  ol.innerHTML = '';
  let lastCat = null;
  (orderTokens || []).forEach(token => {
    const meta = tokenMeta(token);
    if (!meta) return;
    if (meta.cat !== lastCat) {
      const cat = document.createElement('li');
      cat.className = 'arl-cat';
      cat.textContent = AUDIO_CAT_LABEL[meta.cat] || '';
      ol.appendChild(cat);
      lastCat = meta.cat;
    }
    const li = document.createElement('li');
    li.className = 'audio-rank-row' + (disabled.has(token) ? ' disabled-fmt' : '');
    li.draggable = true;
    li.dataset.token = token;
    li.innerHTML =
      '<span class="arl-handle">⠿</span>' +
      '<span class="arl-label"></span>' +
      '<span class="arl-chans"></span>' +
      '<label style="margin-left:8px;display:inline-flex;align-items:center;gap:4px;font-size:.7rem"><input type="checkbox" class="arl-disable"> disable</label>';
    li.querySelector('.arl-label').textContent = meta.label;
    li.querySelector('.arl-chans').textContent = meta.chans;
    if (disabled.has(token)) li.querySelector('.arl-disable').checked = true;
    ol.appendChild(li);
  });
  wireAudioDrag(ol);
  ol.querySelectorAll('.arl-disable').forEach(cb => cb.addEventListener('change', e => {
    e.target.closest('.audio-rank-row').classList.toggle('disabled-fmt', e.target.checked);
  }));
}

function wireAudioDrag(ol) {
  let dragEl = null;
  ol.querySelectorAll('.audio-rank-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragEl = null; autoSave(); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      ol.insertBefore(dragEl, after ? row.nextSibling : row);
    });
    row.addEventListener('drop', e => { e.preventDefault(); autoSave(); });
  });
}

const _SOURCE_DEVICE_IDS = new Set(['shield', 'appletv', 'chromecast', 'firestick', 'browser', 'phone']);
const _PASSTHROUGH_SINK_IDS = new Set(['soundbar', 'sonos']);
const _PLAYBACK_CHAIN_IDS = new Set([..._SOURCE_DEVICE_IDS, ..._PASSTHROUGH_SINK_IDS, 'tv']);
const _EARC_FRIENDLY_ORDER = ['atmos','truehd','ddplus','dd','aac','other'];
const _SONOS_FRIENDLY_ORDER = ['atmos','truehd','ddplus','dts','dd','aac','other'];

function renderAudioPresetChips() {
  const comboWrap = document.getElementById('audio-combo-chips');
  const deviceWrap = document.getElementById('audio-preset-chips');
  if (!deviceWrap) return;
  if (comboWrap) {
    comboWrap.innerHTML = '';
    AUDIO_PRESETS.filter(p => p.kind === 'combo').forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-combo';
      chip.dataset.combo = p.id;
      chip.textContent = p.label;
      chip.title = p.note || 'One-tap playback chain';
      chip.addEventListener('click', () => applyComboPreset(p.id));
      comboWrap.appendChild(chip);
    });
  }
  deviceWrap.innerHTML = '';
  AUDIO_PRESETS.filter(p => p.supports).forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.preset = p.id;
    chip.textContent = p.label;
    if (p.note) chip.title = p.note;
    chip.addEventListener('click', () => {
      chip.classList.toggle('on');
      clearComboHighlight();
      applyAudioPresets();
    });
    deviceWrap.appendChild(chip);
  });
}

function resolveSupportedFormatsClient(deviceIds) {
  const presets = deviceIds.map(id => AUDIO_PRESETS.find(p => p.id === id)).filter(p => p && p.supports);
  if (!presets.length) return [];
  const allIds = AUDIO_FORMATS.map(f => f.id);
  if (deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id))) {
    return allIds.filter(fmt => presets.every(p => p.supports.includes(fmt)));
  }
  const sources = deviceIds.filter(id => _SOURCE_DEVICE_IDS.has(id));
  if (sources.length > 0 && deviceIds.includes('tv') && sources.length === deviceIds.length - 1) {
    const sourcePresets = sources.map(id => AUDIO_PRESETS.find(p => p.id === id)).filter(p => p && p.supports);
    const best = sourcePresets.reduce((a, b) => (a.supports.length >= b.supports.length ? a : b));
    return allIds.filter(fmt => best.supports.includes(fmt));
  }
  return allIds.filter(fmt => presets.every(p => p.supports.includes(fmt)));
}

function resolveDisableActionClient(deviceIds) {
  if (deviceIds.length <= 1) return 'hide';
  const hasPassthroughSink = deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id));
  const sourceCount = deviceIds.filter(id => _SOURCE_DEVICE_IDS.has(id)).length;
  if (hasPassthroughSink) return 'hide';
  if (deviceIds.includes('tv') && sourceCount >= 1 && deviceIds.length === sourceCount + 1) return 'hide';
  if (sourceCount > 1) return 'bottom';
  return 'hide';
}

function buildChainHintClient(deviceIds, disabledIds) {
  if (!deviceIds.length) return '';
  const labels = deviceIds.map(id => (AUDIO_PRESETS.find(p => p.id === id) || {}).label || id);
  const chain = labels.join(' → ');
  if (!disabledIds.length) return `${chain}: all formats supported`;
  const names = disabledIds.map(id => (AUDIO_FORMATS.find(f => f.id === id) || {}).label || id).join(', ');
  return `${chain}: hides ${names}`;
}

function updateAudioChainHint(deviceIds, disabledIds) {
  const el = document.getElementById('audio-chain-hint');
  if (!el) return;
  el.textContent = deviceIds.length ? buildChainHintClient(deviceIds, disabledIds) : '';
}

function clearComboHighlight() {
  document.querySelectorAll('#audio-combo-chips .chip.on').forEach(c => c.classList.remove('on'));
}

function setDevicePresetChips(deviceIds) {
  document.querySelectorAll('#audio-preset-chips .chip').forEach(c => {
    c.classList.toggle('on', deviceIds.includes(c.dataset.preset));
  });
}

function selectedPresetIds() {
  return [...document.querySelectorAll('#audio-preset-chips .chip.on')].map(c => c.dataset.preset);
}

function resolvePresetClient(selectedIds) {
  const deviceIds = [];
  for (const id of selectedIds || []) {
    const p = AUDIO_PRESETS.find(x => x.id === id);
    if (!p) continue;
    if (p.kind === 'combo' && p.combo) p.combo.forEach(d => { if (!deviceIds.includes(d)) deviceIds.push(d); });
    else if (p.supports && !deviceIds.includes(id)) deviceIds.push(id);
  }
  if (deviceIds.length === 0) return null;
  const allIds = AUDIO_FORMATS.map(f => f.id);
  const supportedAll = resolveSupportedFormatsClient(deviceIds);
  const disabledIds = allIds.filter(fmt => !supportedAll.includes(fmt));
  let orderIds = [...supportedAll, ...disabledIds];

  let surroundPriority = false;
  let autoSelect;
  let suggestedOrder = null;
  for (const id of selectedIds || []) {
    const p = AUDIO_PRESETS.find(x => x.id === id);
    if (!p?.settings) continue;
    if (p.settings.surroundPriority) surroundPriority = true;
    if (p.settings.autoSelect !== undefined) autoSelect = p.settings.autoSelect;
    if (p.settings.suggestedOrder) suggestedOrder = p.settings.suggestedOrder;
  }
  const hasSource = deviceIds.some(id => _SOURCE_DEVICE_IDS.has(id));
  const hasPassthroughSink = deviceIds.some(id => _PASSTHROUGH_SINK_IDS.has(id));
  const hasShield = deviceIds.includes('shield');
  const hasAppleTv = deviceIds.includes('appletv');
  const hasSoundbar = deviceIds.includes('soundbar');
  const hasSonos = deviceIds.includes('sonos');
  if (hasShield || hasAppleTv) surroundPriority = true;
  if (hasSource && hasSonos) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _SONOS_FRIENDLY_ORDER;
  } else if (hasSource && hasPassthroughSink) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _EARC_FRIENDLY_ORDER;
  } else if ((hasShield || hasAppleTv) && hasSoundbar) {
    surroundPriority = true;
    if (autoSelect === undefined) autoSelect = false;
    if (!suggestedOrder) suggestedOrder = _EARC_FRIENDLY_ORDER;
  }
  if (suggestedOrder) {
    const supportedSet = new Set(supportedAll);
    orderIds = [...suggestedOrder.filter(id => supportedSet.has(id)), ...disabledIds];
  }

  const toToken = id => (AUDIO_FORMATS.find(f => f.id === id) || {}).token;
  return {
    orderTokens: orderIds.map(toToken),
    disabledTokens: disabledIds.map(toToken),
    action: resolveDisableActionClient(deviceIds),
    deviceIds,
    settings: { surroundPriority, autoSelect, suggestedOrder },
  };
}

function applyComboPreset(comboId) {
  const combo = AUDIO_PRESETS.find(p => p.id === comboId);
  if (!combo || !combo.combo) return;
  document.querySelectorAll('#audio-combo-chips .chip').forEach(c => {
    c.classList.toggle('on', c.dataset.combo === comboId);
  });
  setDevicePresetChips(combo.combo);
  applyAudioPresets([comboId, ...combo.combo]);
}

// Mirror of server resolvePreset for instant UI feedback.
function applyAudioPresets(extraIds) {
  const ids = [...new Set([...(extraIds || []), ...selectedPresetIds()])];
  if (ids.length === 0) {
    renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
    updateAudioChainHint([], []);
    autoSave();
    return;
  }
  const resolved = resolvePresetClient(ids);
  if (!resolved) {
    renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []);
    updateAudioChainHint([], []);
    autoSave();
    return;
  }
  renderAudioRankList(resolved.orderTokens, resolved.disabledTokens);
  const disabledIds = AUDIO_FORMATS.filter(f => resolved.disabledTokens.includes(f.token)).map(f => f.id);
  updateAudioChainHint(resolved.deviceIds, disabledIds);
  setAudioRankToggle('on');
  const actionEl = document.getElementById('audio-disable-action');
  if (actionEl) actionEl.value = resolved.action;
  applyPresetStreamSettings(resolved.settings);
  autoSave();
}



window.updateLabelPreview = updateLabelPreview;
window.toggleCustomPreset = toggleCustomPreset;
window.toggleSummaryStyle = toggleSummaryStyle;
window.updateSummaryPreview = updateSummaryPreview;
window.onModeChange = onModeChange;
window.onShowPingChange = onShowPingChange;
window.setAudioRankToggle = setAudioRankToggle;
window.setSurroundPriorityToggle = setSurroundPriorityToggle;
window.updateRankingUX = updateRankingUX;
window.wireRankingUX = wireRankingUX;
window.initAudioCard = initAudioCard;
window.applyComboPreset = applyComboPreset;
window.applyAudioPresets = applyAudioPresets;
window.renderAudioRankList = renderAudioRankList;

function updateMediaSourceStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  set('ms-stat-mode', { normal: 'Normal', split: 'Split', timeout: 'Fast' }[mode] || mode);
  const sortVal = document.getElementById('sort-order')?.value || 'size';
  set('ms-stat-sort', { size: 'Size', audio: 'Audio', bitrate: 'Bitrate' }[sortVal] || sortVal);
  const preset = document.getElementById('label-preset')?.value || 'standard';
  set('ms-stat-label', { standard: 'Standard', compact: 'Compact', detailed: 'Detailed', cinema: 'Cinema', minimal: 'Minimal', custom: 'Custom' }[preset] || preset);
}
window.updateMediaSourceStats = updateMediaSourceStats;

function refreshMediaPreview() {
  if (typeof updateLabelPreview === 'function') updateLabelPreview();
  const sumOn = document.getElementById('show-summary')?.checked;
  const pvWrap = document.getElementById('pv-summary-wrap');
  if (pvWrap) pvWrap.style.display = sumOn ? '' : 'none';
  if (sumOn && typeof updateSummaryPreview === 'function') updateSummaryPreview();
}
window.refreshMediaPreview = refreshMediaPreview;
