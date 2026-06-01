// ─── Unit tests for lib/users.js (fake DB) ──────────────────────────────────
// Run with: node test/users.test.js
const { makeUsers } = require('../lib/users');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const rows = [];
  return { async query(text, params) {
    if (/INSERT INTO users/i.test(text)) {
      const [u, h, r] = params;
      if (rows.find(x => x.username === u)) { const e = new Error('dup'); e.code = '23505'; throw e; }
      const row = { id: 'id' + (rows.length + 1), username: u, password_hash: h, role: r, created_at: new Date() };
      rows.push(row); return { rows: [row], rowCount: 1 };
    }
    if (/SELECT \* FROM users WHERE username/i.test(text)) {
      const r = rows.find(x => x.username === params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    if (/UPDATE users SET last_seen/i.test(text)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
}

(async () => {
  const users = makeUsers(fakeDb());
  const u = await users.create('alice', 'plaintext-pw', 'user');
  A(u.username === 'alice', 'create returns user');
  A(u.password_hash.startsWith('scrypt$'), 'plaintext password gets hashed');
  const found = await users.findByUsername('alice');
  A(found && found.id === u.id, 'findByUsername resolves');
  A(await users.findByUsername('nobody') === null, 'unknown user → null');
  let dup = false; try { await users.create('alice', 'x', 'user'); } catch { dup = true; }
  A(dup, 'duplicate username rejected (unique violation)');
  const pre = await users.create('bob', 'scrypt$already$hashed$value$here', 'admin');
  A(pre.password_hash === 'scrypt$already$hashed$value$here', 'pre-hashed value stored as-is');
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
