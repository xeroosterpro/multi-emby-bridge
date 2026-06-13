// ─── Health monitoring ────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const db = require('./db');
const { makeServerHistory } = require('./serverHistory');
const { apiFetch, BROWSER_UA } = require('./auth');
const {
  HEALTH_INTERVAL_MS,
  HEALTH_CONSECUTIVE_DOWN,
  PING_TIMEOUT_MS,
  isPingResponseOk,
  detectionWindowMinutes,
} = require('./healthProbe');
const _serverHistory = makeServerHistory(db);
const { isDemoServer } = require('./demoServers');

// Per-user server ownership captured at registration time (when a logged-in
// user's browser registers their servers). Persisted in the health_state blob
// so it survives restarts. Keyed by userId → array of normalized URLs.
let userServerUrls = {};

// Build server URL → [userId] from BOTH the register-time ownership map AND any
// account-stored configs, so uptime is attributed however the user set up.
async function usersForServerUrls() {
  const map = new Map();
  const add = (url, userId) => {
    const u = (url || '').replace(/\/+$/, '');
    if (!u || !userId) return;
    if (!map.has(u)) map.set(u, new Set());
    map.get(u).add(userId);
  };
  for (const [userId, urls] of Object.entries(userServerUrls)) {
    for (const url of (urls || [])) add(url, userId);
  }
  if (db.isConfigured()) {
    try {
      const r = await db.query(`SELECT user_id, config_json FROM user_config`);
      for (const row of r.rows) {
        const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
        for (const s of ((cfg && cfg.servers) || [])) add(s.url, row.user_id);
      }
    } catch (e) { console.error('[health/usersForServerUrls]', e.message); }
  }
  const out = new Map();
  for (const [url, set] of map) out.set(url, [...set]);
  return out;
}

const HEALTH_DB_KEY = 'state';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const HEALTH_FILE = path.join(DATA_DIR, 'health-history.json');
const HEALTH_SERVERS_FILE = path.join(DATA_DIR, 'health-servers.json');
const MAX_HEALTH_ENTRIES = 2016;

let healthServers = [];
let healthHistory = {};

function loadHealthData() {
  try {
    if (fs.existsSync(HEALTH_SERVERS_FILE))
      healthServers = JSON.parse(fs.readFileSync(HEALTH_SERVERS_FILE, 'utf8'));
    if (fs.existsSync(HEALTH_FILE))
      healthHistory = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
    pruneDemoHealthServers();
  } catch { /* start fresh */ }
}

function saveHealthData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HEALTH_SERVERS_FILE, JSON.stringify(healthServers, null, 2), 'utf8');
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthHistory), 'utf8');
  } catch { /* non-critical */ }
  if (db.isConfigured()) dbSave().catch(() => { /* non-critical */ });
}

// Persist the full state to Postgres (survives Railway redeploys, unlike files).
async function dbSave() {
  const data = JSON.stringify({ healthServers, healthHistory, userServerUrls });
  await db.query(
    `INSERT INTO health_state(id, data, updated_at) VALUES($1,$2::jsonb,now())
     ON CONFLICT (id) DO UPDATE SET data=$2::jsonb, updated_at=now()`,
    [HEALTH_DB_KEY, data]
  );
}

// Load persisted state from Postgres at boot — MUTATES the existing objects in
// place so the references exported below stay valid.
async function initHealthDB() {
  if (!db.isConfigured()) return;
  try {
    const r = await db.query('SELECT data FROM health_state WHERE id=$1', [HEALTH_DB_KEY]);
    if (!r.rowCount) return;
    const state = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
    if (Array.isArray(state.healthServers)) {
      healthServers.length = 0; state.healthServers.forEach(s => healthServers.push(s));
    }
    if (state.healthHistory && typeof state.healthHistory === 'object') {
      for (const k of Object.keys(healthHistory)) delete healthHistory[k];
      Object.assign(healthHistory, state.healthHistory);
    }
    if (state.userServerUrls && typeof state.userServerUrls === 'object') userServerUrls = state.userServerUrls;
    pruneDemoHealthServers();
    console.log('[health] loaded state from Postgres');
  } catch (e) { console.warn('[health] db load skipped:', e.message); }
}

function pruneDemoHealthServers() {
  const before = healthServers.length;
  const kept = healthServers.filter(s => !isDemoServer(s));
  healthServers.length = 0;
  kept.forEach(s => healthServers.push(s));
  for (const url of Object.keys(healthHistory)) {
    const hist = healthHistory[url] || [];
    const label = hist[0]?.label;
    if (isDemoServer({ url, label })) delete healthHistory[url];
  }
  for (const [uid, urls] of Object.entries(userServerUrls)) {
    const cleaned = (urls || []).filter(u => !isDemoServer({ url: u }));
    if (cleaned.length !== (urls || []).length) userServerUrls[uid] = cleaned;
  }
  if (healthServers.length !== before) saveHealthData();
}

