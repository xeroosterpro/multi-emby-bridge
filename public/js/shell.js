// ── Hash router + sidebar behavior + preference controls ─────────────────────
const PAGES = ['home','dashboard','servers','catalogs','streaming','appearance','health','install','apikeys','ping','log','settings','admin','users','billing','tickets','guide'];

function restoreShellSession() {
  if (!document.documentElement.classList.contains('meb-returning')) return;
  try {
    const isAdmin = sessionStorage.getItem('meb_is_admin') === '1';
    if (isAdmin) {
      document.querySelectorAll('.nav-group.admin-only').forEach(el => { el.style.display = 'block'; });
      document.querySelectorAll('.nav-item.admin-only, .nav-sec-toggle.admin-only').forEach(el => { el.style.display = ''; });
    }
    const username = sessionStorage.getItem('meb_username');
    if (username) {
      const btn = document.getElementById('logout');
      if (btn) btn.style.display = 'flex';
      const av = document.getElementById('side-avatar');
      if (av) av.textContent = username[0].toUpperCase();
      const nm = document.getElementById('side-username');
      if (nm) nm.textContent = username + ' · Log out';
    }
  } catch {}
}

function showPage(name) {
  if (!PAGES.includes(name)) name = 'home';
  // Protect admin pages from non-admins (in case of direct hash or race)
  const adminPages = ['admin', 'users'];
  if (adminPages.includes(name)) {
    const user = window.currentUser;
    if (!user || user.role !== 'admin') {
      name = 'home';
    }
  }
  // Full demo site: allow exploring all pages with sample data
  if (window.MEBDemo && window.MEBDemo.isActive && window.MEBDemo.isActive()) {
    /* no billing lock */
  } else if (window.MEBSite) {
    // Admin preview: unpaid users are locked to billing; hide admin pages in preview
    if (window.MEBSite.isViewAsUnpaid && window.MEBSite.isViewAsUnpaid() && name !== 'billing') {
      name = 'billing';
    }
    if (window.MEBSite.isViewAs && window.MEBSite.isViewAs() && adminPages.includes(name)) {
      name = 'dashboard';
    }
  }
  PAGES.forEach(p => {
    const sec = document.getElementById('page-' + p);
    if (sec) sec.classList.toggle('on', p === name);
  });
  document.querySelectorAll('.nav-item, .foot-link').forEach(el => {
    el.classList.toggle('on', el.dataset.page === name);
  });
  if (window.onPageShow) window.onPageShow(name);   // hook for live data
  if (window.ensureActiveNavGroupOpen) window.ensureActiveNavGroupOpen();
  if (window.MEBMobile && window.MEBMobile.isMobile && window.MEBMobile.isMobile()) {
    window.MEBMobile.close();
  }
}

function routeFromHash() {
  let name = (location.hash || '#/home').replace(/^#\//, '');
  if (name === 'appearance') name = 'streaming';
  showPage(name);
}

// ── Collapsible sidebar groups (smooth sub-dropdowns for crowded nav) ───────
function initNavGroups() {
  const groups = document.querySelectorAll('.nav-group');

  // Restore previously collapsed groups from localStorage
  let collapsed = [];
  try {
    collapsed = JSON.parse(localStorage.getItem('meb-nav-collapsed') || '[]');
  } catch (e) {}

  groups.forEach(group => {
    const key = group.dataset.group;
    if (key && collapsed.includes(key)) {
      group.classList.add('collapsed');
    }

    const toggle = group.querySelector('.nav-sec-toggle');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isNowCollapsed = group.classList.toggle('collapsed');

        // Persist
        let cur = [];
        try { cur = JSON.parse(localStorage.getItem('meb-nav-collapsed') || '[]'); } catch (e) {}
        if (isNowCollapsed) {
          if (!cur.includes(key)) cur.push(key);
        } else {
          cur = cur.filter(k => k !== key);
        }
        localStorage.setItem('meb-nav-collapsed', JSON.stringify(cur));
      });
    }
  });

  // Ensure the group containing the active nav item is always expanded
  // (so you don't land on a page and have to manually open its section)
  function ensureActiveNavGroupOpen() {
    const active = document.querySelector('.nav-item.on');
    if (!active) return;
    const group = active.closest('.nav-group');
    if (group) group.classList.remove('collapsed');
  }

  window.ensureActiveNavGroupOpen = ensureActiveNavGroupOpen;

  // Run once shortly after first paint (after initial routeFromHash)
  setTimeout(ensureActiveNavGroupOpen, 30);
}

// Falling background particles (theme-tinted, gentle). Paused by .noanim / reduced-motion.
function generateParticles() {
  const st = document.getElementById('stipple');
  if (!st || st._done) return; st._done = 1;
  let html = '';
  for (let i = 0; i < 90; i++) {
    const size = (Math.random()*3.5+1.5).toFixed(1), left = (Math.random()*100).toFixed(1);
    const dur = (Math.random()*14+9).toFixed(1), delay = (-Math.random()*26).toFixed(1);
    const o = (Math.random()*0.45+0.28).toFixed(2), sway = (Math.random()*60-30).toFixed(0);
    html += `<div class="flake" style="left:${left}%;width:${size}px;height:${size}px;--o:${o};--sway:${sway}px;animation-duration:${dur}s;animation-delay:${delay}s;opacity:${o}"></div>`;
  }
  st.insertAdjacentHTML('beforeend', html);
}

