// Non-destructive custom dropdowns: overlays a themed dropdown on each VISIBLE native
// <select>, keeping the native element as the canonical value (controls.js / autoSave /
// onchange keep working). Menu is fixed-positioned so it never clips inside accordions.
(function () {
  const $$ = s => [...document.querySelectorAll(s)];
  let openDD = null;
  let openMenu = null;   // the currently-open menu, portaled to <body>

  function closeOpen() {
    if (openDD) {
      openDD.classList.remove('open');
      if (openMenu) { openMenu.style.display = 'none'; openDD.appendChild(openMenu); } // return menu to its dd
      openDD = null; openMenu = null;
    }
  }

  function positionMenu(dd) {
    const btn = dd.querySelector('.dd-btn'), menu = dd.querySelector('.dd-menu');
    const r = btn.getBoundingClientRect();
    // getBoundingClientRect returns post-zoom (visual) coords, but a fixed element's
    // CSS px length is itself multiplied by the root `zoom` (UI-scale preference).
    // Divide by zoom so the menu lands exactly under its button at any UI scale.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    menu.style.position = 'fixed';
    menu.style.left = (r.left / zoom) + 'px';
    menu.style.top = ((r.bottom + 6) / zoom) + 'px';
    menu.style.width = (r.width / zoom) + 'px';
  }

  function enhance(sel) {
    if (sel._dd) return;
    if (sel.classList.contains('hidden-canonical') || sel.closest('.hidden-canonical')) return; // seg/slider-driven — skip
    if (sel.dataset.noDd !== undefined) return;
    sel._dd = 1;
    sel.classList.add('dd-native');

    const dd = document.createElement('div'); dd.className = 'dd';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn';
    const val = document.createElement('span'); val.className = 'dd-val';
    val.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
    btn.appendChild(val);
    const chev = document.createElement('span'); chev.className = 'dd-chev';
    chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    btn.appendChild(chev);
    const menu = document.createElement('div'); menu.className = 'dd-menu'; menu.style.display = 'none';

    function rebuild() {
      menu.innerHTML = '';
      [...sel.options].forEach((opt, i) => {
        const o = document.createElement('div');
        o.className = 'dd-opt' + (i === sel.selectedIndex ? ' sel' : '');
        o.textContent = opt.textContent;
        o.addEventListener('click', e => {
          e.stopPropagation();
          sel.value = opt.value;
          val.textContent = opt.textContent;
          menu.querySelectorAll('.dd-opt').forEach(x => x.classList.remove('sel'));
          o.classList.add('sel');
          closeOpen();
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        menu.appendChild(o);
      });
    }
    rebuild();

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = dd.classList.contains('open');
      closeOpen();
      if (!isOpen) {
        dd.classList.add('open');
        positionMenu(dd);                 // compute fixed coords from the button (menu still in dd)
        document.body.appendChild(menu);  // portal to <body> so no ancestor can clip/trap its stacking
        menu.style.display = 'block';
        openDD = dd; openMenu = menu;
      }
    });

    // keep custom UI in sync if other code changes the native select
    sel.addEventListener('change', () => {
      val.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
      menu.querySelectorAll('.dd-opt').forEach((o, i) => o.classList.toggle('sel', i === sel.selectedIndex));
    });

    dd.appendChild(btn); dd.appendChild(menu);
    sel.parentNode.insertBefore(dd, sel.nextSibling);
  }

  document.addEventListener('click', closeOpen);
  window.addEventListener('scroll', closeOpen, true);
  window.addEventListener('resize', closeOpen);

  document.addEventListener('DOMContentLoaded', () => {
    // run after configure.js has applied saved values
    setTimeout(() => { try { document.querySelectorAll('select').forEach(enhance); } catch (e) { console.warn('dropdowns skipped:', e); } }, 50);
  });
})();
