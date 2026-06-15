'use strict';
const assert = require('assert');
const { schedule, coalesceStream, getPacingStats, resetPacingStats } = require('../lib/requestPacer');

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

  resetPacingStats();
  let order = [];
  const slow = (tag, ms) => schedule('host2', `key-${tag}`, async () => {
    await new Promise((r) => setTimeout(r, ms));
    order.push(tag);
    return tag;
  });
  await Promise.all([slow('a', 30), slow('b', 10), slow('c', 10)]);
  A(order[0] === 'a', 'FIFO: first enqueued runs first');

  resetPacingStats();
  let superseded = false;
  const pSlow = coalesceStream('cfg1', 'movie/tt1', async () => {
    await new Promise((r) => setTimeout(r, 200));
    return 'slow';
  });
  await new Promise((r) => setTimeout(r, 20));
  try {
    await coalesceStream('cfg1', 'movie/tt2', async () => 'fast');
  } catch (err) {
    superseded = !!err.superseded;
  }
  try { await pSlow; } catch (err) { superseded = superseded || !!err.superseded; }
  A(superseded, 'rapid scroll superseded prior lookup');

  console.log('\nrequestPacer.test.js: all passed');
})();