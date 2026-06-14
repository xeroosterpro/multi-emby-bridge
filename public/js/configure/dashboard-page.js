// configure/dashboard-page.js

function initBuildBadge() {
  let el = document.getElementById('build-id');
  let full = window.BUILD_ID || window.__BUILD_ID__ || (el && el.getAttribute('data-build')) || (el && el.textContent) || 'dev';
  if (full === 'dev' || full === 'BUILD_ID_HERE') {
    full = window.BUILD_ID || window.__BUILD_ID__ || 'dev';
  }
  const short = (full || 'dev').slice(0, 7);
  if (!el) {
    const header = document.querySelector('#page-dashboard .dash-header-actions');
    if (header) {
      el = document.createElement('span');
      el.id = 'build-id';
      el.className = 'build-id';
      header.appendChild(el);
    } else {
      return;
    }
  }
  el.textContent = short;
  el.setAttribute('data-build', full);
  el.title = `Build: ${full} (click to copy full SHA)`;
  el.style.cursor = 'pointer';
  el.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(full).then(() => {
      el.textContent = 'copied!';
      setTimeout(() => { if (el && el.parentNode) el.textContent = short; }, 1200);
    }).catch(() => {
      try { prompt('Build ID (full):', full); } catch {}
    });
  };
}
window.initBuildBadge = initBuildBadge;

async function loadDashboardPage() {
  if (window.Dashboard?.load) {
    const r = window.Dashboard.load();
    window._lastDashSyncTs = Date.now();
    updateDashLastSync('just now');
    startDashTimestampTicker();
    return r;
  }
  const gen = ++_dashLoadGen;
  dashConsoleStart('Opening dashboard…');
  renderDashActivityShell();
  await renderDashboard(false, gen);
  initBuildBadge();
  window._lastDashSyncTs = Date.now();
  updateDashLastSync('just now');
  startDashTimestampTicker();
  dashConsoleLog('Dashboard ready (legacy path)', 'ok');
}

function openServerManage(index) {
  location.hash = '#/servers';
  setTimeout(() => {
    const cards = document.querySelectorAll('#servers-container .server-card');
    const card = cards[index];
    if (!card) return;
    card.classList.add('open');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 80);
}

window.openServerManage = openServerManage;
