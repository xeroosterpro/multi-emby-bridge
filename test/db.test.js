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

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
