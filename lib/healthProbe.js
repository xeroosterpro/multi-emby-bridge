// ─── Health probe constants & pure helpers ─────────────────────────────────

const HEALTH_INTERVAL_MS = 30 * 1000; // background bridge probe cadence
const HEALTH_CONSECUTIVE_DOWN = 2;    // consecutive failures before "down" alerts
const PING_TIMEOUT_MS = 8000;

function isPingResponseOk(resp) {
  return !!(resp && resp.ok);
}

function detectionWindowMs(consecutive = HEALTH_CONSECUTIVE_DOWN, intervalMs = HEALTH_INTERVAL_MS) {
  return consecutive * intervalMs;
}

function detectionWindowMinutes(consecutive, intervalMs) {
  return Math.max(1, Math.round(detectionWindowMs(consecutive, intervalMs) / 60000));
}

module.exports = {
  HEALTH_INTERVAL_MS,
  HEALTH_CONSECUTIVE_DOWN,
  PING_TIMEOUT_MS,
  isPingResponseOk,
  detectionWindowMs,
  detectionWindowMinutes,
};