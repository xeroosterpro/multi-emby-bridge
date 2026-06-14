/**
 * One-shot: split dashboard-page.js into bundle + render modules (already applied in repo).
 * node scripts/split-dashboard-page.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'js', 'configure', 'dashboard-page.js');
const OUT = path.join(__dirname, '..', 'public', 'js', 'configure');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);

const pageBody = lines.slice(0, 65).join('\n').trim() + '\n';

const bundleBody = [
  '// configure/dashboard-bundle.js — merge/patch/apply dashboard API bundles',
  lines.slice(66, 361).join('\n').trim(),
  '',
  'window.applyDashboardBundle = applyDashboardBundle;',
].join('\n') + '\n';

const renderBody = [
  '// configure/dashboard-render.js — legacy full dashboard render (non-Dashboard.load path)',
  lines.slice(363, 579).join('\n').trim(),
  '',
  'window.renderDashboard = renderDashboard;',
].join('\n') + '\n';

fs.writeFileSync(path.join(OUT, 'dashboard-page.js'), pageBody);
fs.writeFileSync(path.join(OUT, 'dashboard-bundle.js'), bundleBody);
fs.writeFileSync(path.join(OUT, 'dashboard-render.js'), renderBody);

console.log('Split dashboard-page.js:');
console.log('  dashboard-page.js:', pageBody.split('\n').length, 'lines');
console.log('  dashboard-bundle.js:', bundleBody.split('\n').length, 'lines');
console.log('  dashboard-render.js:', renderBody.split('\n').length, 'lines');