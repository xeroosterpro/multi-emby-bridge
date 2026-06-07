'use strict';
const assert = require('assert');
const {
  isProduction,
  requireAuthInProduction,
  CONFIGURE_CSP,
  applyConfigureSecurityHeaders,
} = require('../lib/security');

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

withEnv({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT: undefined }, () => {
  assert.strictEqual(isProduction(), false);
});

withEnv({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT: undefined }, () => {
  assert.strictEqual(isProduction(), true);
});

withEnv({ NODE_ENV: 'development', RAILWAY_ENVIRONMENT: 'production' }, () => {
  assert.strictEqual(isProduction(), true);
});

withEnv({ NODE_ENV: 'production' }, () => {
  let status;
  const res = { status: (c) => { status = c; return res; }, json: () => res };
  const next = () => { status = 'next'; };
  requireAuthInProduction({ user: null }, res, next);
  assert.strictEqual(status, 401);
  requireAuthInProduction({ user: { id: 1 } }, res, next);
  assert.strictEqual(status, 'next');
});

withEnv({ NODE_ENV: 'development' }, () => {
  let called = false;
  requireAuthInProduction({ user: null }, {}, () => { called = true; });
  assert.strictEqual(called, true);
});

assert.ok(CONFIGURE_CSP.includes("default-src 'self'"));
assert.ok(CONFIGURE_CSP.includes("script-src 'self'"));

const headers = {};
applyConfigureSecurityHeaders({ setHeader: (k, v) => { headers[k] = v; } });
assert.ok(headers['Content-Security-Policy']);
assert.strictEqual(headers['X-Frame-Options'], 'DENY');

console.log('security.test.js: all passed');