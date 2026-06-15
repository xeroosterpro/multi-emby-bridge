'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'configure.html');
const CFG_JS = path.join(ROOT, 'public', 'js', 'configure.js');

const REQUIRED_MODULES = [
  '/js/configure/state.js',
  '/js/configure/ui-helpers.js',
  '/js/configure/servers-config.js',
  '/js/configure/account-bootstrap.js',
  '/js/configure/audio-formats-data.js',
  '/js/configure/servers-page.js',
  '/js/configure.js',
  '/js/configure/form-state.js',
  '/js/configure/profile-credentials.js',
  '/js/configure/streaming-settings.js',
  '/js/configure/install.js',
  '/js/configure/debug.js',
];

const GLOBAL_HANDLERS = [
  'saveProfile',
  'loadProfile',
  'exportConfig',
  'importConfig',
  'updateCredWarning',
  'fetchCredentials',
  'testConnection',
];

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const cfg = fs.readFileSync(CFG_JS, 'utf8');
  const cfgLines = cfg.split(/\r?\n/).length;

  A(cfgLines < 160, `configure.js orchestrator is slim (${cfgLines} lines)`);
  A(!cfg.includes('// ── Generate links'), 'install block not duplicated in configure.js');
  A(!cfg.includes('function saveProfile'), 'profile-credentials not duplicated in configure.js');
  A(!cfg.includes('function collectFormState'), 'form-state not duplicated in configure.js');
  A(!cfg.includes('function collectConfig'), 'servers-config not duplicated in configure.js');
  A(cfg.includes('window.onPageShow'), 'orchestrator keeps onPageShow');
  A(html.includes('data-page="servers"'), 'configure.html has servers nav');
  A(html.includes('data-page="streaming"'), 'configure.html has media sources nav');
  A(html.includes('data-page="install"'), 'configure.html has install nav');
  A(html.includes('data-page="debug"'), 'configure.html has debug nav');
  A(html.includes('id="page-debug"'), 'configure.html has debug page section');
  A(html.includes('id="dbg-categories"'), 'configure.html has debug category grouping');
  A(!html.includes('data-page="dashboard"'), 'configure.html omits dashboard nav');
  A(!html.includes('dashboard-fetch.js'), 'configure.html omits dashboard scripts');

  const scriptTags = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(m => m[1]);
  A(scriptTags.findIndex(s => s === '/js/configure.js') >= 0, 'configure.js is referenced');

  for (const mod of REQUIRED_MODULES) {
    A(html.includes(`src="${mod}"`), `configure.html loads ${mod}`);
    const disk = path.join(ROOT, 'public', mod.replace(/^\//, '').replace(/\//g, path.sep));
    A(fs.existsSync(disk), `file exists: ${mod}`);
    const body = fs.readFileSync(disk, 'utf8');
    A(body.length > 20, `${mod} is non-empty`);
  }

  const order = (src) => scriptTags.indexOf(src);
  A(order('/js/configure/account-bootstrap.js') < order('/js/configure/audio-formats-data.js'),
    'account-bootstrap.js loads before audio-formats-data.js');
  A(order('/js/configure/audio-formats-data.js') < order('/js/configure/servers-page.js'),
    'audio-formats-data.js loads before servers-page.js');
  A(order('/js/configure.js') < order('/js/configure/form-state.js'),
    'configure.js loads before form-state.js');
  A(order('/js/configure/profile-credentials.js') < order('/js/configure/install.js'),
    'profile-credentials.js loads before install.js');
  A(order('/js/configure/install.js') < order('/js/configure/debug.js'),
    'install.js loads before debug.js');
  A(cfg.includes("name === 'debug'"), 'configure.js handles debug tab');

  const account = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'account-bootstrap.js'), 'utf8');
  A(account.includes('window.MEB_getAuth = getAuth'), 'account-bootstrap.js exports MEB_getAuth');
  A(!account.includes('/api/site-config'), 'account-bootstrap.js does not boot site-config');

  const formState = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'form-state.js'), 'utf8');
  A(!formState.includes('_registerHealthServers'), 'form-state.js does not register health servers');

  const streaming = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'streaming-settings.js'), 'utf8');
  A(streaming.includes('MEB_AUDIO_FORMATS_DATA'), 'streaming-settings.js uses static audio formats');

  const install = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'install.js'), 'utf8');
  A(install.includes('window.buildStreamConfig = buildStreamConfig'), 'install.js exports buildStreamConfig');
  A(!install.includes('/api/health/register'), 'install.js does not register health servers');

  const profileCreds = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'profile-credentials.js'), 'utf8');
  for (const fn of GLOBAL_HANDLERS) {
    A(profileCreds.includes(`window.${fn} = ${fn}`), `profile-credentials.js exports window.${fn}`);
  }

  console.log('\nconfigureModules.test.js: all passed');
})();