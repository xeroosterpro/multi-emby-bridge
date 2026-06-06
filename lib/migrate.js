// ─── Boot-time SQL migration runner ─────────────────────────────────────────
// Applies any unapplied migrations/*.sql in order. No-ops without DATABASE_URL.
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  if (!db.isConfigured()) { console.warn('[migrate] DATABASE_URL not set — skipping'); return; }
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await db.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [f]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(filename) VALUES($1)', [f]);
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      console.error(`[migrate] FAILED on ${f}: ${e.message}`);
      // Don't rethrow — a failed migration should not prevent the server from
      // starting. Routes gracefully handle missing tables.
    }
  }
}

module.exports = { runMigrations };
