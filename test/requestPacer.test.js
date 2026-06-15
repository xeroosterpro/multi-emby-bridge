'use strict';
const assert = require('assert');
const { schedule, getPacingStats, resetPacingStats } = require('../lib/requestPacer');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(async function main() {
  resetPacingStats();
  let calls = 0;
  const p1 = schedule('host1', 'url-a', async () => { calls++; return 'a'; });
  const p2 = schedule('host1', 'url-a', async () => { calls++; return 'b'; });
  const [r1, r2] = await Promise.all([p1, p2]);
  A(r1 === 'a' && r2 === 'a', 'dedup shares result');
  A(calls === 1, 'dedup only runs once');
  const stats = getPacingStats();
  A(stats.coalesced >= 1, 'coalesced counted');
  console.log('\nrequestPacer.test.js: all passed');
})();