const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'js', 'configure');

function unwrap(file) {
  const p = path.join(OUT_DIR, file);
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
  // Strip only the IIFE wrapper — do not eat module body (state.js starts with a // comment).
  s = s.replace(/^\(function \(\) \{\s*\n'use strict';\s*\n/, '');
  s = s.replace(/\n\}\)\(\);\s*$/, '\n');
  fs.writeFileSync(p, s.trim() + '\n');
}

['state.js', 'request-log.js', 'install.js'].forEach(unwrap);

// request-log: expose globals + visibility handler
const logPath = path.join(OUT_DIR, 'request-log.js');
let log = fs.readFileSync(logPath, 'utf8');
if (!log.includes('window.refreshLog')) {
  log += `
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
  fs.writeFileSync(logPath, log);
}

// state: expose key helpers on window for cross-script access
const statePath = path.join(OUT_DIR, 'state.js');
let state = fs.readFileSync(statePath, 'utf8');
if (!state.includes('window.lsKey')) {
  state += `
window.getActiveUsername = getActiveUsername;
window.lsKey = lsKey;
window.lsLastKey = lsLastKey;
window.setActiveUsername = setActiveUsername;
window.purgeLegacyGlobalConfig = purgeLegacyGlobalConfig;
window.hasCompleteServers = hasCompleteServers;
Object.defineProperty(window, 'nextId', { get() { return nextId; }, set(v) { nextId = v; } });
`;
  fs.writeFileSync(statePath, state);
}

// configure.js: remove duplicate visibility handler
const cfgPath = path.join(__dirname, '..', 'public', 'js', 'configure.js');
let cfg = fs.readFileSync(cfgPath, 'utf8');
cfg = cfg.replace(/\n\ndocument\.addEventListener\('visibilitychange'[\s\S]*?\}\);\n\n\/\/ ── Auto-generate server name/, '\n\n// ── Auto-generate server name');
fs.writeFileSync(cfgPath, cfg);

console.log('Unwrapped configure modules and fixed exports');