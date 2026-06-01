// Non-destructive accordions: wraps each ".block-title" + its following content
// into a collapsible section. Preserves all element ids/handlers (only re-nests DOM),
// so configure.js / controls.js selectors keep working. Fails safe (no-op on error).
(function () {
  function accordionize(pageId, openFirst) {
    const page = document.getElementById(pageId);
    if (!page || page._acc) return;
    const titles = [...page.children].filter(el => el.classList && el.classList.contains('block-title'));
    if (!titles.length) return;
    page._acc = 1;
    titles.forEach((title, idx) => {
      const wrap = document.createElement('div'); wrap.className = 'acc2';
      const head = document.createElement('div'); head.className = 'acc2-head';
      const body = document.createElement('div'); body.className = 'acc2-body';
      const inner = document.createElement('div'); inner.className = 'acc2-inner';
      const pad = document.createElement('div'); pad.className = 'acc2-pad';
      // insert wrapper where the title was
      page.insertBefore(wrap, title);
      // move the title into the head, add a chevron
      head.appendChild(title);
      const chev = document.createElement('span'); chev.className = 'acc2-chev';
      chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      head.appendChild(chev);
      // move following siblings (until next .block-title or end) into the body
      let n = wrap.nextElementSibling;
      while (n && !(n.classList && n.classList.contains('block-title')) && !(n.classList && n.classList.contains('acc2'))) {
        const next = n.nextElementSibling;
        pad.appendChild(n);
        n = next;
      }
      inner.appendChild(pad); body.appendChild(inner);
      wrap.appendChild(head); wrap.appendChild(body);
      head.addEventListener('click', () => wrap.classList.toggle('open'));
      if (openFirst && idx === 0) wrap.classList.add('open');
    });
  }
  // Field-mode: wrap each direct-child ".field" into a collapsible accordion using its .field-label.
  function accordionizeFields(pageId, openFirst) {
    const page = document.getElementById(pageId);
    if (!page || page._accf) return;
    const fields = [...page.children].filter(el => el.classList && el.classList.contains('field'));
    if (!fields.length) return;
    page._accf = 1;
    fields.forEach((field, idx) => {
      const label = field.querySelector(':scope > .field-label');
      if (!label) return;
      field.classList.add('acc2', 'acc2-field');
      const head = document.createElement('div'); head.className = 'acc2-head';
      field.insertBefore(head, field.firstChild);
      head.appendChild(label);
      const chev = document.createElement('span'); chev.className = 'acc2-chev';
      chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
      head.appendChild(chev);
      const body = document.createElement('div'); body.className = 'acc2-body';
      const inner = document.createElement('div'); inner.className = 'acc2-inner';
      const pad = document.createElement('div'); pad.className = 'acc2-pad';
      let n = head.nextElementSibling;
      while (n) { const next = n.nextElementSibling; pad.appendChild(n); n = next; }
      inner.appendChild(pad); body.appendChild(inner); field.appendChild(body);
      head.addEventListener('click', () => field.classList.toggle('open'));
      if (openFirst && idx === 0) field.classList.add('open');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      accordionize('page-catalogs', true);
      accordionize('page-appearance', true);
      accordionizeFields('page-streaming', true);
    } catch (e) { console.warn('accordionize skipped:', e); }
  });
})();
