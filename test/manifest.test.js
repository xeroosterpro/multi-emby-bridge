// ─── Unit tests for lib/manifest.js ─────────────────────────────────────────
// Run with: node test/manifest.test.js

const { generateToken, isValidTokenFormat, createMemoryStore, hasActiveAccess } = require('../lib/manifest');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { console.log(`  ✓ ${msg}`); passed++; } else { console.error(`  ✗ ${msg}`); failed++; } }
function assertEqual(a, b, msg) { assert(a === b, `${msg}${a === b ? '' : ` (got ${JSON.stringify(a)})`}`); }

console.log('token generation');
const t1 = generateToken(), t2 = generateToken();
assert(t1 !== t2, 'tokens are unique');
assert(isValidTokenFormat(t1), 'generated token passes format check');
assert(!isValidTokenFormat('short'), 'rejects too-short token');
assert(!isValidTokenFormat('has spaces!!'), 'rejects invalid chars');
assert(!isValidTokenFormat(null), 'rejects null');

console.log('\nmemory store: issue / lookup / revoke');
const store = createMemoryStore();
const tok = store.issue('user-1');
assert(isValidTokenFormat(tok), 'issue returns a valid token');
assertEqual(store.lookup(tok).userId, 'user-1', 'lookup resolves to the user');
assertEqual(store.lookup('nonexistent'), null, 'unknown token → null');
assertEqual(store.revoke(tok), true, 'revoke succeeds');
assertEqual(store.lookup(tok), null, 'revoked token no longer resolves');
assertEqual(store.revoke(tok), false, 're-revoking returns false');

console.log('\nmemory store: regenerate invalidates old token');
const store2 = createMemoryStore();
const old = store2.issue('user-2');
const fresh = store2.regenerate('user-2');
assert(old !== fresh, 'regenerate issues a different token');
assertEqual(store2.lookup(old), null, 'old token is invalidated immediately');
assertEqual(store2.lookup(fresh).userId, 'user-2', 'new token resolves');

console.log('\naccess gate (stub until billing)');
assertEqual(hasActiveAccess({ status: 'none' }), true, 'stub allows access (billing not yet enforced)');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
