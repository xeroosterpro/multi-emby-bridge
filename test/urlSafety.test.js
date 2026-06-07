// node test/urlSafety.test.js
const { assertSafeFetchUrl, parseHttpUrl, isPrivateIp } = require('../lib/urlSafety');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

(async () => {
  A(isPrivateIp('127.0.0.1'), '127.0.0.1 private');
  A(isPrivateIp('10.0.0.5'), '10.x private');
  A(isPrivateIp('8.8.8.8') === false, '8.8.8.8 public');

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