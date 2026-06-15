// ─── Unit tests for lib/logger.js (captured output, fixed clock) ────────────
// Run with: node test/logger.test.js
const { createLogger, redact } = require('../lib/logger');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

const lines = [];
const lg = createLogger({ level: 'info', now: () => 'T', write: (l) => lines.push(l), errWrite: (l) => lines.push(l) });

lg.debug('nope');
A(lines.length === 0, 'debug below info threshold is dropped');

lg.info('hello');
const r1 = JSON.parse(lines[0]);
A(r1.level === 'info' && r1.msg === 'hello' && r1.time === 'T', 'info line shape (level/msg/time)');

lg.info({ a: 1, b: 'two' }, 'with fields');
const r2 = JSON.parse(lines[1]);
A(r2.a === 1 && r2.b === 'two' && r2.msg === 'with fields', 'fields + message merged');

lg.error({ apiKey: 'SECRET', nested: { password: 'x', ok: 1 }, list: [{ token: 't' }] }, 'redact');
const r3 = JSON.parse(lines[2]);
A(r3.apiKey === '[redacted]', 'redacts top-level secret');
A(r3.nested.password === '[redacted]' && r3.nested.ok === 1, 'redacts nested secret, keeps safe field');
A(r3.list[0].token === '[redacted]', 'redacts secrets inside arrays');

const child = lg.child({ reqId: 'R1' });
child.info('c');
A(JSON.parse(lines[3]).reqId === 'R1', 'child bindings are included');

lg.error({ err: new Error('boom') }, 'oops');
const r5 = JSON.parse(lines[4]);
A(r5.err.message === 'boom' && typeof r5.err.stack === 'string', 'Error objects are serialized (message+stack)');

A(redact({ token: 't', x: 2 }).token === '[redacted]' && redact({ token: 't', x: 2 }).x === 2, 'redact() helper works standalone');

// circular references don't throw
lg.info((() => { const o = { name: 'x' }; o.self = o; return o; })(), 'circular');
A(lines.length === 6, 'circular structure logged without throwing');

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
