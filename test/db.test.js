// ─── Unit tests for lib/db.js ───────────────────────────────────────────────
// Run with: node test/db.test.js
let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

const saved = process.env.DATABASE_URL;

delete process.env.DATABASE_URL;
delete require.cache[require.resolve('../lib/db')];
assert(require('../lib/db').isConfigured() === false, 'isConfigured false when DATABASE_URL unset');

process.env.DATABASE_URL = 'postgres://user:pw@host:5432/db';
delete require.cache[require.resolve('../lib/db')];
assert(require('../lib/db').isConfigured() === true, 'isConfigured true when DATABASE_URL set');

if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;

// ─── _runTx: BEGIN/COMMIT on success, ROLLBACK on error ─────────────────────
delete require.cache[require.resolve('../lib/db')];
const { _runTx } = require('../lib/db');

function fakeClient() {
  const calls = [];
  return { calls, async query(t) { calls.push(String(t).split(/\s/)[0].toUpperCase()); return { rows: [], rowCount: 0 }; } };
}

(async () => {
  const ok = fakeClient();
  const ret = await _runTx(ok, async (c) => { await c.query('INSERT INTO x VALUES(1)'); return 42; });
  assert(ret === 42, '_runTx returns fn result');
  assert(ok.calls.join(',') === 'BEGIN,INSERT,COMMIT', '_runTx commits on success (BEGIN→work→COMMIT)');

  const bad = fakeClient();
  let threw = false;
  try { await _runTx(bad, async () => { throw new Error('boom'); }); } catch (e) { threw = e.message === 'boom'; }
  assert(threw, '_runTx re-throws the error');
  assert(bad.calls.join(',') === 'BEGIN,ROLLBACK', '_runTx rolls back on error (BEGIN→ROLLBACK)');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
