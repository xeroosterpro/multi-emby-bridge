// ─── Merge locally discovered server credentials into Postgres user configs ───
// Reads data/local-servers.json, data/profiles.json, and optional RESTORE_SERVERS_B64 env.
// Idempotent: fills missing servers/credentials without wiping existing entries.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { loadProfiles } = require('./profiles');
const { makeUsers } = require('./users');
const { makeUserConfig } = require('./userConfig');
const { upgradeStreamProfile } = require('./streamDefaults');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const LOCAL_SERVERS_FILE = path.join(DATA_DIR, 'local-servers.json');
const RESTORE_TARGETS = (process.env.RESTORE_USERNAMES || 'admin,Eli')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function normUrl(u) {
  return (u || '').replace(/\/+$/, '').toLowerCase();
}

function hostKey(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return normUrl(u);
  }
}

function pickField(incoming, existing, field) {
  const inc = incoming && incoming[field];
  if (inc != null && String(inc).length) return inc;
  const ex = existing && existing[field];
  if (ex != null && String(ex).length) return ex;
  return undefined;
}

function mergeServerEntry(existing, incoming) {
  if (!incoming || !incoming.url) return existing || null;
  const out = { ...(existing || {}), ...(incoming || {}) };
  for (const f of ['label', 'type', 'url', 'apiKey', 'userId', 'username', 'password', 'enabled', 'cost', 'costPeriod', 'emoji']) {
    const v = pickField(incoming, existing, f);
    if (v !== undefined) out[f] = v;
  }
  if (out.enabled === undefined) out.enabled = true;
  return out;
}

function mergeServerLists(existingServers, incomingServers) {
  const byUrl = new Map();
  const byHost = new Map();
  for (const s of existingServers || []) {
    if (!s || !s.url) continue;
    byUrl.set(normUrl(s.url), { ...s });
    byHost.set(hostKey(s.url), normUrl(s.url));
  }

  let added = 0;
  let updated = 0;

  for (const inc of incomingServers || []) {
    if (!inc || !inc.url) continue;
    const key = normUrl(inc.url);
    const host = hostKey(inc.url);
    let targetKey = key;
    if (!byUrl.has(key) && byHost.has(host)) {
      targetKey = byHost.get(host);
    }
    const existing = byUrl.get(targetKey);
    if (!existing) {
      byUrl.set(key, mergeServerEntry(null, inc));
      byHost.set(host, key);
      added++;
      continue;
    }
    const merged = mergeServerEntry(existing, inc);
    const changed = JSON.stringify(merged) !== JSON.stringify(existing);
    byUrl.set(targetKey, merged);
    if (changed) updated++;
  }

  return {
    servers: Array.from(byUrl.values()),
    added,
    updated,
  };
}

function loadJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[restore] could not read ${filePath}:`, e.message);
    return null;
  }
}

function collectLocalServers() {
  const collected = [];

  const local = loadJsonFile(LOCAL_SERVERS_FILE);
  if (local && Array.isArray(local.servers)) collected.push(...local.servers);

  if (process.env.RESTORE_SERVERS_B64) {
    try {
      const parsed = JSON.parse(Buffer.from(process.env.RESTORE_SERVERS_B64, 'base64').toString('utf8'));
      if (Array.isArray(parsed)) collected.push(...parsed);
      else if (parsed && Array.isArray(parsed.servers)) collected.push(...parsed.servers);
    } catch (e) {
      console.warn('[restore] RESTORE_SERVERS_B64 decode failed:', e.message);
    }
  }

  const profiles = loadProfiles();
  for (const prof of Object.values(profiles || {})) {
    if (prof && prof.config && Array.isArray(prof.config.servers)) {
      collected.push(...prof.config.servers);
    }
  }

  const byUrl = new Map();
  for (const s of collected) {
    if (!s || !s.url) continue;
    const key = normUrl(s.url);
    byUrl.set(key, mergeServerEntry(byUrl.get(key), s));
  }
  return Array.from(byUrl.values());
}

async function restoreLocalServersForUser(userId, incomingServers) {
  if (!userId || !incomingServers.length) {
    return { restored: false, reason: 'nothing_to_apply' };
  }
  const uc = makeUserConfig(db);
  const current = (await uc.getForServe(userId)) || { servers: [] };
  const { servers, added, updated } = mergeServerLists(current.servers, incomingServers);
  if (!added && !updated) {
    return { restored: false, reason: 'already_complete', count: servers.length };
  }
  const { cfg } = upgradeStreamProfile({ ...current, servers });
  await uc.save(userId, cfg);
  return {
    restored: true,
    added,
    updated,
    count: servers.length,
    labels: servers.map(s => s.label || s.url),
  };
}

async function restoreLocalServersForTargets(usernames = RESTORE_TARGETS) {
  if (!db.isConfigured()) return { restored: false, reason: 'no_db' };
  const incoming = collectLocalServers();
  if (!incoming.length) {
    console.log('[restore] no local server definitions found');
    return { restored: false, reason: 'no_local_servers' };
  }

  const users = makeUsers(db);
  const results = [];
  for (const name of usernames) {
    const u = await users.findByUsername(name);
    if (!u) {
      results.push({ username: name, restored: false, reason: 'user_not_found' });
      continue;
    }
    const r = await restoreLocalServersForUser(u.id, incoming);
    results.push({ username: name, ...r });
    if (r.restored) {
      console.log(`[restore] '${name}': ${r.count} server(s) (+${r.added} new, ~${r.updated} updated)`);
    }
  }
  const any = results.some(r => r.restored);
  return { restored: any, incoming: incoming.length, results };
}

module.exports = {
  normUrl,
  hostKey,
  mergeServerEntry,
  mergeServerLists,
  collectLocalServers,
  restoreLocalServersForUser,
  restoreLocalServersForTargets,
};