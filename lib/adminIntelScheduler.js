// ─── Background jobs for Admin Data Center ───────────────────────────────────
const db = require('./db');
const { makeAdminIntel, SNAPSHOT_INTERVAL_MS, BRIDGE_METRIC_INTERVAL_MS } = require('./adminIntel');

let _intel = null;
let _snapshotTimer = null;
let _bridgeTimer = null;

function startAdminIntelScheduler(deps) {
  if (_snapshotTimer) return;
  _intel = makeAdminIntel(deps);
  _intel.hydrateLastSnapshotAt().catch(() => {});
  _intel.purgeDemoServersFromAllUsers().catch(e => console.error('[adminIntel/purgeDemo]', e.message));

  const runSnapshot = () => {
    if (!db.isConfigured()) return;
    _intel.runSnapshotCycle().catch(e => console.error('[adminIntel/snapshot]', e.message));
  };
  const runBridge = () => {
    if (!db.isConfigured()) return;
    _intel.saveBridgeMetric().catch(e => console.error('[adminIntel/bridge]', e.message));
  };

  setTimeout(runSnapshot, 15000);
  setTimeout(runBridge, 5000);
  _snapshotTimer = setInterval(runSnapshot, SNAPSHOT_INTERVAL_MS);
  _bridgeTimer = setInterval(runBridge, BRIDGE_METRIC_INTERVAL_MS);
  if (_snapshotTimer.unref) _snapshotTimer.unref();
  if (_bridgeTimer.unref) _bridgeTimer.unref();
  console.log('[adminIntel] scheduler started (snapshot 5m, bridge 60s)');
}

function getAdminIntel(deps) {
  if (!_intel) _intel = makeAdminIntel(deps);
  return _intel;
}

module.exports = { startAdminIntelScheduler, getAdminIntel, SNAPSHOT_INTERVAL_MS, BRIDGE_METRIC_INTERVAL_MS };