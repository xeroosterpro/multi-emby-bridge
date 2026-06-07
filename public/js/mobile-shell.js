// ─── Mobile shell: drawer nav, backdrop, safe areas ─────────────────────────
(function () {
  const MQ = '(max-width: 720px)';
  let backdrop = null;

  function isMobile() {
    return window.matchMedia(MQ).matches;
  }

  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    backdrop.className = 'sidebar-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('click', closeSidebar);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function openSidebar() {
    if (!isMobile()) return;
    document.body.classList.add('sidebar-open');
    ensureBackdrop().classList.add('on');
    document.body.style.overflow = 'hidden';
    const btn = document.getElementById('menu-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    if (backdrop) backdrop.classList.remove('on');
    document.body.style.overflow = '';
    const btn = document.getElementById('menu-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleSidebar() {
    if (document.body.classList.contains('sidebar-open')) closeSidebar();
    else openSidebar();
  }

  function applyMobileLockPolicy() {
    if (!isMobile()) return;
    if (window.MEBPrefs) window.MEBPrefs.setLock(false);
    closeSidebar();
  }

  function init() {
    const btn = document.getElementById('menu-toggle');
    if (btn && !btn._mobW) {
      btn._mobW = 1;
      btn.addEventListener('click', e => { e.stopPropagation(); toggleSidebar(); });
    }
    document.querySelectorAll('.nav-item[data-page], .foot-link[data-page]').forEach(el => {
      if (el._mobNavW) return;
      el._mobNavW = 1;
      el.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) closeSidebar();
    });
    window.addEventListener('resize', () => {
      if (!isMobile()) closeSidebar();
    });
    applyMobileLockPolicy();
    window.matchMedia(MQ).addEventListener('change', applyMobileLockPolicy);
  }

  window.MEBMobile = { open: openSidebar, close: closeSidebar, toggle: toggleSidebar, isMobile };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();