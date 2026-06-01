// ─── Unit tests for lib/accounts.js ─────────────────────────────────────────
// Run with: node test/accounts.test.js

const { hashPassword, verifyPassword, generateSessionToken, hashToken } = require('../lib/accounts');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { console.log(`  ✓ ${msg}`); passed++; } else { console.error(`  ✗ ${msg}`); failed++; } }
function assertThrows(fn, msg) { let t = false; try { fn(); } catch { t = true; } assert(t, msg); }

console.log('password hashing');
const h = hashPassword('s3cret-pass');
assert(h.startsWith('scrypt$'), 'hash has scrypt prefix');
assert(h.split('$').length === 6, 'hash has all fields');
assert(hashPassword('same') !== hashPassword('same'), 'same password → different hash (random salt)');

console.log('\npassword verification');
assert(verifyPassword('s3cret-pass', h) === true, 'correct password verifies');
assert(verifyPassword('wrong', h) === false, 'wrong password rejected');
assert(verifyPassword('s3cret-pass', 'garbage') === false, 'malformed hash → false (no throw)');
assert(verifyPassword('', h) === false, 'empty password rejected');
assertThrows(() => hashPassword(''), 'empty password cannot be hashed');

console.log('\nsession tokens');
const t1 = generateSessionToken(), t2 = generateSessionToken();
assert(t1 !== t2, 'session tokens are unique');
assert(/^[A-Za-z0-9_-]+$/.test(t1), 'token is url-safe');
assert(hashToken(t1) === hashToken(t1), 'hashToken is deterministic');
assert(hashToken(t1) !== t1, 'stored hash differs from raw token');
assert(hashToken(t1).length === 64, 'token hash is sha256 hex (64 chars)');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
