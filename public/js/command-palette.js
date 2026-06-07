// ─── Command palette (Ctrl/Cmd-K): fuzzy-jump to pages + quick actions ──────
(function () {
  const PAGES = [
    ['dashboard','Dashboard','Overview'], ['servers','Servers','Overview'],
    ['catalogs','Catalogs','Configuration'], ['streaming','Media Sources','Configuration'],
    ['install','Install to Stremio','Configuration'],
    ['ping','Ping test','Monitoring'], ['log','Request log','Monitoring'],
    ['admin','Admin · System','Administration'], ['users','Admin · Console','Administration'],
    ['billing','Billing','Account'], ['settings','Settings','Account'],
  ];
  function buildCommands() {
    const cmds = [];
    for (const [page, label, group] of PAGES) {
      // only offer pages whose nav item is visible (admin/billing gating)
      const nav = document.querySelector('[data-page="' + page + '"]');
      if (!nav || nav.classList.contains('tab-hidden')) continue;
      if (nav.offsetParent === null && (nav.classList.contains('admin-only') || nav.classList.contains('billing-link'))) continue;
      cmds.push({ label, hint: group, run: () => { location.hash = '#/' + page; } });
    }
    const act = (label, hint, fn) => cmds.push({ label, hint, action: true, run: fn });
    act('Regenerate manifest link', 'Action', () => { location.hash = '#/install'; setTimeout(() => document.getElementById('acct-regen')?.click(), 250); });
    act('Lock / unlock sidebar', 'Action', () => document.getElementById('pin-btn')?.click());
    act('Log out', 'Action', () => document.getElementById('logout')?.click());
    return cmds;
  }

  let overlay, input, list, cmds = [], filtered = [], sel = 0;
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'cmdk'; overlay.id = 'cmdk';
    overlay.innerHTML = '<div class="cmdk-box"><input class="cmdk-input" id="cmdk-input" placeholder="Jump to… (type a page or action)" autocomplete="off" spellcheck="false"><div class="cmdk-list" id="cmdk-list"></div><div class="cmdk-foot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('#cmdk-input');
    list = overlay.querySelector('#cmdk-list');
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (filtered[sel]) { filtered[sel].run(); close(); } }
      else if (e.key === 'Escape') { close(); }
    });
  }
  function render() {
    const q = input.value.trim().toLowerCase();
    filtered = q ? cmds.filter(c => c.label.toLowerCase().includes(q) || (c.hint || '').toLowerCase().includes(q)) : cmds;
    list.innerHTML = filtered.map((c, i) =>
      `<div class="cmdk-item${i === sel ? ' on' : ''}" data-i="${i}"><span>${c.label}</span><span class="cmdk-hint">${c.hint || ''}</span></div>`
    ).join('') || '<div class="cmdk-empty">No matches</div>';
    [...list.querySelectorAll('.cmdk-item')].forEach(el => {
      el.addEventListener('mousemove', () => { sel = +el.dataset.i; [...list.children].forEach(c => c.classList.remove('on')); el.classList.add('on'); });
      el.addEventListener('click', () => { filtered[+el.dataset.i].run(); close(); });
    });
  }
  function open() { if (!overlay) build(); cmds = buildCommands(); sel = 0; overlay.classList.add('on'); input.value = ''; render(); setTimeout(() => input.focus(), 20); }
  function close() { if (overlay) overlay.classList.remove('on'); }

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); overlay && overlay.classList.contains('on') ? close() : open(); }
  });
})();
