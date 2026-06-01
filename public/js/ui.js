// Pure-presentation UI widgets: dropdowns, accordions, segmented controls, toasts, modal shell.
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  // ---- toasts ----
  window.toast = function (msg) {
    const wrap = document.getElementById('toast-wrap'); if (!wrap) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    wrap.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 360); }, 2600);
  };

  // ---- custom dropdowns ----
  window.bindDropdowns = function (scope) {
    (scope || document).querySelectorAll('[data-dd]').forEach(dd => {
      if (dd._bound) return; dd._bound = 1;
      const btn = dd.querySelector('.dd-btn'), val = dd.querySelector('.dd-val');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        $$('[data-dd].open').forEach(o => { if (o !== dd) o.classList.remove('open'); });
        dd.classList.toggle('open');
      });
      dd.querySelectorAll('.dd-opt').forEach(opt => opt.addEventListener('click', () => {
        dd.querySelectorAll('.dd-opt').forEach(o => o.classList.remove('sel'));
        opt.classList.add('sel'); val.textContent = opt.textContent.trim(); dd.classList.remove('open');
        dd.dispatchEvent(new CustomEvent('dd:change', { detail: { value: val.textContent }, bubbles: true }));
      }));
    });
  };

  // ---- global delegated behavior: accordions, segmented, dropdown close ----
  document.addEventListener('click', e => {
    const h = e.target.closest('.acc-head');
    if (h) {
      const acc = h.parentElement, willOpen = !acc.classList.contains('open');
      acc.classList.remove('menu-space');
      if (acc._ms) { clearTimeout(acc._ms); acc._ms = null; }
      acc.classList.toggle('open', willOpen);
      if (willOpen) acc._ms = setTimeout(() => { if (acc.classList.contains('open')) acc.classList.add('menu-space'); acc._ms = null; }, 360);
    }
    const seg = e.target.closest('.seg button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on')); seg.classList.add('on'); }
    if (!e.target.closest('[data-dd]')) $$('[data-dd].open').forEach(o => o.classList.remove('open'));
  });

  // ---- modal shell ----
  window.openModal = function (html) {
    const bg = document.getElementById('modal-bg'); const m = document.getElementById('modal');
    if (!bg || !m) return; m.innerHTML = html; bg.classList.add('on');
  };
  window.closeModal = function () { const bg = document.getElementById('modal-bg'); if (bg) bg.classList.remove('on'); };
  document.addEventListener('click', e => {
    const bg = document.getElementById('modal-bg');
    if (bg && (e.target === bg || e.target.closest('[data-close]'))) closeModal();
    const tab = e.target.closest('.modal-tabs button');
    if (tab) {
      $$('#modal .modal-tabs button').forEach(x => x.classList.remove('on')); tab.classList.add('on');
      $$('#modal .mtab').forEach(t => t.classList.remove('on'));
      const target = document.getElementById('mt-' + tab.dataset.mt); if (target) target.classList.add('on');
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  document.addEventListener('DOMContentLoaded', () => bindDropdowns());
})();
