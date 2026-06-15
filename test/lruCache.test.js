// ─── Unit tests for lib/lruCache.js (injected clock) ────────────────────────
// Run with: node test/lruCache.test.js
const { makeLruCache } = require('../lib/lruCache');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

// basic set/get
let t = 0;
const c = makeLruCache({ max: 3, ttlMs: 100, now: () => t });
c.set('a', 1);
A(c.get('a') === 1, 'set then get');
A(c.get('missing') === undefined, 'missing key → undefined');
A(c.has('a') === true && c.has('missing') === false, 'has() reflects presence');

// TTL expiry
t = 50; A(c.get('a') === 1, 'within TTL still present');
t = 101; A(c.get('a') === undefined, 'expired after TTL');

// max-size eviction (oldest out)
const c2 = makeLruCache({ max: 3, ttlMs: 0, now: () => 0 });
c2.set('a', 1); c2.set('b', 2); c2.set('c', 3);
c2.set('d', 4); // evicts 'a'
A(c2.get('a') === undefined, 'oldest evicted at capacity');
A(c2.get('b') === 2 && c2.get('c') === 3 && c2.get('d') === 4, 'newer keys retained');
A(c2.size === 3, 'size capped at max');

// recency: reading 'b' protects it from next eviction
c2.get('b');           // b is now most-recent
c2.set('e', 5);        // evicts least-recent, which is now 'c' (not 'b')
A(c2.get('b') === 2, 'recently-read key survives eviction');
A(c2.get('c') === undefined, 'least-recently-used evicted');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
