// Run with: node test/requestLog.test.js
const { makeRequestLog } = require('../lib/requestLog');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const rows = []; let id = 1;
  // Mimic pg's jsonb behaviour: params for best_file/server_status arrive as JSON
  // strings and are read back as parsed objects.
  const parse = v => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v));
  return {
    async query(text, params) {
      if (/INSERT INTO request_log/i.test(text)) {
        rows.unshift({
          id: id++, user_id: params[0], ts: params[1] || new Date().toISOString(), type: params[2],
          imdb_id: params[3], content_name: params[4], best_server: params[5],
          best_file: parse(params[6]), server_status: parse(params[7]),
          season: params[8], episode: params[9], response_ms: params[10], found: params[11],
        });
        return { rowCount: 1, rows: [] };
      }
      if (/SELECT .* FROM request_log WHERE user_id/i.test(text)) {
        return { rows: rows.filter(r => r.user_id === params[0]).slice(0, 50) };
      }
      if (/SELECT .* FROM request_log\b/i.test(text)) {
        return { rows: rows.slice(0, params && params[0] ? params[0] : 50) };
      }
      return { rows: [], rowCount: 0 };
    },
    _rows: rows,
  };
}

(async () => {
  const db = fakeDb();
  const rl = makeRequestLog(db);
  await rl.record({ userId: 'u1', type: 'movie', imdbId: 'tt1', contentName: 'Dune', bestServer: 'ARCTV', season: null, episode: null, ms: 300, found: true });
  await rl.record({ userId: 'u2', type: 'series', imdbId: 'tt2', contentName: 'Heat', bestServer: 'EAGLE', season: 1, episode: 2, ms: 500, found: true });
  A(db._rows.length === 2, 'record inserts rows');
  A(db._rows[0].content_name === 'Heat' && db._rows[0].season === 1, 'maps fields incl season/episode');

  const recent = await rl.recent(10);
  A(Array.isArray(recent) && recent.length === 2, 'recent returns rows');
  A(recent[0].title === 'Heat' && recent[0].server === 'EAGLE' && recent[0].ms === 500, 'recent maps to {title,server,ms,...} shape');

  const mine = await rl.forUser('u1');
  A(mine.length === 1 && mine[0].title === 'Dune', 'forUser filters + maps to title/server shape');

  // ── rich best-file + per-server breakdown round-trip (the "results" the log page renders) ──
  const best = { label: 'BK', size: 1234567, bitrate: 8000000 };
  const status = [
    { status: 'found', label: 'BK', size: 1234567, bitrate: 8000000, count: 3 },
    { status: 'not_found', label: 'ARCTV' },
    { status: 'offline', label: 'EAGLE' },
  ];
  await rl.record({ userId: 'u1', type: 'movie', imdbId: 'tt9', contentName: 'GOAT', bestServer: best, serverStatus: status, ms: 420, found: true });

  // best_server column still stores the plain label (admin "busiest server" stats depend on it)
  A(db._rows[0].best_server === 'BK', 'object bestServer: best_server column stores the label string');

  const r2 = await rl.recent(10);
  const goat = r2.find(e => e.title === 'GOAT');
  A(!!goat, 'rich row returned by recent()');
  A(goat.server === 'BK', 'mapRow.server is the label string (for adminStats)');
  A(goat.bestFile && goat.bestFile.size === 1234567 && goat.bestFile.bitrate === 8000000, 'mapRow.bestFile carries size + bitrate');
  A(Array.isArray(goat.serverStatus) && goat.serverStatus.length === 3 && goat.serverStatus[0].status === 'found', 'mapRow.serverStatus carries the per-server array');

  // string bestServer (legacy / no detail) yields null bestFile, not a broken object
  const dune = r2.find(e => e.title === 'Dune');
  A(dune.bestFile === null && dune.serverStatus === null, 'string bestServer → bestFile/serverStatus null');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