function initShell() {
  restoreShellSession();
  generateParticles();

  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
  });
  window.addEventListener('hashchange', routeFromHash);

  // Initialize smooth collapsible nav sections (addresses long sidebar)
  initNavGroups();

  // sidebar pin (lock)
  const sb = document.getElementById('sidebar');
  document.getElementById('pin-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (window.MEBPrefs) window.MEBPrefs.setLock(!sb.classList.contains('locked'));
  });

  // preference controls (theme.js applies + persists)
  document.querySelectorAll('.swatch').forEach(sw => sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s === sw));
    if (window.MEBPrefs) window.MEBPrefs.setTheme(sw.dataset.t);
  }));
  const scale = document.getElementById('ui-scale');
  scale?.addEventListener('input', function () {
    if (window.MEBPrefs) window.MEBPrefs.setScale(+this.value);
    const sv = document.getElementById('scale-val'); if (sv) sv.textContent = this.value + '%';
  });
  document.getElementById('lock-switch')?.addEventListener('click', () => {
    if (window.MEBPrefs) window.MEBPrefs.setLock(!sb.classList.contains('locked'));
  });
  document.getElementById('motion-switch')?.addEventListener('click', function () {
    const on = !this.classList.contains('on');   // on = animate the background
    this.classList.toggle('on', on);
    if (window.MEBPrefs) window.MEBPrefs.setMotion(on ? 'on' : 'off');
  });

  // sidebar user button: show + populate when logged in; click logs out
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).then(d => {
    const btn = document.getElementById('logout');
    const loggedIn = !!(d && d.user);
    window.currentUser = d && d.user ? d.user : null;
    try {
      if (loggedIn) {
        sessionStorage.setItem('meb_username', d.user.username || '');
        sessionStorage.setItem('meb_is_admin', d.user.role === 'admin' ? '1' : '0');
      } else {
        sessionStorage.removeItem('meb_username');
        sessionStorage.removeItem('meb_is_admin');
        sessionStorage.removeItem('meb_home_cache');
      }
    } catch {}

    if (btn && loggedIn) {
      btn.style.display = 'flex';
      const av = document.getElementById('side-avatar'); if (av) av.textContent = (d.user.username || '?')[0].toUpperCase();
      const nm = document.getElementById('side-username'); if (nm) nm.textContent = d.user.username + ' · Log out';
      btn.addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
        location.reload();
      });
    }

    const isAdmin = !!(d && d.user && d.user.role === 'admin');

    // Hide nav items that require an account (or admin role) when not allowed.
    const authGatedPages = ['tickets', 'billing', 'admin', 'users'];
    authGatedPages.forEach(p => {
      const show = loggedIn && (p !== 'admin' && p !== 'users' || isAdmin);
      document.querySelectorAll(`.nav-item[data-page="${p}"], .foot-link[data-page="${p}"]`).forEach(el => {
        /* Billing link visibility is owned by billing-ui.js (subscribed vs locked). */
        if (p === 'billing' && el.classList.contains('billing-link')) return;
        el.style.display = show ? '' : 'none';
      });
    });

    // Show/hide the Administration section and its admin-only items
    document.querySelectorAll('.nav-group.admin-only').forEach(el => {
      el.style.display = isAdmin ? 'block' : 'none';
    });
    document.querySelectorAll('.nav-item.admin-only, .nav-sec-toggle.admin-only').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    if (window.MEBSite && window.MEBSite.refresh) window.MEBSite.refresh();
    if (window.MEBBilling && window.MEBBilling.refresh) window.MEBBilling.refresh();
    document.addEventListener('viewas-changed', () => {
      const pg = (location.hash || '#/home').replace(/^#\//, '');
      showPage(pg);
      if (window.MEBBilling && window.MEBBilling.refresh) window.MEBBilling.refresh();
    });

    // If a non-admin somehow landed on admin page, redirect
    const page = (location.hash || '#/home').replace(/^#\//, '');
    const adminPages = ['admin', 'users'];
    if (adminPages.includes(page) && !isAdmin) {
      location.hash = '#/home';
      return;
    }

    // Re-evaluate which nav group should be open now that admin-only items may have appeared
    if (window.ensureActiveNavGroupOpen) window.ensureActiveNavGroupOpen();
  }).catch(() => {
    // On error assume not logged in → hide gated nav items
    const authGatedPages = ['tickets', 'billing', 'admin', 'users'];
    authGatedPages.forEach(p => {
      document.querySelectorAll(`.nav-item[data-page="${p}"], .foot-link[data-page="${p}"]`).forEach(el => {
        el.style.display = 'none';
      });
    });
    window.currentUser = null;
    if (window.MEBBilling && window.MEBBilling.refresh) window.MEBBilling.refresh();
    const page = (location.hash || '#/home').replace(/^#\//, '');
    const adminPages = ['admin', 'users'];
    if (adminPages.includes(page)) {
      location.hash = '#/home';
      return;
    }
    if (window.ensureActiveNavGroupOpen) window.ensureActiveNavGroupOpen();
  });

  routeFromHash();
}

document.addEventListener('DOMContentLoaded', initShell);
