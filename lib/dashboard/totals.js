function monthlyCost(cost, period) {
  const n = Number(cost);
  if (!n || n <= 0) return 0;
  const p = String(period || 'month').toLowerCase();
  if (p === 'year' || p === 'yr' || p === 'annual') return n / 12;
  if (p === 'week' || p === 'wk') return n * 4.33;
  return n;
}

function computeTotals({ servers, connections, library, health }) {
  const conn = connections || [];
  const lib = library || [];
  const upFromConn = conn.filter(c => c.ok).length;
  const bridgeTimes = conn
    .filter(c => c.ok && c.bridgeMs != null)
    .map(c => c.bridgeMs);
  const fastestBridgeMs = bridgeTimes.length ? Math.min(...bridgeTimes) : null;

  let movies = 0;
  let shows = 0;
  let episodes = 0;
  for (const row of lib) {
    if (!row.ok) continue;
    movies += row.movies || 0;
    shows += row.shows || 0;
    episodes += row.episodes || 0;
  }

  const costMonthly = (servers || []).reduce(
    (a, s) => a + monthlyCost(s.cost, s.costPeriod),
    0,
  );

  return {
    serversUp: upFromConn,
    serversTotal: (servers || []).length,
    movies,
    shows,
    episodes,
    fastestBridgeMs,
    costMonthly: Math.round(costMonthly * 100) / 100,
    costYearly: Math.round(costMonthly * 12),
    healthTargets: (health || []).length,
  };
}

module.exports = { monthlyCost, computeTotals };