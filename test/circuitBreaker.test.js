// ─── Unit tests for lib/circuitBreaker.js (injected clock, no randomness) ────
// Run with: node test/circuitBreaker.test.js
const { makeCircuitBreaker } = require('../lib/circuitBreaker');

let passed = 0, failed = 0;
const A = (c, m) => { c ? (console.log(`  ✓ ${m}`), passed++) : (console.error(`  ✗ ${m}`), failed++); };

(function () {
  let t = 1000;
  const cb = makeCircuitBreaker({
    failureThreshold: 3,
    baseCooldownMs: 1000,
    maxCooldownMs: 8000,
    jitterRatio: 0,            // deterministic
    now: () => t,
    random: () => 0,
  });
  const K = 'srv|u1';

  A(cb.allow(K) === true, 'starts closed (allow)');
  A(cb.state(K) === 'closed', 'starts closed (state)');

  cb.onFailure(K); cb.onFailure(K);
  A(cb.allow(K) === true, 'still closed below threshold');

  cb.onFailure(K); // 3rd failure → open
  A(cb.state(K) === 'open', 'opens at threshold');
  A(cb.allow(K) === false, 'open → fast-fail (disallow)');
  A(cb.retryAfterMs(K) === 1000, 'first cooldown = base (1000ms)');

  t += 1000; // cooldown elapsed
  A(cb.state(K) === 'half-open', 'becomes half-open after cooldown');
  A(cb.allow(K) === true, 'half-open allows one probe');

  cb.onFailure(K); // probe fails → escalate, longer cooldown
  A(cb.state(K) === 'open', 're-opens after failed probe');
  A(cb.retryAfterMs(K) === 2000, 'cooldown doubled (2000ms)');

  t += 2000;
  A(cb.allow(K) === true, 'probe allowed again');
  cb.onSuccess(K); // probe succeeds → fully closed + reset
  A(cb.state(K) === 'closed', 'closes on successful probe');
  A(cb.retryAfterMs(K) === 0, 'no cooldown when closed');

  // success resets the escalation: needs threshold failures again to reopen
  cb.onFailure(K); cb.onFailure(K);
  A(cb.allow(K) === true, 'failure count reset after success');

  // independent keys
  const K2 = 'srv|u2';
  A(cb.allow(K2) === true, 'unrelated key unaffected');

  // exponential cap
  const cb2 = makeCircuitBreaker({ failureThreshold: 1, baseCooldownMs: 1000, maxCooldownMs: 4000, jitterRatio: 0, now: () => t, random: () => 0 });
  cb2.onFailure('x'); A(cb2.retryAfterMs('x') === 1000, 'cap: cycle1 = 1000');
  t += 1000; cb2.onFailure('x'); A(cb2.retryAfterMs('x') === 2000, 'cap: cycle2 = 2000');
  t += 2000; cb2.onFailure('x'); A(cb2.retryAfterMs('x') === 4000, 'cap: cycle3 = 4000 (capped)');
  t += 4000; cb2.onFailure('x'); A(cb2.retryAfterMs('x') === 4000, 'cap: cycle4 stays at max 4000');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
