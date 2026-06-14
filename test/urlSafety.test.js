// node test/urlSafety.test.js
const { assertSafeFetchUrl, parseHttpUrl, isPrivateIp, safeAgent, safeLookup, SAFE_REDIRECT_LIMIT } = require('../lib/urlSafety');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

(async () => {
  A(isPrivateIp('127.0.0.1'), '127.0.0.1 private');
  A(isPrivateIp('10.0.0.5'), '10.x private');
  A(isPrivateIp('100.64.0.1'), 'CGNAT 100.64/10 private');
  A(isPrivateIp('100.128.0.1') === false, '100.128 (outside CGNAT) public');
  A(isPrivateIp('8.8.8.8') === false, '8.8.8.8 public');

  // SEC-6: connect-time guard wiring
  A(typeof safeAgent === 'function', 'safeAgent exported as function');
  A(safeAgent(new URL('https://x.com')) === safeAgent(new URL('https://y.com')), 'safeAgent reuses https agent');
  A(safeAgent(new URL('http://x.com')) !== safeAgent(new URL('https://x.com')), 'safeAgent picks per-protocol agent');
  A(Number.isInteger(SAFE_REDIRECT_LIMIT) && SAFE_REDIRECT_LIMIT > 0, 'redirect limit is a positive integer');
  await new Promise((resolve) => {
    safeLookup('127.0.0.1', {}, (err) => { A(err && /private/i.test(err.message), 'safeLookup rejects private literal IP'); resolve(); });
  });

  A(parseHttpUrl('https://emby.example.com/emby')?.origin === 'https://emby.example.com', 'parse https');
  A(parseHttpUrl('file:///etc/passwd') === null, 'reject file://');

  try {
    await assertSafeFetchUrl('http://127.0.0.1', 'url');
    A(false, 'block loopback');
  } catch (e) {
    A(/private|blocked/i.test(e.message), 'block loopback throws');
  }

  try {
    await assertSafeFetchUrl('http://localhost', 'url');
    A(false, 'block localhost name');
  } catch (e) {
    A(/not allowed|blocked/i.test(e.message), 'block localhost throws');
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();