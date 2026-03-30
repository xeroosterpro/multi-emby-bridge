// ─── Health monitoring ────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const HEALTH_FILE = path.join(DATA_DIR, 'health-history.json');
const HEALTH_SERVERS_FILE = path.join(DATA_DIR, 'health-servers.json');
const MAX_HEALTH_ENTRIES = 2016;
const HEALTH_INTERVAL_MS = 5 * 60 * 1000;

let healthServers = [];
let healthHistory = {};

function loadHealthData() {
  try {
    if (fs.existsSync(HEALTH_SERVERS_FILE))
      healthServers = JSON.parse(fs.readFileSync(HEALTH_SERVERS_FILE, 'utf8'));
    if (fs.existsSync(HEALTH_FILE))
      healthHistory = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  } catch { /* start fresh */ }
}

function saveHealthData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HEALTH_SERVERS_FILE, JSON.stringify(healthServers, null, 2), 'utf8');
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthHistory), 'utf8');
  } catch { /* non-critical */ }
}

function registerHealthServers(servers) {
  let changed = false;
  for (const s of servers) {
    if (!s.url) continue;
    const url = s.url.replace(/\/+$/, '');
    if (!healthServers.find(h => h.url === url)) {
      healthServers.push({ url, label: s.label || url, type: s.type || 'emby' });
      changed = true;
    } else {
      const existing = healthServers.find(h => h.url === url);
      if (existing.label !== s.label || existing.type !== s.type) {
        existing.label = s.label || url;
        existing.type  = s.type || 'emby';
        changed = true;
      }
    }
  }
  if (changed) saveHealthData();
}

function unregisterHealthServer(serverUrl) {
  const url = serverUrl.replace(/\/+$/, '');
  const idx = healthServers.findIndex(h => h.url === url);
  if (idx === -1) return false;
  healthServers.splice(idx, 1);
  delete healthHistory[url];
  saveHealthData();
  return true;
}

function cleanupStaleServers(activeUrls) {
  const activeSet = new Set(activeUrls.map(u => u.replace(/\/+$/, '')));
  const before = healthServers.length;
  healthServers = healthServers.filter(h => activeSet.has(h.url));
  // Clean up history for removed servers
  for (const url of Object.keys(healthHistory)) {
    if (!activeSet.has(url)) delete healthHistory[url];
  }
  if (healthServers.length !== before) saveHealthData();
  return before - healthServers.length;
}

async function pingHealthServers() {
  if (healthServers.length === 0) return;
  await Promise.all(healthServers.map(async (server) => {
    const t0 = Date.now();
    let up = false, ms = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        await fetch(`${server.url}/System/Ping`, { signal: controller.signal });
        up = true;
        ms = Date.now() - t0;
      } finally { clearTimeout(timer); }
    } catch { /* offline */ }
    if (!healthHistory[server.url]) healthHistory[server.url] = [];
    healthHistory[server.url].unshift({ ts: Date.now(), up, ms, label: server.label });
    if (healthHistory[server.url].length > MAX_HEALTH_ENTRIES)
      healthHistory[server.url] = healthHistory[server.url].slice(0, MAX_HEALTH_ENTRIES);
  }));
  saveHealthData();
}

// Boot: load persisted data then start background pinger
loadHealthData();
setInterval(pingHealthServers, HEALTH_INTERVAL_MS);
setTimeout(pingHealthServers, 10000);

module.exports = {
  healthServers,
  healthHistory,
  registerHealthServers,
  unregisterHealthServer,
  cleanupStaleServers,
  pingHealthServers,
};
