const fs = require('fs');
const path = require('path');

function makeRequestLogMemory({ dataDir, dbLib, requestLogDb }) {
  const REQUEST_LOG_FILE = path.join(dataDir, 'request-log.json');
  const MAX_LOG = 500;
  let REQUEST_LOG = [];

  function loadRequestLog() {
    try {
      if (fs.existsSync(REQUEST_LOG_FILE)) {
        REQUEST_LOG = JSON.parse(fs.readFileSync(REQUEST_LOG_FILE, 'utf8'));
        if (REQUEST_LOG.length > MAX_LOG) REQUEST_LOG = REQUEST_LOG.slice(0, MAX_LOG);
      }
    } catch { REQUEST_LOG = []; }
  }

  function saveRequestLog() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(REQUEST_LOG_FILE, JSON.stringify(REQUEST_LOG, null, 2), 'utf8');
    } catch { /* non-critical */ }
  }

  function addLogEntry(entry) {
    REQUEST_LOG.unshift(entry);
    if (REQUEST_LOG.length > MAX_LOG) REQUEST_LOG.pop();
    saveRequestLog();
    if (dbLib.isConfigured()) {
      requestLogDb.record({
        userId: entry.userId || null, ts: entry.ts, type: entry.type, imdbId: entry.imdbId,
        contentName: entry.contentName, bestServer: entry.bestServer, serverStatus: entry.serverStatus,
        season: entry.season, episode: entry.episode, ms: entry.ms, found: entry.found,
      }).catch((e) => { console.warn('[request-log] DB record failed:', e.message); });
    }
  }

  function getRequestLog() {
    return REQUEST_LOG;
  }

  loadRequestLog();

  return { addLogEntry, getRequestLog, saveRequestLog };
}

module.exports = { makeRequestLogMemory };