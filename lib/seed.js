// ─── Seed the initial admin user from env (idempotent) ──────────────────────
const db = require('./db');
const { makeUsers } = require('./users');

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
    console.log(`[seed] synced admin '${username}' password from env`);
    return;
  }
  await users.create(username, password, 'admin');
  console.log(`[seed] created admin '${username}'`);
}

module.exports = { seedAdmin };