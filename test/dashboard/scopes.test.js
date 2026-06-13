const assert = require('assert');
const { parseScope, scopeNeeds, VALID_SCOPES } = require('../../lib/dashboard/scopes');

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

A(VALID_SCOPES.has('full'), 'full is valid scope');
A(VALID_SCOPES.has('live'), 'live is valid scope');
A(parseScope('LIVE') === 'live', 'parseScope normalizes case');
A(parseScope('bogus') === 'full', 'unknown scope defaults to full');
A(scopeNeeds('full', 'live') === true, 'full needs all parts');
A(scopeNeeds('live', 'live') === true, 'live scope needs live');
A(scopeNeeds('live', 'stats') === false, 'live scope skips stats');
A(scopeNeeds('stats', 'stats') === true, 'stats scope needs stats');
A(scopeNeeds('health', 'health') === true, 'health scope needs health');

console.log('\ndashboard/scopes.test.js: all passed');