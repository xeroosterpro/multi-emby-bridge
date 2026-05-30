// ── Hash router ────────────────────────────────────────────────────────────
const PAGES = ['dashboard','servers','catalogs','streaming','appearance','health','install','ping','log'];

function showPage(name) {
  if (!PAGES.includes(name)) name = 'dashboard';
  PAGES.forEach(p => {
    const sec = document.getElementById('page-' + p);
    if (sec) sec.classList.toggle('on', p === name);
  });
  document.querySelectorAll('.nav-item, .foot-link').forEach(el => {
    el.classList.toggle('on', el.dataset.page === name);
  });
  if (window.onPageShow) window.onPageShow(name);   // hook for live data (later tasks)
}

function routeFromHash() {
  const name = (location.hash || '#/dashboard').replace(/^#\//, '');
  showPage(name);
}

function initShell() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
  });
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

document.addEventListener('DOMContentLoaded', initShell);
