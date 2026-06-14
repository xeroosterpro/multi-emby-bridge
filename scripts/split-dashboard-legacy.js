/**
 * Split dashboard-legacy.js into focused modules (one-shot; already applied in repo).
 * After rebuild-configure-split.js from monolith: node scripts/split-dashboard-legacy.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'js', 'configure', 'dashboard-legacy.js');
if (!fs.existsSync(SRC)) {
  console.log('dashboard-legacy.js not found — split already applied or not needed.');
  process.exit(0);
}
const OUT = path.join(__dirname, '..', 'public', 'js', 'configure');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function write(name, header, body) {
  fs.writeFileSync(path.join(OUT, name), `${header}\n${body.trim()}\n`);
}

const shared = [
  slice(3, 15),
  slice(125, 280),
].join('\n\n');
write('dashboard-shared.js', '// configure/dashboard-shared.js — console, ping dots, dash header helpers', shared);

const library = [
  slice(17, 123),
  slice(1652, lines.length),
].join('\n\n');
write('dashboard-library.js', '// configure/dashboard-library.js — library stats batch + hydration', library + '\n\nwindow.hydrateDashLibraryStats = hydrateDashLibraryStats;');

const health = [
  slice(282, 826),
  slice(1636, 1650),
].join('\n\n');
write('dashboard-health.js', '// configure/dashboard-health.js — health pings, card status, filters', health);

const live = [
  slice(828, 1371),
  slice(1566, 1634),
].join('\n\n');
write('dashboard-live.js', '// configure/dashboard-live.js — live sessions, dock, polling', live + '\n\nwindow.fetchLiveBundle = fetchLiveBundle;');

const cards = slice(1373, 1564);
write('dashboard-cards.js', '// configure/dashboard-cards.js — gcard builder, skeleton, activity shell', cards + '\n\nwindow.paintDashboardSkeleton = paintDashboardSkeleton;');

// Remove dashboard-legacy.js
fs.unlinkSync(SRC);
console.log('Split complete:');
console.log('  dashboard-shared.js');
console.log('  dashboard-health.js');
console.log('  dashboard-library.js');
console.log('  dashboard-cards.js');
console.log('  dashboard-live.js');
console.log('  removed dashboard-legacy.js');