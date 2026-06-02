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

module.exports = { summarizeRequestLog, userActivity };
