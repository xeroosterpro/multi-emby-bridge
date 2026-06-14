'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 17998;

const ASSETS = [
  '/configure',
  '/js/configure/state.js',
  '/js/configure/ui-helpers.js',
  '/js/configure/servers-config.js',
  '/js/configure/account-bootstrap.js',
  '/js/configure/dashboard-fetch.js',
  '/js/configure/dashboard-shared.js',
  '/js/configure/dashboard-health.js',
  '/js/configure/dashboard-library.js',
  '/js/configure/dashboard-cards.js',
  '/js/configure/dashboard-live.js',
  '/js/configure/dashboard-activity.js',
  '/js/configure/dashboard-bundle.js',
  '/js/configure/dashboard-render.js',
  '/js/configure/servers-page.js',
  '/js/configure/dashboard-page.js',
  '/js/configure.js',
  '/js/configure/form-state.js',
  '/js/configure/profile-credentials.js',
  '/js/configure/streaming-settings.js',
  '/js/configure/request-log.js',
  '/js/configure/install.js',
];

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
      res.on('end', () => resolve({ status: res.statusCode, body: buf, headers: res.headers }));
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

    const page = await httpGet(TEST_PORT, '/configure');
    A(page.status === 200, 'GET /configure returns 200');
    A(page.body.includes('servers-container'), '/configure includes servers UI');
    for (const src of ASSETS.slice(1)) {
      A(new RegExp(`src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?v=[^"]+)?"`).test(page.body),
        `/configure references ${src}`);
    }

    for (const asset of ASSETS) {
      const r = await httpGet(TEST_PORT, asset);
      A(r.status === 200, `GET ${asset} returns 200`);
      if (asset.endsWith('.js')) {
        A((r.headers['content-type'] || '').includes('javascript'), `${asset} served as JS`);
        A(r.body.length > 50, `${asset} has body`);
      }
    }

    const cfg = await httpGet(TEST_PORT, '/js/configure.js');
    A(!cfg.body.includes('// ── Generate links'), 'served configure.js has no install duplicate');
    A(!cfg.body.includes('function saveProfile'), 'served configure.js has no profile-credentials duplicate');
    A(!cfg.body.includes('function collectFormState'), 'served configure.js has no form-state duplicate');
    A(!cfg.body.includes('function collectConfig'), 'served configure.js has no servers-config duplicate');

    const helpers = await httpGet(TEST_PORT, '/js/configure/ui-helpers.js');
    A(helpers.body.includes('window.escHtml = escHtml'), 'ui-helpers.js exports escHtml');

    const form = await httpGet(TEST_PORT, '/js/configure/form-state.js');
    A(form.body.includes('window.autoSave = autoSave'), 'form-state.js exports autoSave');

    const prof = await httpGet(TEST_PORT, '/js/configure/profile-credentials.js');
    A(prof.body.includes('window.fetchCredentials = fetchCredentials'), 'profile-credentials.js exports fetchCredentials');

    console.log('\nconfigurePage.integration.test.js: all passed');
    await cleanup();
    process.exit(0);
  } catch (e) {
    console.error(e);
    await cleanup();
    process.exit(1);
  }
})();