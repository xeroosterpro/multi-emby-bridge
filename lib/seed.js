// ─── Seed the initial admin user from env (idempotent) ──────────────────────
const db = require('./db');
const { makeUsers } = require('./users');

async function seedAdmin() {
  if (!db.isConfigured()) return;
  const username = process.env.ADMIN_USERNAME || 'Eli';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) { console.warn('[seed] ADMIN_PASSWORD not set — no admin seeded'); return; }
  const users = makeUsers(db);
  if (await users.findByUsername(username)) return;
  await users.create(username, password, 'admin');
  console.log(`[seed] created admin '${username}'`);
}

module.exports = { seedAdmin };
