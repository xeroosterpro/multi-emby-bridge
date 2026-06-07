// ─── Site controls: hide tabs per global config + admin "view as user".
// Disabled tabs are removed from the sidebar for everyone (including admins).
// View-as modes: off | unpaid | paid — simulates subscriber experience for admins.
(function () {
  const state = { role: 'user', disabled: [] };

  function getViewAsMode() {
    try {
      const m = localStorage.getItem('viewAsMode');
      if (m === 'unpaid' || m === 'paid') return m;
      if (localStorage.getItem('viewAsUser') === '1') return 'unpaid';
      return 'off';
    } catch { return 'off'; }
  }

  const isViewAs = () => getViewAsMode() !== 'off';
  const isViewAsUnpaid = () => getViewAsMode() === 'unpaid';
  const isViewAsPaid = () => getViewAsMode() === 'paid';

  function navItem(page) { return document.querySelector(`.nav-item[data-page="${page}"]`); }

  function applyTabs() {
    const mode = getViewAsMode();
    const asUser = state.role !== 'admin' || mode !== 'off';
    document.documentElement.classList.toggle('view-as-user', state.role === 'admin' && mode !== 'off');
    document.documentElement.classList.toggle('view-as-unpaid', state.role === 'admin' && mode === 'unpaid');
    document.documentElement.classList.toggle('view-as-paid', state.role === 'admin' && mode === 'paid');

    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.remove('tab-hidden');
    });

    state.disabled.forEach(page => {
      const item = navItem(page); if (!item) return;
      item.classList.add('tab-hidden');
    });

    updateNavGroupVisibility();

    const cur = (location.hash || '').replace(/^#\//, '');
    if (asUser && state.disabled.includes(cur)) location.hash = '#/dashboard';
    if (window.MEBDemo && window.MEBDemo.isActive && window.MEBDemo.isActive()) { /* demo unlocks nav */ }
    else if (state.role === 'admin' && mode === 'unpaid' && cur !== 'billing') location.hash = '#/billing';
    if (state.role === 'admin' && mode !== 'off' && ['admin', 'users'].includes(cur)) location.hash = '#/dashboard';

    renderBanner();
    document.dispatchEvent(new CustomEvent('viewas-changed', { detail: { mode } }));
  }

  function renderBanner() {
    const mode = getViewAsMode();
    const show = state.role === 'admin' && mode !== 'off';
    let el = document.getElementById('view-as-banner');
    if (!show) { if (el) el.remove(); return; }
    const labels = { unpaid: 'Unpaid user — billing locked', paid: 'Paid subscriber — full access' };
    const icons = { unpaid: '🔒', paid: '✓' };
    if (!el) {
      el = document.createElement('div');
      el.id = 'view-as-banner';
      document.body.appendChild(el);
    }
    el.className = 'view-as-banner-' + mode;
    el.innerHTML = `<span class="vab-icon">${icons[mode] || '👁'}</span>
      <span class="vab-text">Preview: <strong>${labels[mode] || 'User'}</strong></span>
      <div class="vab-modes">
        <button type="button" class="vab-mode${mode === 'unpaid' ? ' on' : ''}" data-mode="unpaid">Unpaid</button>
        <button type="button" class="vab-mode${mode === 'paid' ? ' on' : ''}" data-mode="paid">Paid</button>
      </div>
      <button type="button" class="vab-exit" id="view-as-exit">Exit</button>`;
    el.querySelector('#view-as-exit').onclick = () => setViewAs('off');
    el.querySelectorAll('.vab-mode').forEach(btn => {
      btn.onclick = () => setViewAs(btn.dataset.mode);
    });
  }

  function setViewAs(mode) {
    try {
      if (mode === 'off' || !mode) {
        localStorage.removeItem('viewAsMode');
        localStorage.removeItem('viewAsUser');
      } else {
        localStorage.setItem('viewAsMode', mode);
        localStorage.removeItem('viewAsUser');
      }
    } catch {}
    applyTabs();
    if (window.MEBBilling && window.MEBBilling.refresh) window.MEBBilling.refresh();
  }

  async function refresh() {
    try {
      const [me, cfg] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
        fetch('/api/site-config', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null),
      ]);
      state.role = (me && me.user && me.user.role) || 'user';
      state.disabled = (cfg && Array.isArray(cfg.disabledTabs)) ? cfg.disabledTabs : [];
    } catch {}
    applyTabs();
  }

  function isNavItemVisible(el) {
    if (!el || el.classList.contains('tab-hidden')) return false;
    if (el.style.display === 'none') return false;
    return true;
  }

  function updateNavGroupVisibility() {
    document.querySelectorAll('.nav-group[data-group]').forEach(group => {
      const items = [...group.querySelectorAll('.nav-item[data-page]')];
      const visible = items.filter(isNavItemVisible);
      group.classList.toggle('tab-group-hidden', items.length > 0 && visible.length === 0);
      const toggle = group.querySelector('.nav-sec-toggle span:first-child');
      if (toggle && toggle.dataset.baseLabel) toggle.textContent = toggle.dataset.baseLabel;
    });
  }

  window.MEBSite = {
    refresh, applyTabs, setViewAs, getViewAsMode, isViewAs, isViewAsUnpaid, isViewAsPaid,
    get disabled() { return state.disabled.slice(); },
    get role() { return state.role; },
  };
  window.addEventListener('hashchange', applyTabs);
  document.addEventListener('DOMContentLoaded', refresh);
})();