// ─── Unit tests for lib/crypto.js ───────────────────────────────────────────
// Run with: node test/crypto.test.js

const { encrypt, decrypt, generateKey, KEY_BYTES } = require('../lib/crypto');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { console.log(`  ✓ ${msg}`); passed++; } else { console.error(`  ✗ ${msg}`); failed++; } }
function assertEqual(a, b, msg) { assert(a === b, `${msg}${a === b ? '' : ` (got ${JSON.stringify(a)})`}`); }
function assertThrows(fn, msg) { let t = false; try { fn(); } catch { t = true; } assert(t, msg); }

const KEY = generateKey();

console.log('crypto round-trip');
assertEqual(decrypt(encrypt('hello world', KEY), KEY), 'hello world', 'round-trips ASCII');
assertEqual(decrypt(encrypt('', KEY), KEY), '', 'round-trips empty string');
assertEqual(decrypt(encrypt('🔒 ключ 日本語', KEY), KEY), '🔒 ключ 日本語', 'round-trips unicode');
const long = 'x'.repeat(5000);
assertEqual(decrypt(encrypt(long, KEY), KEY), long, 'round-trips long string');

console.log('\ncrypto security properties');
const a = encrypt('same', KEY), b = encrypt('same', KEY);
assert(a !== b, 'same plaintext → different ciphertext (random IV)');
assertThrows(() => decrypt(encrypt('secret', KEY), generateKey()), 'wrong key fails to decrypt');
const blob = encrypt('secret', KEY);
const parts = blob.split(':');
const tamperedData = [parts[0], parts[1], Buffer.from('tampered').toString('base64')].join(':');
assertThrows(() => decrypt(tamperedData, KEY), 'tampered ciphertext throws (GCM auth)');
assertThrows(() => decrypt('not-a-valid-blob', KEY), 'malformed blob throws');

console.log('\ncrypto key handling');
assert(Buffer.from(generateKey(), 'base64').length === KEY_BYTES, `generateKey → ${KEY_BYTES} bytes`);
assertThrows(() => encrypt('x', Buffer.from('tooshort', 'base64')), 'rejects wrong-size key');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
