// ─── Postgres pool (lazy; no-ops without DATABASE_URL) ──────────────────────
// Keeps the addon fully functional before a database is provisioned: callers
// check isConfigured() and degrade gracefully when there's no DATABASE_URL.
let Pool;
try { ({ Pool } = require('pg')); } catch { Pool = null; }

let _pool = null;

function isConfigured() { return !!process.env.DATABASE_URL; }

function getPool() {
  if (!isConfigured()) throw new Error('DATABASE_URL not set');
  if (!Pool) throw new Error('pg not installed');
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Railway managed Postgres
      max: 5,
    });
  }
  return _pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

module.exports = { isConfigured, getPool, query };
