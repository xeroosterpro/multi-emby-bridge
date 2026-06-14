/**
 * Phase 3: extract streaming/appearance settings from configure.js
 * Run: node scripts/split-configure-phase3.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'js', 'configure.js');
const OUT = path.join(ROOT, 'public', 'js', 'configure', 'streaming-settings.js');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

// 1-indexed inclusive: label preview → audio presets (before auto-save)
// Guard: skip if already split
if (fs.readFileSync(SRC, 'utf8').includes('// ── Modules loaded via configure.html')) {
  console.log('configure.js already split — skipping phase 3');
  process.exit(0);
}

const labelIdx = lines.findIndex(l => l.includes('// ── Label preview'));
const autoSaveIdx = lines.findIndex(l => l.includes('// ── Auto-save'));
if (labelIdx < 0 || autoSaveIdx < 0) {
  console.error('Could not find label preview or auto-save markers');
  process.exit(1);
}
const START = labelIdx + 1;
const END = autoSaveIdx; // exclusive: line before auto-save section
const body = lines.slice(START - 1, END - 1).join('\n');

const windowExports = `
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

fs.writeFileSync(
  OUT,
  `// configure/streaming-settings.js — streaming, appearance, audio ranking UI\n\n${body}\n\n${windowExports}`
);

const remaining = [
  ...lines.slice(0, START - 1),
  ...lines.slice(END - 1),
];
const header = remaining[0].startsWith('//') ? remaining[0] + '\n' : '// configure.js — orchestrator\n';
fs.writeFileSync(SRC, header + remaining.slice(1).join('\n') + '\n// ── Modules loaded via configure.html ──\n');

console.log('Phase 3 split:');
console.log('  streaming-settings.js:', END - START + 1, 'lines');
console.log('  configure.js:', remaining.length, 'lines remaining');