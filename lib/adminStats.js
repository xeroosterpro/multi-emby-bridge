// ─── Pure summaries over the in-memory request log ─────────────────────────
const DAY = 86400000, WEEK = 7 * DAY;
const within = (ts, ms, now) => (now - new Date(ts).getTime()) <= ms;

function summarizeRequestLog(log, opts = {}) {
  const now = opts.now || Date.now();
  const arr = Array.isArray(log) ? log : [];
  const last24 = arr.filter(e => within(e.ts, DAY, now));
  const titleCounts = {}, serverCounts = {};
  for (const e of last24) {
    if (e.contentName) titleCounts[e.contentName] = (titleCounts[e.contentName] || 0) + 1;
    if (e.bestServer) serverCounts[e.bestServer] = (serverCounts[e.bestServer] || 0) + 1;
  }
  const topTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([title, count]) => ({ title, count }));
  const busiest = Object.entries(serverCounts).sort((a, b) => b[1] - a[1])[0];
  return {
    requests24h: last24.length,
    requests7d: arr.filter(e => within(e.ts, WEEK, now)).length,
    topTitles,
    busiestServer: busiest ? { server: busiest[0], count: busiest[1] } : null,
  };
}

function userActivity(log, userId, opts = {}) {
  const now = opts.now || Date.now();
  const mine = (Array.isArray(log) ? log : []).filter(e => e.userId === userId);
  return {
    recent: mine.slice(0, 50).map(e => ({
      ts: e.ts, title: e.contentName || null, type: e.type || null,
      season: e.season || null, episode: e.episode || null,
      server: e.bestServer || null, ms: e.ms ?? null, found: !!e.found,
    })),
    totals: {
      requests24h: mine.filter(e => within(e.ts, DAY, now)).length,
      requests7d: mine.filter(e => within(e.ts, WEEK, now)).length,
      lastActive: mine[0] ? mine[0].ts : null,
    },
  };
}

function userAnalytics(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const titleCounts = {}, serverCounts = {};
  for (const e of arr) {
    const t = e.contentName || e.title; if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
    const s = e.bestServer || e.server; if (s) serverCounts[s] = (serverCounts[s] || 0) + 1;
  }
  const topTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([title, count]) => ({ title, count }));
  const ts = Object.entries(serverCounts).sort((a, b) => b[1] - a[1])[0];
  const found = arr.filter(e => e.found).length;
  return { topTitles, topServer: ts ? { server: ts[0], count: ts[1] } : null, successRate: arr.length ? Math.round(found / arr.length * 100) : null };
}

/** Bucket request rows into daily or hourly series for charts. */
function timeSeries(log, opts = {}) {
  const now = opts.now || Date.now();
  const days = opts.days || 7;
  const hourly = !!opts.hourly;
  const cutoff = now - days * DAY;
  const arr = (Array.isArray(log) ? log : []).filter(e => e.ts && new Date(e.ts).getTime() >= cutoff);
  const buckets = new Map();
  for (const e of arr) {
    const d = new Date(e.ts);
    const key = hourly
      ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}`
      : d.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { label: key, total: 0, found: 0, failed: 0 });
    const b = buckets.get(key);
    b.total++;
    if (e.found) b.found++; else b.failed++;
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Rank servers by request volume within a window. */
function serverBreakdown(log, opts = {}) {
  const now = opts.now || Date.now();
  const windowMs = opts.windowMs || DAY;
  const counts = {};
  for (const e of (Array.isArray(log) ? log : [])) {
    if (!within(e.ts, windowMs, now)) continue;
    const s = e.bestServer || e.server;
    if (!s) continue;
    counts[s] = (counts[s] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([server, count]) => ({ server, count }));
}

/** Top content titles in a window. */
function topContent(log, opts = {}) {
  const now = opts.now || Date.now();
  const windowMs = opts.windowMs || DAY;
  const limit = opts.limit || 8;
  const counts = {};
  for (const e of (Array.isArray(log) ? log : [])) {
    if (!within(e.ts, windowMs, now)) continue;
    const t = e.contentName || e.title;
    if (!t) continue;
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([title, count]) => ({ title, count }));
}

module.exports = { summarizeRequestLog, userActivity, userAnalytics, timeSeries, serverBreakdown, topContent };
