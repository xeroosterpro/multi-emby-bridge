'use strict';
// Integration tests: SSRF guard blocks private URLs on server-facing API routes.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 17997;

function httpRequest(port, method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(buf); } catch { /* non-json */ }
        resolve({ status: res.statusCode, body: buf, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await httpRequest(port, 'GET', '/health');
      if (r.status === 200) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server on port ${port} did not become healthy`);
}

function startServer(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      DATABASE_URL: '',
      DATA_DIR: path.join(ROOT, 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

(async () => {
  const child = startServer(TEST_PORT);
  let failed = false;

  const cleanup = () => new Promise((resolve) => {
    if (!child.killed) child.kill('SIGTERM');
    setTimeout(resolve, 500);
  });

  try {
    await waitForHealth(TEST_PORT);

    const cases = [
      {
        name: 'POST /api/fetch-credentials blocks loopback URL',
        method: 'POST',
        path: '/api/fetch-credentials',
        body: { url: 'http://127.0.0.1:8096', username: 'u', password: 'p' },
        expect: 400,
        errIncludes: ['private', 'blocked'],
      },
      {
        name: 'POST /api/test-connection blocks localhost URL',
        method: 'POST',
        path: '/api/test-connection',
        body: {
          url: 'http://localhost:8096',
          type: 'emby',
          apiKey: 'fake',
          userId: 'fake',
        },
        expect: 400,
        errIncludes: ['private', 'host not allowed', 'blocked'],
      },
      {
        name: 'POST /api/library-stats blocks 10.x private URL',
        method: 'POST',
        path: '/api/library-stats',
        body: {
          url: 'http://10.0.0.5:8096',
          type: 'emby',
          apiKey: 'fake',
          userId: 'fake',
        },
        expect: 400,
        errIncludes: ['private', 'blocked'],
      },
    ];

    for (const c of cases) {
      const r = await httpRequest(TEST_PORT, c.method, c.path, c.body);
      try {
        assert.strictEqual(r.status, c.expect, `${c.name} — got ${r.status}: ${r.body}`);
        const err = (r.json.error || r.body || '').toLowerCase();
        const needles = Array.isArray(c.errIncludes) ? c.errIncludes : [c.errIncludes];
        assert.ok(needles.some((n) => err.includes(n)), `${c.name} — error should mention one of [${needles.join(', ')}], got: ${r.body}`);
        console.log(`  ✓ ${c.name}`);
      } catch (e) {
        failed = true;
        console.error(`  ✗ ${e.message}`);
      }
    }

    if (failed) process.exit(1);
    console.log('apiSsrf.integration.test.js: all passed');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await cleanup();
  }
})();