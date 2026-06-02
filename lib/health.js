// ─── Health monitoring ────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const db = require('./db');
const { makeServerHistory } = require('./serverHistory');
const _serverHistory = makeServerHistory(db);

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
    console.log('[health] loaded state from Postgres');
  } catch (e) { console.warn('[health] db load skipped:', e.message); }
}

function registerHealthServers(servers, userId) {
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
  // Record which servers this logged-in user owns, for per-user uptime attribution.
  if (userId) {
    const urls = servers.map(s => (s.url || '').replace(/\/+$/, '')).filter(Boolean);
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
  const results = [];
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

// Boot: load persisted data then start background pinger
loadHealthData();
setInterval(pingHealthServers, HEALTH_INTERVAL_MS);
setTimeout(pingHealthServers, 10000);
setInterval(() => { _serverHistory.prune().catch(() => {}); }, 24 * 60 * 60 * 1000);

module.exports = {
  healthServers,
  healthHistory,
  registerHealthServers,
  unregisterHealthServer,
  cleanupStaleServers,
  pingHealthServers,
  initHealthDB,
  forgetUser,
};
