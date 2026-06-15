const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'public', 'configure.html');
const backup = path.join(__dirname, '..', 'public', 'configure.full.html');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

if (!fs.existsSync(backup)) {
  fs.copyFileSync(src, backup);
  console.log('Backed up to configure.full.html');
}

const head = slice(1, 33)
  .replace('catalogs, and your personal', 'stream preferences, and your personal')
  .replace(/<link rel="stylesheet" href="\/css\/catalogs-wizard.css" \/>\r?\n?/, '')
  .replace(/<link rel="stylesheet" href="\/css\/admin-data.css" \/>\r?\n?/, '');

const auth = slice(37, 84).replace(
  'Health monitoring &amp; uptime',
  'Stream filtering &amp; audio presets'
);

const nav = `      <nav class="nav" id="nav">
        <a class="nav-item on" data-page="servers"><svg class="nav-ic" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg><span class="nav-label">Servers</span></a>
        <a class="nav-item" data-page="streaming"><svg class="nav-ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m10 9 5 3-5 3V9Z"/></svg><span class="nav-label">Media Sources</span></a>
        <a class="nav-item" data-page="install"><svg class="nav-ic" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg><span class="nav-label">Install</span></a>
      </nav>`;

const sidebarFoot = `      <div class="sidebar-foot">
        <div class="save-indicator" id="autosave-indicator" aria-live="polite"></div>
        <div class="userbtn" id="logout" style="display:none"><div class="avatar" id="side-avatar">E</div><span class="um" id="side-username">Account · Log out</span></div>
      </div>`;

let servers = slice(333, 383);
servers = servers.replace('class="page" id="page-servers"', 'class="page on" id="page-servers"');

let streaming = slice(818, 1217);
streaming = streaming.replace('id="show-ping" checked', 'id="show-ping"');

const install = slice(1237, 1278);
const footer = slice(1904, 1909);

const scripts = `  <script src="/js/error-boundary.js" defer></script>
  <script src="/js/api-client.js" defer></script>
  <script src="/js/theme.js" defer></script>
  <script src="/js/mobile-shell.js" defer></script>
  <script src="/js/ui.js" defer></script>
  <script src="/js/configure/state.js" defer></script>
  <script src="/js/configure/ui-helpers.js" defer></script>
  <script src="/js/configure/servers-config.js" defer></script>
  <script src="/js/configure/account-bootstrap.js" defer></script>
  <script src="/js/configure/audio-formats-data.js" defer></script>
  <script src="/js/configure/servers-page.js" defer></script>
  <script src="/js/configure.js" defer></script>
  <script src="/js/configure/form-state.js" defer></script>
  <script src="/js/configure/profile-credentials.js" defer></script>
  <script src="/js/configure/streaming-settings.js" defer></script>
  <script src="/js/configure/install.js" defer></script>
  <script src="/js/controls.js" defer></script>
  <script src="/js/shell.js" defer></script>
  <script src="/js/auth-ui.js" defer></script>
  <script src="/js/user-account.js" defer></script>
  <script src="/js/accordionize.js" defer></script>
  <script src="/js/dropdowns.js" defer></script>`;

const html = [
  head,
  '</head>',
  '<body class="sb-locked">',
  slice(35, 36),
  auth,
  '  <div class="app">',
  '    <aside class="sidebar locked" id="sidebar">',
  slice(88, 98),
  nav,
  sidebarFoot,
  '    </aside>',
  '    <button type="button" class="menu-toggle" id="menu-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">',
  '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  '    </button>',
  '    <main class="content" id="content">',
  servers,
  streaming,
  install,
  '    </main>',
  '  </div>',
  footer,
  scripts,
  '</body>',
  '</html>',
].join('\n');

fs.writeFileSync(src, html);
console.log('Wrote minimal configure.html:', html.split('\n').length, 'lines');