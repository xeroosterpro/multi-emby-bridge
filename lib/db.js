// ─── Postgres pool (lazy; no-ops without DATABASE_URL) ──────────────────────
// Keeps the addon fully functional before a database is provisioned: callers
// check isConfigured() and degrade gracefully when there's no DATABASE_URL.
let Pool;
try { ({ Pool } = require('pg')); } catch { Pool = null; }

let _pool = null;
let _shuttingDown = false;

function isConfigured() { return !!process.env.DATABASE_URL; }

function setShuttingDown(v = true) {
  _shuttingDown = !!v;
}

async function shutdown() {
  setShuttingDown(true);
  if (!_pool) return true;
  const p = _pool;
  _pool = null; // prevent new getPool from reusing during drain
  try {
    await p.end();
    return true;
  } catch (e) {
    // Pool end failures are expected in some race cases during container SIGTERM
    return false;
  }
}

function getPool() {
  if (_shuttingDown) {
    throw new Error('shutting down - no new db work');
  }
  if (!isConfigured()) throw new Error('DATABASE_URL not set');
  if (!Pool) throw new Error('pg not installed');
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Railway managed Postgres
      max: 4,                       // fewer connections = fewer things to clean on every deploy
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true,        // helps clean process exit on SIGTERM (pg >=8)
    });

    // Prevent unhandled pool errors from crashing the process.
    // During graceful shutdown (Railway deploys), many "eof", "reset by peer",
    // "SSL error", "terminated" are *expected* as we drain/end the pool.
    // Log them at lower severity (or suppress) so deploy logs stay clean.
    _pool.on('error', (err, client) => {
      const msg = err && (err.message || err.code || String(err)) || '';
      const isShutdownNoise = _shuttingDown ||
        /eof|reset by peer|connection (reset|terminated|closed)|unexpected eof|ssl/i.test(msg) ||
        /terminat/i.test(msg);
      if (isShutdownNoise) {
        // Quiet during deploys / SIGTERM. These are normal client drops.
        return;
      }
      require('./logger').logger.error({ err }, '[db] unexpected error on idle pg client');
      // The pool will automatically try to recover for non-shutdown cases
    });
  }
  return _pool;
}

async function query(text, params) {
  if (_shuttingDown) {
    // No-op result so callers (background jobs that race the flag) don't throw.
    return { rows: [], rowCount: 0 };
  }
  return getPool().query(text, params);
}

// Run fn inside a single transaction on one pooled client. fn receives the
// client (has the same .query interface), so repos built with makeX(client)
// all participate in the same BEGIN/COMMIT — and roll back together on error.
async function withTransaction(fn) {
  if (_shuttingDown) throw new Error('shutting down - no new db work');
  const client = await getPool().connect();
  try {
    return await _runTx(client, fn);
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

// Extracted so the BEGIN/COMMIT/ROLLBACK logic is unit-testable with a fake client.
async function _runTx(client, fn) {
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
    throw e;
  }
}

module.exports = { isConfigured, getPool, query, withTransaction, _runTx, shutdown, setShuttingDown };
