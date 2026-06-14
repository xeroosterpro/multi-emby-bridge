/**
 * One-shot rebuild: split monolithic configure.js into modules + orchestrator.
 * Run once after restoring public/js/configure.js from git.
 *   node scripts/rebuild-configure-split.js
 * Then peel dashboard-legacy into five modules:
 *   node scripts/split-dashboard-legacy.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'js', 'configure.js');
const OUT_DIR = path.join(ROOT, 'public', 'js', 'configure');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function cleanDashboard(body) {
  const sliceLines = body.split('\n');
  const out = [];
  let i = 0;
  while (i < sliceLines.length) {
    if (sliceLines[i].includes('/* ===== Beefed dashboard filters') && sliceLines[i + 1]?.includes('let _dashFilterTimer')) {
      while (i < sliceLines.length && !sliceLines[i].includes('function _paintPingsForCard')) i++;
      continue;
    }
    out.push(sliceLines[i]);
    i++;
  }
  return out.join('\n');
}

const logos = `const EMBY_LOGO = '<img class="brandimg" src="/img/emby.png" alt="Emby" decoding="async">';
const JELLYFIN_LOGO = '<img class="brandimg" src="/img/jellyfin.png" alt="Jellyfin" decoding="async">';`;

const stateBody = slice(1, 47);
const dashLegacyBody = cleanDashboard(slice(48, 2332));
const requestLogBody = slice(2392, 2708);
const serversBody = [slice(2710, 2736), slice(2743, 3240), slice(4248, 4354)].join('\n\n');
const dashboardPageBody = [slice(3312, 3329), slice(3360, 4246)].join('\n\n');
const streamingBody = slice(4608, 5118);
const installBody = slice(5119, 5432);

const stateJs = `// configure/state.js\n${stateBody}\n\n${logos}\n\n` + `
window.getActiveUsername = getActiveUsername;
window.lsKey = lsKey;
window.lsLastKey = lsLastKey;
window.setActiveUsername = setActiveUsername;
window.purgeLegacyGlobalConfig = purgeLegacyGlobalConfig;
window.hasCompleteServers = hasCompleteServers;
Object.defineProperty(window, 'nextId', { get() { return nextId; }, set(v) { nextId = v; } });
`;

const requestLogJs = `// configure/request-log.js\n${requestLogBody}\n\n` + `
window.refreshLog = refreshLog;
window.clearLog = clearLog;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(logInterval);
    logInterval = null;
    if (typeof _stopServersAutoRefresh === 'function') _stopServersAutoRefresh();
  } else {
    refreshLog();
    logInterval = setInterval(refreshLog, 30000);
    if (typeof _isServersPageActive === 'function' && _isServersPageActive()) {
      if (typeof renderServersPage === 'function') renderServersPage({ failedOnly: true });
      if (typeof _startServersAutoRefresh === 'function') _startServersAutoRefresh();
    }
  }
});
`;

const streamingJs = `// configure/streaming-settings.js\n${streamingBody}\n\n` + `
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
`;

const installJs = `// configure/install.js\n${installBody}\n\n` + `
window.generateLinks = generateLinks;
window.copySpecific = copySpecific;
window.runPingTest = runPingTest;
`;

const dashboardPageJs = `// configure/dashboard-page.js\n${dashboardPageBody}\n\nwindow.applyDashboardBundle = applyDashboardBundle;\n`;
const serversJs = `// configure/servers-page.js (logos in state.js)\n\n${serversBody}\n`;
const dashLegacyJs = `// configure/dashboard-legacy.js\n${dashLegacyBody}\n\nwindow.MEB_getAuth = getAuth;\n`;

// Orchestrator: keep non-extracted sections
const orchestratorParts = [
  '// configure.js — orchestrator (modules in configure/*.js)',
  slice(2333, 2391),
  slice(2737, 2742),
  slice(3242, 3310),
  slice(3331, 3358),
  slice(4355, 4607),
  slice(5433, lines.length),
  '// ── Modules loaded via configure.html ──',
];

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'state.js'), stateJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'dashboard-legacy.js'), dashLegacyJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'servers-page.js'), serversJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'dashboard-page.js'), dashboardPageJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'streaming-settings.js'), streamingJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'request-log.js'), requestLogJs.trim() + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'install.js'), installJs.trim() + '\n');
fs.writeFileSync(SRC, orchestratorParts.join('\n\n') + '\n');

console.log('Rebuild complete:');
console.log('  state.js');
console.log('  dashboard-legacy.js');
console.log('  servers-page.js');
console.log('  dashboard-page.js');
console.log('  streaming-settings.js');
console.log('  request-log.js');
console.log('  install.js');
console.log('  configure.js:', orchestratorParts.join('\n\n').split('\n').length, 'lines (approx)');
console.log('Next: node scripts/split-dashboard-legacy.js');