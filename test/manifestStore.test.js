// ─── Unit tests for lib/manifestStore.js (fake DB) ──────────────────────────
// Run with: node test/manifestStore.test.js
const { makeManifestStore } = require('../lib/manifestStore');
let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

function fakeDb() {
  const rows = [];
  return { async query(text, params) {
    if (/INSERT INTO manifest_tokens/i.test(text)) { rows.push({ token: params[0], user_id: params[1], revoked_at: null, created_at: Date.now() + rows.length }); return { rowCount: 1, rows: [] }; }
    if (/UPDATE manifest_tokens SET revoked_at.*WHERE token=/i.test(text)) { const r = rows.find(x => x.token === params[0] && !x.revoked_at); if (r) { r.revoked_at = Date.now(); return { rowCount: 1 }; } return { rowCount: 0 }; }
    if (/UPDATE manifest_tokens SET revoked_at.*WHERE user_id=/i.test(text)) { rows.forEach(x => { if (x.user_id === params[0] && !x.revoked_at) x.revoked_at = Date.now(); }); return { rowCount: 1 }; }
    if (/SELECT \* FROM manifest_tokens WHERE token=/i.test(text)) { const r = rows.find(x => x.token === params[0] && !x.revoked_at); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
    if (/SELECT token FROM manifest_tokens WHERE user_id=/i.test(text)) { const act = rows.filter(x => x.user_id === params[0] && !x.revoked_at).sort((a, b) => b.created_at - a.created_at); return { rows: act.length ? [{ token: act[0].token }] : [], rowCount: act.length ? 1 : 0 }; }
    return { rows: [], rowCount: 0 };
  } };
}

(async () => {
  const store = makeManifestStore(fakeDb());
  const t = await store.issue('u1');
  A(typeof t === 'string' && t.length > 20, 'issue returns token');
  A((await store.lookup(t)).user_id === 'u1', 'lookup resolves to user');
  A(await store.current('u1') === t, 'current returns the active token');
  A(await store.revoke(t) === true, 'revoke succeeds');
  A(await store.lookup(t) === null, 'revoked token no longer resolves');
  A(await store.revoke(t) === false, 're-revoke returns false');

  const old = await store.issue('u2');
  const fresh = await store.regenerate('u2');
  A(old !== fresh, 'regenerate issues a new token');
  A(await store.lookup(old) === null, 'old token invalidated by regenerate');
  A((await store.lookup(fresh)).user_id === 'u2', 'new token resolves');
  A(await store.current('u2') === fresh, 'current reflects the regenerated token');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
