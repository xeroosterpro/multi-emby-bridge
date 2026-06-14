'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'configure.html');
const CFG_JS = path.join(ROOT, 'public', 'js', 'configure.js');

const DASHBOARD_MODULES = [
  '/js/configure/dashboard-shared.js',
  '/js/configure/dashboard-health.js',
  '/js/configure/dashboard-library.js',
  '/js/configure/dashboard-cards.js',
  '/js/configure/dashboard-live.js',
  '/js/configure/dashboard-activity.js',
  '/js/configure/dashboard-bundle.js',
  '/js/configure/dashboard-render.js',
];

const REQUIRED_MODULES = [
  '/js/configure/state.js',
  '/js/configure/ui-helpers.js',
  '/js/configure/servers-config.js',
  '/js/configure/account-bootstrap.js',
  '/js/configure/dashboard-fetch.js',
  ...DASHBOARD_MODULES,
  '/js/configure/servers-page.js',
  '/js/configure/dashboard-page.js',
  '/js/configure.js',
  '/js/configure/form-state.js',
  '/js/configure/profile-credentials.js',
  '/js/configure/streaming-settings.js',
  '/js/configure/request-log.js',
  '/js/configure/install.js',
];

const GLOBAL_HANDLERS = [
  'saveProfile',
  'loadProfile',
  'exportConfig',
  'importConfig',
  'updateCredWarning',
  'fetchCredentials',
  'testConnection',
  'loadLibraryStats',
];

function A(cond, msg) {
  assert.ok(cond, msg);
  console.log('  ✓', msg);
}

