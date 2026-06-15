// ─── Global error handlers — log then EXIT so Railway can restart cleanly ────
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught Exception — exiting for clean restart:');
  console.error('[fatal] message:', err && err.message);
  console.error('[fatal] stack:', err && err.stack);
  setTimeout(() => process.exit(1), 1000).unref();
});
process.on('unhandledRejection', (reason, promise) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '(no stack)';
  console.error('[fatal] Unhandled Promise Rejection — exiting for clean restart:');
  console.error('[fatal] reason:', msg);
  console.error('[fatal] stack:', stack);
  console.error('[fatal] promise:', promise);
  setTimeout(() => process.exit(1), 1000).unref();
});

const { logStartupSecurityWarnings } = require('./lib/security');
const { createApp } = require('./lib/createApp');
const { makeUserConfig } = require('./lib/userConfig');

const { app, PORT, deps } = createApp();
const { dbLib, requestLogDb } = deps;

let server = null;

function bootServer() {
  server = app.listen(PORT, '0.0.0.0', () => {
    logStartupSecurityWarnings();
    console.log(`[startup] Stream Hub READY → http://0.0.0.0:${PORT}/configure`);
  });
  return server;
}

let _isShuttingDown = false;

function doGracefulShutdown(signal = 'SIGTERM') {
  if (_isShuttingDown) return;
  _isShuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  try {
    const healthMod = require('./lib/health');
    if (typeof healthMod.stopHealthPinger === 'function') healthMod.stopHealthPinger();
  } catch (e) { /* best effort */ }

  try {
    const adminSched = require('./lib/adminIntelScheduler');
    if (typeof adminSched.stopAdminIntelScheduler === 'function') adminSched.stopAdminIntelScheduler();
  } catch (e) { /* best effort */ }

  let db;
  try {
    db = require('./lib/db');
    if (typeof db.setShuttingDown === 'function') db.setShuttingDown(true);
  } catch (e) { /* best effort */ }

  try {
    if (server) {
      server.close(() => {
        console.log('HTTP server closed (no new connections).');
      });
    }
  } catch (e) { /* ignore */ }

  const drainDb = async () => {
    try {
      if (db && typeof db.shutdown === 'function' && typeof db.isConfigured === 'function' && db.isConfigured()) {
        await Promise.race([
          db.shutdown(),
          new Promise(r => setTimeout(r, 4500)),
        ]);
        console.log('Postgres pool drained (clean client disconnects attempted).');
      }
    } catch (e) { /* ignore */ }
    process.exit(0);
  };

  drainDb();
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 15000).unref();
}

function registerShutdownHandlers() {
  process.on('SIGTERM', () => doGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => doGracefulShutdown('SIGINT'));
}

function runBootTasks() {
  const { runMigrations } = require('./lib/migrate');
  const { seedAdmin } = require('./lib/seed');

  return runMigrations()
    .then(() => seedAdmin())
    .then(() => console.log('[ready] Server fully initialized (DB init complete, accepting connections)'))
    .catch(e => console.error('[boot] db init failed:', e.message));
}

if (require.main === module) {
  bootServer();
  registerShutdownHandlers();
  runBootTasks();
}

module.exports = { app, PORT, bootServer, runBootTasks, createApp, deps };