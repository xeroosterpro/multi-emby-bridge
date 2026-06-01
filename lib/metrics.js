// ─── System metrics for the admin panel (Phase 4) ──────────────────────────
// Pure Node os/process — no deps. cpuPercent() samples CPU usage of THIS process
// between successive calls (call on an interval for a live reading).

const os = require('os');

let _lastCpu = process.cpuUsage();
let _lastT = process.hrtime.bigint();

function cpuPercent() {
  const now = process.cpuUsage();
  const nowT = process.hrtime.bigint();
  const elapsedMs = Number(nowT - _lastT) / 1e6;
  const usedMs = (now.user - _lastCpu.user + now.system - _lastCpu.system) / 1000;
  _lastCpu = now; _lastT = nowT;
  if (elapsedMs <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((usedMs / elapsedMs) * 100)));
}

function snapshot() {
  const mem = process.memoryUsage();
  const total = os.totalmem();
  const free = os.freemem();
  return {
    uptimeSec: Math.floor(process.uptime()),
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    sysMemTotalBytes: total,
    sysMemUsedBytes: total - free,
    sysMemPct: Math.round(((total - free) / total) * 100),
    loadAvg1: os.loadavg()[0],
    cpuCount: os.cpus().length,
    cpuPercent: cpuPercent(),
  };
}

module.exports = { snapshot, cpuPercent };
