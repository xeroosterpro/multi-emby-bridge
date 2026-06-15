// ─── Seed the initial admin user from env (idempotent) ──────────────────────
const db = require('./db');
const { makeUsers } = require('./users');
const { makeUserConfig } = require('./userConfig');
const { makeBilling } = require('./billing');
const { upgradeStreamProfile } = require('./streamDefaults');
const { migrateLegacyServersToAdmin } = require('./migrateLegacyConfig');
const { restoreLocalServersForTargets } = require('./restoreLocalServers');

const DEFAULT_ADMIN_CONFIG = { servers: [] };

async function ensureAdminConfig(userId) {
  const uc = makeUserConfig(db);
  const row = await uc.getForServe(userId);
  if (row) return;
  const { cfg } = upgradeStreamProfile(DEFAULT_ADMIN_CONFIG);
  await uc.save(userId, cfg);
  console.log(`[seed] initialized default config for user ${userId}`);
}

async function ensureAdminAccess(userId) {
  const billing = makeBilling(db);
  if (!(await billing.hasAccess(userId))) {
    await billing.comp(userId, null);
    console.log(`[seed] comped subscription for user ${userId}`);
  }
}

async function seedAdmin() {
  if (!db.isConfigured()) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) { console.warn('[seed] ADMIN_PASSWORD not set — no admin seeded'); return; }
  const users = makeUsers(db);
  const existing = await users.findByUsername(username);
  if (existing) {
    await users.setPassword(existing.id, password);
    if (existing.role !== 'admin') await users.setRole(existing.id, 'admin');
    await ensureAdminAccess(existing.id);
    await ensureAdminConfig(existing.id);
    await migrateLegacyServersToAdmin(existing.id);
    await restoreLocalServersForTargets();
    console.log(`[seed] synced admin '${username}' password from env`);
    return;
  }
  const created = await users.create(username, password, 'admin');
  await ensureAdminAccess(created.id);
  await ensureAdminConfig(created.id);
  await migrateLegacyServersToAdmin(created.id);
  await restoreLocalServersForTargets();
  console.log(`[seed] created admin '${username}'`);
}

module.exports = { seedAdmin, ensureAdminConfig, ensureAdminAccess };