function registerHealthServers(servers, userId) {
  let changed = false;
  for (const s of servers) {
    if (!s.url || isDemoServer(s)) continue;
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
  // Record which servers this logged-in user owns, for per-user uptime attribution.
  if (userId) {
    const urls = servers.filter(s => !isDemoServer(s)).map(s => (s.url || '').replace(/\/+$/, '')).filter(Boolean);
    if (JSON.stringify(userServerUrls[userId] || []) !== JSON.stringify(urls)) {
      userServerUrls[userId] = urls;
      changed = true;
    }
  }
  if (changed) saveHealthData();
}

// Drop a user's server-ownership mapping (call on user deletion) so the pinger
// stops attributing checks to a non-existent user_id (which would FK-violate).
function forgetUser(userId) {
  if (userId && Object.prototype.hasOwnProperty.call(userServerUrls, userId)) {
    delete userServerUrls[userId];
    saveHealthData();
  }
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
  const kept = healthServers.filter(h => activeSet.has(h.url));
  healthServers.length = 0;
  kept.forEach(s => healthServers.push(s));
  // Clean up history for removed servers
  for (const url of Object.keys(healthHistory)) {
    if (!activeSet.has(url)) delete healthHistory[url];
  }
  if (healthServers.length !== before) saveHealthData();
  return before - healthServers.length;
}

async function authServersByUrl() {
  const map = new Map();
  if (!db.isConfigured()) return map;
  try {
    const r = await db.query('SELECT config_json FROM user_config');
    for (const row of r.rows) {
      const cfg = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      for (const s of ((cfg && cfg.servers) || [])) {
        if (isDemoServer(s)) continue;
        const url = (s.url || '').replace(/\/+$/, '');
        if (!url || !s.apiKey || !s.userId || s.enabled === false) continue;
        if (!map.has(url)) {
          map.set(url, {
            url, type: s.type || 'emby', apiKey: s.apiKey, userId: s.userId,
            username: s.username || '', password: s.password || '', label: s.label || url,
          });
        }
      }
    }
  } catch (e) { console.error('[health/authServers]', e.message); }
  return map;
}

async function probeServerReachable(server, authByUrl) {
  const url = (server.url || '').replace(/\/+$/, '');
  const t0 = Date.now();
  const auth = authByUrl && authByUrl.get(url);
  if (auth && auth.apiKey && auth.userId) {
    try {
      const resp = await apiFetch(auth, () => new URL(`${url}/System/Info`));
      if (isPingResponseOk(resp)) return { up: true, ms: Date.now() - t0, method: 'auth' };
    } catch { /* fall through to unauthenticated ping */ }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const resp = await fetch(`${url}/System/Ping`, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_UA },
      });
      if (!isPingResponseOk(resp)) return { up: false, ms: null, method: 'ping' };
      return { up: true, ms: Date.now() - t0, method: 'ping' };
    } finally { clearTimeout(timer); }
  } catch {
    return { up: false, ms: null, method: 'ping' };
  }
}

async function pingHealthServers() {
  if (healthServers.length === 0) return;
  const authByUrl = await authServersByUrl();
  const results = [];
  await Promise.all(healthServers.map(async (server) => {
    const { up, ms, method } = await probeServerReachable(server, authByUrl);
    if (!healthHistory[server.url]) healthHistory[server.url] = [];
    healthHistory[server.url].unshift({ ts: Date.now(), up, ms, method: method || 'ping', label: server.label });
    if (healthHistory[server.url].length > MAX_HEALTH_ENTRIES)
      healthHistory[server.url] = healthHistory[server.url].slice(0, MAX_HEALTH_ENTRIES);
    results.push({ url: server.url, label: server.label, up, ms });
  }));
  saveHealthData();
  // Persist per-user durable history (best-effort; never throws)
  try {
    const map = await usersForServerUrls();
    for (const res of results) {
      const users = map.get(res.url) || [];
      for (const userId of users) {
        await _serverHistory.logCheck({ userId, serverUrl: res.url, label: res.label, up: res.up, responseMs: res.up ? res.ms : null });
      }
    }
  } catch (e) { console.error('[health/persist]', e.message); }
}

// Shutdown coordination
let _healthPingTimer = null;
let _pruneTimer = null;
let _shuttingDown = false;

function stopHealthPinger() {
  _shuttingDown = true;
  if (_healthPingTimer) {
    clearTimeout(_healthPingTimer);
    _healthPingTimer = null;
  }
  if (_pruneTimer) {
    clearInterval(_pruneTimer);
    _pruneTimer = null;
  }
}

function scheduleHealthPing() {
  if (_shuttingDown) return;
  // Small jitter (0-3s) to avoid thundering herd against origin servers and spread load
  const jitter = Math.floor(Math.random() * 3000);
  _healthPingTimer = setTimeout(() => {
    if (_shuttingDown) return;
    pingHealthServers().catch(e => console.error('[health/ping]', e.message));
    // Re-schedule next with fresh jitter (keeps interval on average)
    scheduleHealthPing();
  }, HEALTH_INTERVAL_MS + jitter);
}

// Boot: load persisted data then start background pinger
loadHealthData();
scheduleHealthPing();
setTimeout(() => {
  if (!_shuttingDown) pingHealthServers().catch(e => console.error('[health/ping]', e.message));
}, 8000 + Math.floor(Math.random() * 4000));
_pruneTimer = setInterval(() => { _serverHistory.prune().catch(() => {}); }, 24 * 60 * 60 * 1000);
if (_pruneTimer && _pruneTimer.unref) _pruneTimer.unref();

function getUserServerUrlSet(userId) {
  const set = new Set();
  for (const url of (userServerUrls[userId] || [])) {
    const u = (url || '').replace(/\/+$/, '');
    if (u) set.add(u);
  }
  return set;
}

function historyForUrls(urlSet) {
  if (!urlSet || !urlSet.size) return [];
  return healthServers
    .filter(s => urlSet.has((s.url || '').replace(/\/+$/, '')))
    .map(s => ({
      url: s.url,
      label: s.label,
      type: s.type,
      history: (healthHistory[s.url] || []),
    }));
}

module.exports = {
  healthServers,
  healthHistory,
  userServerUrls,
  getUserServerUrlSet,
  historyForUrls,
  registerHealthServers,
  unregisterHealthServer,
  cleanupStaleServers,
  pingHealthServers,
  probeServerReachable,
  initHealthDB,
  forgetUser,
  stopHealthPinger,
  HEALTH_INTERVAL_MS,
  HEALTH_CONSECUTIVE_DOWN,
  detectionWindowMinutes,
};
