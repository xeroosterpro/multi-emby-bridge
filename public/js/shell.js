// ── Hash router + sidebar behavior ───────────────────────────────────────────
const PAGES = ['servers', 'streaming', 'install', 'debug'];

function restoreShellSession() {
  if (!document.documentElement.classList.contains('meb-returning')) return;
  try {
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
  name = String(name || '').split('?')[0];
  if (!PAGES.includes(name)) name = 'servers';
  PAGES.forEach(p => {
    const sec = document.getElementById('page-' + p);
    if (sec) sec.classList.toggle('on', p === name);
  });
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('on', el.dataset.page === name);
  });
  try { if (window.onPageShow) window.onPageShow(name); }
  catch (e) { console.error('[shell] onPageShow failed for', name, e); }
  try {
    if (window.MEBMobile && window.MEBMobile.isMobile && window.MEBMobile.isMobile()) window.MEBMobile.close();
  } catch (e) { /* non-fatal */ }
}

function routeFromHash() {
  let raw = (location.hash || '#/servers').replace(/^#\//, '');
  let name = raw.split('?')[0];
  if (name === 'appearance') name = 'streaming';
  showPage(name);
}

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

  const sb = document.getElementById('sidebar');
  document.getElementById('pin-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (window.MEBPrefs) window.MEBPrefs.setLock(!sb.classList.contains('locked'));
  });

  const authFetch = window.getAuth
    ? window.getAuth()
    : fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => ({ user: null }));

  authFetch.then(d => {
    const btn = document.getElementById('logout');
    const loggedIn = !!(d && d.user);
    window.currentUser = d && d.user ? d.user : null;
    window.accountsEnabled = !!d?.enabled;
    try {
      if (loggedIn) {
        sessionStorage.setItem('meb_username', d.user.username || '');
      } else {
        sessionStorage.removeItem('meb_username');
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
  }).catch(() => {
    window.currentUser = null;
    window.accountsEnabled = false;
  });

  routeFromHash();
}

document.addEventListener('DOMContentLoaded', initShell);