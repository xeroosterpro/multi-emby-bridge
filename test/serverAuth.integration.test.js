'use strict';
// Integration tests for production auth gates on /api/* routes.
// Spawns a real server process so Stremio /:config/* routes stay unaffected.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 17999;

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
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
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
      NODE_ENV: 'production',
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
        name: 'GET /health stays public',
        method: 'GET',
        path: '/health',
        body: null,
        expect: 200,
      },
      {
        name: 'POST /api/test-connection requires auth in production',
        method: 'POST',
        path: '/api/test-connection',
        body: { url: 'http://127.0.0.1', apiKey: 'k', userId: 'u' },
        expect: 401,
      },
      {
        name: 'POST /api/fetch-credentials requires auth in production',
        method: 'POST',
        path: '/api/fetch-credentials',
        body: { url: 'https://example.com', username: 'u', password: 'p' },
        expect: 401,
      },
    ];

    for (const c of cases) {
      const r = await httpRequest(TEST_PORT, c.method, c.path, c.body);
      try {
        assert.strictEqual(r.status, c.expect, `${c.name} — got ${r.status}: ${r.body}`);
        console.log(`  ✓ ${c.name}`);
      } catch (e) {
        failed = true;
        console.error(`  ✗ ${e.message}`);
      }
    }

    if (failed) process.exit(1);
    console.log('serverAuth.integration.test.js: all passed');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await cleanup();
  }
})();