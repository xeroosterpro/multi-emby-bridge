'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { encodeConfig } = require('../lib/configCodec');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 17996;

function httpGet(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method: 'GET',
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
    req.end();
  });
}

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await httpGet(port, '/health');
      if (r.status === 200) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server on port ${port} did not become healthy`);
}

function startServer(port) {
  return spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      DATABASE_URL: '',
      DATA_DIR: path.join(ROOT, 'data'),
      HEALTH_PINGER_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(async () => {
  const child = startServer(TEST_PORT);
  const cleanup = () => new Promise((resolve) => {
    if (!child.killed) child.kill('SIGTERM');
    setTimeout(resolve, 500);
  });

  try {
    await waitForHealth(TEST_PORT);
    const cfg = encodeConfig({ servers: [], streamProfile: 4 });
    const manifest = await httpGet(TEST_PORT, `/${cfg}/manifest.json`);
    A(manifest.status === 200, 'manifest returns 200');
    A(manifest.json.id === 'com.multiemby.bridge', 'manifest has addon id');

    const streams = await httpGet(TEST_PORT, `/${cfg}/stream/movie/tt0111161.json`);
    A(streams.status === 200, 'stream endpoint returns 200');
    A(Array.isArray(streams.json.streams), 'stream response has streams array');
    A(streams.json.streams.length === 0, 'empty config yields no streams');

    const series = await httpGet(TEST_PORT, `/${cfg}/stream/series/tt0944947:1:1.json`);
    A(series.json.streams.length === 0, 'series with no servers yields no streams');

    console.log('\nstremio.stream.integration.test.js: all passed');
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await cleanup();
  }
})();