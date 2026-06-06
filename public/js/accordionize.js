// Builds prototype-style accordions (icon badge + title + meta subtitle + chevron,
// 2-column masonry) from the existing page markup — non-destructively (moves the
// real controls into the accordion body, preserving all ids/handlers). The open/
// close animation + overflow handling is driven by ui.js's delegated .acc-head handler.
(function () {
  const ICONS = {
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4"/></svg>',
    add: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    rows: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    label: '<svg viewBox="0 0 24 24"><path d="M3 5h18M3 12h12M3 19h8"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>',
    sort: '<svg viewBox="0 0 24 24"><path d="M3 6h18M7 12h10M11 18h2"/></svg>',
    res: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
    bars: '<svg viewBox="0 0 24 24"><path d="M4 18V8M9 18V4M14 18v-6M19 18v-9"/></svg>',
    dft: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
  };
  function meta(raw) {
    const t = (raw || '').toLowerCase();
    if (t.includes('connection')) return ['link', 'API keys for Trakt, TMDB, MDBList'];
    if (t.includes('filter')) return ['filter', 'Language, genre & content rules'];
    if (t.includes('quick')) return ['add', 'Show a My Media row on Stremio home'];
    if (t.includes('add a row')) return ['add', 'Pull a list from a source'];
    if (t.includes('your rows')) return ['rows', 'Reorder, shuffle or remove'];
    if (t.includes('label')) return ['label', 'How stream labels are formatted'];
    if (t.includes('display')) return ['eye', 'How details are shown'];
    if (t.includes('delivery')) return ['bolt', 'How streams reach Stremio'];
    if (t.includes('sort')) return ['sort', 'Order results within a title'];
    if (t.includes('exclude') || t.includes('resolution')) return ['res', 'Resolutions to hide'];
    if (t.includes('audio rank')) return ['sort', 'Rank & filter audio formats'];
    if (t.includes('audio')) return ['dft', 'Preferred audio language'];
    if (t.includes('codec')) return ['dft', 'Preferred video codec'];
    if (t.includes('bitrate')) return ['bars', 'Maximum bitrate'];
    if (t.includes('extras')) return ['add', 'Extra stream tweaks'];
    return ['dft', ''];
  }
  function cleanTitle(s) { return (s || '').replace(/^[^A-Za-z0-9]+/, '').trim(); }

  function buildAcc(titleText, contentNodes, open) {
    const title = cleanTitle(titleText);
    const [icon, metaText] = meta(titleText);
    const acc = document.createElement('div'); acc.className = 'acc' + (open ? ' open menu-space' : '');
    const head = document.createElement('div'); head.className = 'acc-head';
    head.innerHTML = `<div class="acc-ic">${ICONS[icon] || ICONS.dft}</div>
      <div style="min-width:0"><div class="acc-title">${title}</div>${metaText ? `<div class="acc-meta">${metaText}</div>` : ''}</div>
      <div class="acc-right"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></div>`;
    const body = document.createElement('div'); body.className = 'acc-body';
    const inner = document.createElement('div'); inner.className = 'acc-inner';
    const pad = document.createElement('div'); pad.className = 'acc-pad';
    contentNodes.forEach(n => pad.appendChild(n));
    inner.appendChild(pad); body.appendChild(inner);
    acc.appendChild(head); acc.appendChild(body);
    return acc;
  }

  // block-title mode (Catalogs, Appearance): each .block-title heads a section.
  function byBlockTitle(pageId, openFirst) {
    const page = document.getElementById(pageId);
    if (!page || page._acc) return;
    const titles = [...page.children].filter(el => el.classList && el.classList.contains('block-title'));
    if (!titles.length) return;
    page._acc = 1;
    const grid = document.createElement('div'); grid.className = 'acc-grid';
    let firstAnchor = titles[0];
    titles.forEach((title, idx) => {
      const content = [];
      let n = title.nextElementSibling;
      while (n && !(n.classList && n.classList.contains('block-title'))) { const next = n.nextElementSibling; content.push(n); n = next; }
      const acc = buildAcc(title.textContent, content, openFirst && idx === 0);
      title.remove();
      grid.appendChild(acc);
    });
    page.insertBefore(grid, firstAnchor.nextSibling);
  }

  // field mode (Streaming): each direct-child .field is a section, titled by its .field-label.
  function byField(pageId, openFirst) {
    const page = document.getElementById(pageId);
    if (!page || page._accf) return;
    const fields = [...page.children].filter(el => el.classList && el.classList.contains('field'));
    if (!fields.length) return;
    page._accf = 1;
    const grid = document.createElement('div'); grid.className = 'acc-grid';
    const anchor = fields[0];
    fields.forEach((field, idx) => {
      const label = field.querySelector(':scope > .field-label');
      const titleText = label ? label.textContent : 'Option';
      if (label) label.remove();
      const acc = buildAcc(titleText, [...field.childNodes].filter(n => n.nodeType === 1), openFirst && idx === 0);
      grid.appendChild(acc);
    });
    page.insertBefore(grid, anchor);
    fields.forEach(f => f.remove());
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      byBlockTitle('page-catalogs', true);
      byBlockTitle('page-appearance', true);
      byField('page-streaming', true);
      if (window.bindDropdowns) window.bindDropdowns();
    } catch (e) { console.warn('accordionize skipped:', e); }
  });
})();
