/**
 * Phase 2: extract servers-page.js + dashboard-page.js from configure.js
 * Run: node scripts/split-configure-phase2.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'js', 'configure.js');
const OUT_DIR = path.join(ROOT, 'public', 'js', 'configure');
const STATE = path.join(OUT_DIR, 'state.js');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

function sliceInclusive(start, end) {
  return lines.slice(start - 1, end);
}

function removeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
  let out = [...lines];
  for (const [start, end] of sorted) {
    out.splice(start - 1, end - start + 1);
  }
  return out;
}

// 1-indexed inclusive line ranges in current configure.js
const SERVERS = [
  [62, 88],    // autoNameServer
  [95, 592],   // server blocks + servers page
  [1600, 1705], // collapse / add / remove
];

const DASHBOARD_PAGE = [
  [664, 681],   // loadDashboardPage
  [712, 1038],  // dash activity + replay animations
  [1040, 1070], // dashboard polling intervals
  [1075, 1084], // openServerManage
  [1086, 1598], // bundle merge/apply + renderDashboard
];

function joinRanges(ranges) {
  return ranges.map(([s, e]) => sliceInclusive(s, e).join('\n')).join('\n\n');
}

const serversBody = joinRanges(SERVERS);
const dashBody = joinRanges(DASHBOARD_PAGE);

fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(
  path.join(OUT_DIR, 'servers-page.js'),
  `// configure/servers-page.js — server cards + servers page (logos in state.js)\n\n${serversBody}\n`
);

fs.writeFileSync(
  path.join(OUT_DIR, 'dashboard-page.js'),
  `// configure/dashboard-page.js — legacy dashboard page rendering\n${dashBody}\n\nwindow.applyDashboardBundle = applyDashboardBundle;\n`
);

const allRemoved = [...SERVERS, ...DASHBOARD_PAGE, [1072, 1073]];
const remaining = removeRanges(allRemoved);
const header = lines[0].startsWith('//') ? lines[0] + '\n' : '// configure.js — orchestrator\n';
const footer = '\n// ── Modules loaded via configure.html ──\n';

fs.writeFileSync(SRC, header + remaining.slice(1).join('\n') + footer);

console.log('Phase 2 split:');
console.log('  servers-page.js:', SERVERS.reduce((n, [a, b]) => n + b - a + 1, 0) + 2, 'lines (approx)');
console.log('  dashboard-page.js:', DASHBOARD_PAGE.reduce((n, [a, b]) => n + b - a + 1, 0) + 3, 'lines (approx)');
console.log('  configure.js:', remaining.length, 'lines remaining');