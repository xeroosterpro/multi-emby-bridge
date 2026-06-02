// Run with: node test/serverHistory.test.js
const { makeServerHistory } = require('../lib/serverHistory');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const log = []; const daily = new Map(); // key user|url|day
  return {
    async query(text, params) {
      if (/INSERT INTO server_health_log/i.test(text)) {
        log.push({ user_id: params[0], server_url: params[1], label: params[2], up: params[3], response_ms: params[4] });
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT INTO server_uptime_daily/i.test(text)) {
        // params: user, url, label, day, up(1/0), ms
        const key = `${params[0]}|${params[1]}|${params[3]}`;
        const up = params[4] ? 1 : 0; const ms = params[5];
        const cur = daily.get(key) || { user_id: params[0], server_url: params[1], label: params[2], day: params[3], checks: 0, up_checks: 0, avg_ms: 0 };
        // avg_ms averages over SUCCESSFUL checks only (denominator = up_checks), mirroring the SQL
        cur.avg_ms = ms == null ? cur.avg_ms : Math.round((cur.avg_ms * cur.up_checks + ms) / (cur.up_checks + 1));
        cur.checks += 1; cur.up_checks += up;
        daily.set(key, cur);
        return { rowCount: 1, rows: [] };
      }
      if (/DELETE FROM server_health_log/i.test(text)) { return { rowCount: 0, rows: [] }; }
      if (/SELECT .* FROM server_uptime_daily WHERE user_id/i.test(text)) {
        return { rows: [...daily.values()].filter(d => d.user_id === params[0]), rowCount: daily.size };
      }
      if (/SELECT .* FROM server_health_log WHERE user_id/i.test(text)) {
        return { rows: log.filter(l => l.user_id === params[0]), rowCount: log.length };
      }
      return { rows: [], rowCount: 0 };
    },
    _log: log, _daily: daily,
  };
}

(async () => {
  const db = fakeDb();
  const sh = makeServerHistory(db);

  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: true, responseMs: 100, day: '2026-06-01' });
  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: false, responseMs: null, day: '2026-06-01' });
  await sh.logCheck({ userId: 'u1', serverUrl: 'http://a', label: 'A', up: true, responseMs: 200, day: '2026-06-01' });

  A(db._log.length === 3, 'logCheck writes a raw row each call');
  const d = [...db._daily.values()][0];
  A(d.checks === 3 && d.up_checks === 2, 'daily rollup counts checks and up_checks');
  A(d.avg_ms === 150, 'daily rollup averages response_ms over successful checks only (100,200 → 150, ignoring the down check)');

  const out = await sh.listForUser('u1');
  A(Array.isArray(out.servers) && out.servers[0].url === 'http://a', 'listForUser groups by server');
  A(out.servers[0].daily.length >= 1, 'listForUser returns daily rollups per server');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
