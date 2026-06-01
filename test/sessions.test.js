// ─── Unit tests for lib/sessions.js (fake DB) ───────────────────────────────
// Run with: node test/sessions.test.js
const { makeSessions } = require('../lib/sessions');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const rows = [];
  return { async query(text, params) {
    if (/INSERT INTO sessions/i.test(text)) {
      const [uid, th, exp] = params;
      const row = { id: 's' + (rows.length + 1), user_id: uid, token_hash: th, expires_at: exp };
      rows.push(row); return { rows: [row], rowCount: 1 };
    }
    if (/FROM sessions/i.test(text) && /token_hash\s*=\s*\$1/i.test(text) && /SELECT/i.test(text)) {
      const r = rows.find(x => x.token_hash === params[0]);
      return { rows: r ? [{ ...r, username: 'alice', role: 'user' }] : [], rowCount: r ? 1 : 0 };
    }
    if (/DELETE FROM sessions/i.test(text)) {
      const i = rows.findIndex(x => x.token_hash === params[0]); if (i >= 0) rows.splice(i, 1);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
}

(async () => {
  const sessions = makeSessions(fakeDb());
  const { token } = await sessions.create('user-1');
  A(typeof token === 'string' && token.length > 20, 'create returns a raw token');
  const s = await sessions.lookup(token);
  A(s && s.user_id === 'user-1', 'lookup resolves by raw token');
  A(s && s.username === 'alice', 'lookup joins user fields');
  A(await sessions.lookup('bogus') === null, 'unknown token → null');
  A(await sessions.lookup('') === null, 'empty token → null');
  await sessions.destroy(token);
  A(await sessions.lookup(token) === null, 'destroyed token no longer resolves');
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
