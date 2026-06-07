// ─── Site controls: hide/badge tabs per global config + admin "view as user".
// Tab hiding is client-side UX only. Disabled tabs are hidden from normal users
// (and from admins while previewing); admins otherwise see them with a "disabled" badge.
(function () {
  const state = { role: 'user', disabled: [] };
  const isViewAs = () => { try { return localStorage.getItem('viewAsUser') === '1'; } catch { return false; } };

  function navItem(page) { return document.querySelector(`.nav-item[data-page="${page}"]`); }

  function applyTabs() {
    const asUser = state.role !== 'admin' || isViewAs();
    document.documentElement.classList.toggle('view-as-user', state.role === 'admin' && isViewAs());
    // reset previous badges/hides on toggleable items
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.remove('tab-hidden', 'tab-disabled-off');
      el.removeAttribute('title');
      const b = el.querySelector('.tab-disabled-badge'); if (b) b.remove();
    });
    state.disabled.forEach(page => {
      const item = navItem(page); if (!item) return;
      if (asUser) {
        item.classList.add('tab-hidden');
      } else {
        item.classList.add('tab-disabled-off');
        item.title = 'Hidden from users — manage in System';
      }
    });
    updateNavGroupCounts();
    // if currently on a hidden page, bounce to dashboard
    const cur = (location.hash || '').replace(/^#\//, '');
    if (asUser && state.disabled.includes(cur)) location.hash = '#/dashboard';
    renderBanner();
  }

  function renderBanner() {
    const show = state.role === 'admin' && isViewAs();
    let el = document.getElementById('view-as-banner');
    if (!show) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'view-as-banner';
      el.innerHTML = `<span>👁 Viewing as a normal user</span><button type="button" id="view-as-exit">Exit preview</button>`;
      document.body.appendChild(el);
      el.querySelector('#view-as-exit').addEventListener('click', () => setViewAs(false));
    }
  }

  function setViewAs(on) {
    try { on ? localStorage.setItem('viewAsUser', '1') : localStorage.removeItem('viewAsUser'); } catch {}
    applyTabs();
    document.dispatchEvent(new CustomEvent('viewas-changed', { detail: { on } }));
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

  function updateNavGroupCounts() {
    const asUser = state.role !== 'admin' || isViewAs();
    document.querySelectorAll('.nav-group[data-group]').forEach(group => {
      const toggle = group.querySelector('.nav-sec-toggle span:first-child');
      if (!toggle) return;
      const base = toggle.dataset.baseLabel || toggle.textContent;
      toggle.dataset.baseLabel = base;
      const items = [...group.querySelectorAll('.nav-item[data-page]')].filter(el => !el.classList.contains('tab-hidden'));
      const off = asUser ? 0 : items.filter(el => el.classList.contains('tab-disabled-off')).length;
      const on = items.length - off;
      let label = base;
      if (!asUser && off > 0) label = `${base} · ${on}/${items.length}`;
      toggle.textContent = label;
    });
  }

  window.MEBSite = { refresh, applyTabs, setViewAs, isViewAs, get disabled() { return state.disabled.slice(); }, get role() { return state.role; } };
  window.addEventListener('hashchange', applyTabs);
  document.addEventListener('DOMContentLoaded', refresh);
})();
