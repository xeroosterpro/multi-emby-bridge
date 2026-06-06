// ── Hash router + sidebar behavior + preference controls ─────────────────────
const PAGES = ['home','dashboard','servers','catalogs','streaming','appearance','health','install','apikeys','ping','log','settings','admin','users','billing','tickets','guide'];

function showPage(name) {
  if (!PAGES.includes(name)) name = 'home';
  PAGES.forEach(p => {
    const sec = document.getElementById('page-' + p);
    if (sec) sec.classList.toggle('on', p === name);
  });
  document.querySelectorAll('.nav-item, .foot-link').forEach(el => {
    el.classList.toggle('on', el.dataset.page === name);
  });
  if (window.onPageShow) window.onPageShow(name);   // hook for live data
}

function routeFromHash() {
  const name = (location.hash || '#/home').replace(/^#\//, '');
  showPage(name);
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
  generateParticles();

  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
  });
  window.addEventListener('hashchange', routeFromHash);

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
    if (btn && d && d.user) {
      btn.style.display = 'flex';
      const av = document.getElementById('side-avatar'); if (av) av.textContent = (d.user.username || '?')[0].toUpperCase();
      const nm = document.getElementById('side-username'); if (nm) nm.textContent = d.user.username + ' · Log out';
      btn.addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
        location.reload();
      });
    }
  }).catch(() => {});

  routeFromHash();
}

document.addEventListener('DOMContentLoaded', initShell);