(function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const cfg = fs.readFileSync(CFG_JS, 'utf8');
  const cfgLines = cfg.split(/\r?\n/).length;

  A(cfgLines < 1500, `configure.js orchestrator is slim (${cfgLines} lines)`);
  A(!cfg.includes('// ── Generate links'), 'install block not duplicated in configure.js');
  A(!cfg.includes('function refreshLog'), 'request-log not duplicated in configure.js');
  A(!cfg.includes('function saveProfile'), 'profile-credentials not duplicated in configure.js');
  A(!cfg.includes('function fetchCredentials'), 'fetchCredentials not duplicated in configure.js');
  A(!cfg.includes('function collectFormState'), 'form-state not duplicated in configure.js');
  A(!cfg.includes('function autoSave'), 'autoSave not duplicated in configure.js');
  A(!cfg.includes('function collectConfig'), 'servers-config not duplicated in configure.js');
  A(!cfg.includes('function escHtml'), 'ui-helpers not duplicated in configure.js');
  A(!cfg.includes('function updateInstallStats'), 'install stats not duplicated in configure.js');
  A(cfg.includes('window.onPageShow'), 'orchestrator keeps onPageShow');

  const scriptTags = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(m => m[1]);
  const configureIdx = scriptTags.findIndex(s => s === '/js/configure.js');
  A(configureIdx >= 0, 'configure.js is referenced');

  const legacyPath = path.join(ROOT, 'public', 'js', 'configure', 'dashboard-legacy.js');
  A(!fs.existsSync(legacyPath), 'dashboard-legacy.js removed');
  A(!html.includes('dashboard-legacy.js'), 'configure.html does not reference dashboard-legacy.js');

  for (const mod of REQUIRED_MODULES) {
    A(html.includes(`src="${mod}"`), `configure.html loads ${mod}`);
    const disk = path.join(ROOT, 'public', mod.replace(/^\//, '').replace(/\//g, path.sep));
    A(fs.existsSync(disk), `file exists: ${mod}`);
    const body = fs.readFileSync(disk, 'utf8');
    A(body.length > 20, `${mod} is non-empty`);
  }

  const order = (src) => scriptTags.indexOf(src);
  A(order('/js/configure/state.js') < order('/js/configure/ui-helpers.js'),
    'state.js loads before ui-helpers.js');
  A(order('/js/configure/ui-helpers.js') < order('/js/configure/servers-config.js'),
    'ui-helpers.js loads before servers-config.js');
  A(order('/js/configure/servers-config.js') < order('/js/configure/account-bootstrap.js'),
    'servers-config.js loads before account-bootstrap.js');
  A(order('/js/configure/account-bootstrap.js') < order('/js/configure/dashboard-fetch.js'),
    'account-bootstrap.js loads before dashboard-fetch.js');
  A(order('/js/configure/dashboard-fetch.js') < order('/js/configure/dashboard-shared.js'),
    'dashboard-fetch.js loads before dashboard-shared.js');
  A(order('/js/configure/dashboard-shared.js') < order('/js/configure/dashboard-health.js'),
    'dashboard-shared.js loads before dashboard-health.js');
  A(order('/js/configure/dashboard-health.js') < order('/js/configure/dashboard-library.js'),
    'dashboard-health.js loads before dashboard-library.js');
  A(order('/js/configure/dashboard-library.js') < order('/js/configure/dashboard-cards.js'),
    'dashboard-library.js loads before dashboard-cards.js');
  A(order('/js/configure/dashboard-cards.js') < order('/js/configure/dashboard-live.js'),
    'dashboard-cards.js loads before dashboard-live.js');
  A(order('/js/configure/dashboard-live.js') < order('/js/configure/dashboard-activity.js'),
    'dashboard-live.js loads before dashboard-activity.js');
  A(order('/js/configure/dashboard-activity.js') < order('/js/configure/dashboard-bundle.js'),
    'dashboard-activity.js loads before dashboard-bundle.js');
  A(order('/js/configure/dashboard-bundle.js') < order('/js/configure/dashboard-render.js'),
    'dashboard-bundle.js loads before dashboard-render.js');
  A(order('/js/configure/dashboard-render.js') < order('/js/configure/servers-page.js'),
    'dashboard-render.js loads before servers-page.js');
  A(order('/js/configure/servers-page.js') < order('/js/configure/dashboard-page.js'),
    'servers-page.js loads before dashboard-page.js');

  const dashFetch = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-fetch.js'), 'utf8');
  A(dashFetch.includes('async function _fetchWithTimeout'), 'dashboard-fetch.js owns _fetchWithTimeout');
  A(!dashFetch.includes('function getAuth'), 'getAuth not duplicated in dashboard-fetch.js');

  for (const mod of DASHBOARD_MODULES) {
    const base = path.basename(mod);
    const body = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', base), 'utf8');
    A(!body.includes('function getAuth'), `getAuth not duplicated in ${base}`);
    A(!body.includes('const STREAM_PROFILE_VERSION'), `stream profile constants not duplicated in ${base}`);
    A(body.split('async function _fetchWithTimeout').length <= 2,
      `_fetchWithTimeout not duplicated in ${base}`);
  }

  const account = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'account-bootstrap.js'), 'utf8');
  A(account.includes('window.MEB_getAuth = getAuth'), 'account-bootstrap.js exports MEB_getAuth');
  A((account.match(/window\.MEB_getAuth\s*=/g) || []).length === 1,
    'account-bootstrap.js has single MEB_getAuth export');
  A(account.includes('const STREAM_PROFILE_VERSION'), 'account-bootstrap.js owns STREAM_PROFILE_VERSION');
  A(order('/js/configure.js') < order('/js/configure/form-state.js'),
    'configure.js loads before form-state.js');
  A(order('/js/configure/form-state.js') < order('/js/configure/profile-credentials.js'),
    'form-state.js loads before profile-credentials.js');
  A(order('/js/configure/profile-credentials.js') < order('/js/configure/install.js'),
    'profile-credentials.js loads before install.js');
  A(order('/js/configure.js') < order('/js/configure/streaming-settings.js'),
    'configure.js loads before streaming-settings.js');

  const formState = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'form-state.js'), 'utf8');
  A(formState.includes('window.autoSave = autoSave'), 'form-state.js exports window.autoSave');
  A(formState.includes('window.collectFormState = collectFormState'), 'form-state.js exports window.collectFormState');
  A(formState.includes('window.restoreFromLocalStorage = restoreFromLocalStorage'), 'form-state.js exports restoreFromLocalStorage');

  const profileCreds = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'profile-credentials.js'), 'utf8');
  for (const fn of GLOBAL_HANDLERS) {
    A(profileCreds.includes(`window.${fn} = ${fn}`), `profile-credentials.js exports window.${fn}`);
  }

  const state = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'state.js'), 'utf8');
  A(state.includes('function lsKey'), 'state.js defines lsKey');
  A(state.includes('const EMBY_LOGO'), 'state.js owns brand logos');
  A(!state.includes('MEBConfigure'), 'state.js has no stale MEBConfigure preamble');

  const helpers = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'ui-helpers.js'), 'utf8');
  A(helpers.includes('window.escHtml = escHtml'), 'ui-helpers.js exports window.escHtml');

  const serversCfg = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'servers-config.js'), 'utf8');
  A(serversCfg.includes('window.collectConfig = collectConfig'), 'servers-config.js exports collectConfig');

  const install = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'install.js'), 'utf8');
  A(install.includes('window.loadInstallPage = loadInstallPage'), 'install.js exports loadInstallPage');
  A((install.match(/window\.generateLinks\s*=/g) || []).length === 1,
    'install.js has single generateLinks export');

  const servers = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'servers-page.js'), 'utf8');
  A(!servers.includes('const EMBY_LOGO'), 'servers-page.js does not redeclare EMBY_LOGO');
  A(servers.includes('window.updateSteps = updateSteps'), 'servers-page.js exports updateSteps');

  const dashShared = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-shared.js'), 'utf8');
  A(dashShared.includes('function dashConsoleLog'), 'dashboard-shared.js defines dashConsoleLog');

  const dashHealth = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-health.js'), 'utf8');
  A(dashHealth.includes('window._kickHealthPing = _kickHealthPing'), 'dashboard-health.js exports _kickHealthPing');

  const dashLibrary = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-library.js'), 'utf8');
  A(dashLibrary.includes('window.hydrateDashLibraryStats = hydrateDashLibraryStats'),
    'dashboard-library.js exports hydrateDashLibraryStats');

  const dashCards = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-cards.js'), 'utf8');
  A(dashCards.includes('window.paintDashboardSkeleton = paintDashboardSkeleton'),
    'dashboard-cards.js exports paintDashboardSkeleton');
  A(dashCards.includes('window.renderDashActivityShell = renderDashActivityShell'),
    'dashboard-cards.js exports renderDashActivityShell');
  A(dashCards.includes('function dashActivityEsc'), 'dashboard-cards.js owns dashActivityEsc');

  const dashLive = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-live.js'), 'utf8');
  A(dashLive.includes('window.fetchLiveBundle = fetchLiveBundle'), 'dashboard-live.js exports fetchLiveBundle');
  A((dashLive.match(/window\.fetchLiveBundle\s*=/g) || []).length === 1,
    'dashboard-live.js has single fetchLiveBundle export');

  const dashActivity = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-activity.js'), 'utf8');
  A(dashActivity.includes('window.renderDashActivity = renderDashActivity'),
    'dashboard-activity.js exports renderDashActivity');
  A(dashActivity.includes('async function renderDashActivity'), 'dashboard-activity.js owns renderDashActivity');
  A(!dashActivity.includes('function renderDashboard'), 'renderDashboard not duplicated in dashboard-activity.js');

  const dashBundle = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-bundle.js'), 'utf8');
  A(dashBundle.includes('window.applyDashboardBundle = applyDashboardBundle'),
    'dashboard-bundle.js exports applyDashboardBundle');
  A((dashBundle.match(/window\.applyDashboardBundle\s*=/g) || []).length === 1,
    'dashboard-bundle.js has single applyDashboardBundle export');
  A(!dashBundle.includes('async function renderDashboard'), 'renderDashboard not duplicated in dashboard-bundle.js');

  const dashRender = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-render.js'), 'utf8');
  A(dashRender.includes('window.renderDashboard = renderDashboard'),
    'dashboard-render.js exports renderDashboard');
  A(dashRender.includes('_createDashboardGCard'), 'dashboard-render.js uses _createDashboardGCard');
  A(!dashRender.includes('const PALETTE'), 'dashboard-render.js has no inline PALETTE');

  const dashPage = fs.readFileSync(path.join(ROOT, 'public', 'js', 'configure', 'dashboard-page.js'), 'utf8');
  A(dashPage.split(/\r?\n/).length < 120, 'dashboard-page.js stays slim entry module');
  A(!dashPage.includes('async function renderDashActivity'), 'renderDashActivity not duplicated in dashboard-page.js');
  A(!dashPage.includes('async function applyDashboardBundle'), 'applyDashboardBundle not duplicated in dashboard-page.js');
  A(!dashPage.includes('const EMBY_LOGO'), 'dashboard-page.js does not redeclare EMBY_LOGO');

  console.log('\nconfigureModules.test.js: all passed');
})();