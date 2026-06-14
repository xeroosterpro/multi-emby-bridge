/**
 * One-time splitter: extracts configure.js modules into public/js/configure/
 * Run: node scripts/split-configure.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'js', 'configure.js');
const OUT_DIR = path.join(ROOT, 'public', 'js', 'configure');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

function wrapIife(name, body, preamble = '') {
  return `/* ${name} — extracted from configure.js */\n(function () {\n'use strict';\n${preamble}\n${body}\n})();\n`;
}

// 1-indexed inclusive ranges from original configure.js
const RANGES = {
  state: [1, 47],
  dashboard: [48, 2337],
  requestLog: [2397, 2698],
  install: [5124, 5436],
};

function sliceRange([start, end]) {
  return lines.slice(start - 1, end);
}

// Remove duplicate wireDashServerFilters (first block, ~lines 604-661)
function cleanDashboard(slice) {
  const out = [];
  let i = 0;
  while (i < slice.length) {
    const line = slice[i];
    if (line.includes('/* ===== Beefed dashboard filters') && slice[i + 1]?.includes('let _dashFilterTimer')) {
      // skip until end of first wireDashServerFilters (closing brace before _paintPingsForCard)
      while (i < slice.length && !slice[i].includes('function _paintPingsForCard')) i++;
      continue;
    }
    out.push(slice[i]);
    i++;
  }
  return out;
}

const stateBody = sliceRange(RANGES.state).join('\n');
const dashBody = cleanDashboard(sliceRange(RANGES.dashboard)).join('\n');
const logBody = sliceRange(RANGES.requestLog).join('\n');
const installBody = sliceRange(RANGES.install).join('\n');

const statePreamble = `
  window.MEBConfigure = window.MEBConfigure || {};
  const MEB = window.MEBConfigure;
`;

const dashPreamble = `
  // Dashboard legacy UI — expects globals from configure.js + state module
`;

const logPreamble = `
  // Request log page — uses escHtml, collectConfig from configure.js
`;

const installPreamble = `
  // Install page + generateLinks — uses collectConfig, lsLastKey, etc.
`;

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(path.join(OUT_DIR, 'state.js'), wrapIife('configure/state', stateBody, statePreamble));
fs.writeFileSync(path.join(OUT_DIR, 'dashboard-legacy.js'), wrapIife('configure/dashboard-legacy', dashBody, dashPreamble));
fs.writeFileSync(path.join(OUT_DIR, 'request-log.js'), wrapIife('configure/request-log', logBody, logPreamble));
fs.writeFileSync(path.join(OUT_DIR, 'install.js'), wrapIife('configure/install', installBody, installPreamble));

// Build slim configure.js: remove extracted ranges (from bottom to top)
const remove = [...Object.values(RANGES)].sort((a, b) => b[0] - a[0]);
let remaining = [...lines];
for (const [start, end] of remove) {
  remaining.splice(start - 1, end - start + 1);
}

const header = `// configure.js — orchestrator (modules in configure/*.js)\n`;
const footer = `\n// ── Modules loaded via configure.html before this file ──\n`;
fs.writeFileSync(SRC, header + remaining.join('\n') + footer);

console.log('Split complete:');
console.log('  state.js:', RANGES.state[1] - RANGES.state[0] + 1, 'lines');
console.log('  dashboard-legacy.js:', RANGES.dashboard[1] - RANGES.dashboard[0] + 1, 'lines (deduped)');
console.log('  request-log.js:', RANGES.requestLog[1] - RANGES.requestLog[0] + 1, 'lines');
console.log('  install.js:', RANGES.install[1] - RANGES.install[0] + 1, 'lines');
console.log('  configure.js:', remaining.length, 'lines remaining');