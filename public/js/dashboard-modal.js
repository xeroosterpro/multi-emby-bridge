// Dashboard server-detail modal. Reads data straight from the rendered .gcard
// DOM (non-destructive — configure.js untouched). Clicking a card (anywhere but
// the "Manage Server" button) opens a themed modal with Overview/Health/Ping tabs.
(function () {
  document.addEventListener('click', e => {
    const card = e.target.closest('#dash-cards .gcard');
    if (!card || e.target.closest('.gmanage')) return;
    if (typeof window.openModal !== 'function') return;

    const q = s => card.querySelector(s);
    const txt = (s, d) => { const el = q(s); return el ? el.textContent.trim() : (d || '—'); };
    const name = txt('.gcard-nm', 'Server');
    const host = txt('.gcard-host', '');
    const type = txt('.gtype', '');
    const brand = q('.gbrand') ? q('.gbrand').innerHTML : '';
    const status = txt('.gpill', '');
    const movies = txt('[data-st=movies]');
    const shows = txt('[data-st=shows]');
    const eps = txt('[data-st=episodes]');

    window.openModal(`
      <div class="modal-head">
        <div class="gbrand mhead-brand">${brand}</div>
        <div><div class="modal-nm">${name}</div><div class="modal-sub">${type}${host ? ' · ' + host : ''}</div></div>
        <div class="modal-x" data-close><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></div>
      </div>
      <div class="modal-tabs">
        <button class="on" data-mt="overview">Overview</button>
        <button data-mt="health">Health</button>
        <button data-mt="ping">Ping</button>
        <button data-mt="watching">Watching</button>
      </div>
      <div class="modal-body">
        <div class="mtab on" id="mt-overview">
          <div class="mchips">
            <div class="mchip"><div class="cn">${movies}</div><div class="ct">Movies</div></div>
            <div class="mchip"><div class="cn">${shows}</div><div class="ct">Shows</div></div>
            <div class="mchip"><div class="cn">${eps}</div><div class="ct">Episodes</div></div>
          </div>
          <div class="mrow">Status<span class="mtag">${status || '—'}</span></div>
          <div class="mrow">Host<span class="mtag">${host || '—'}</span></div>
          <div class="mrow">Type<span class="mtag">${type || '—'}</span></div>
        </div>
        <div class="mtab" id="mt-health">
          <div class="mrow">Uptime &amp; response history is tracked on the Health page.<span class="mtag"></span></div>
          <button class="btn-soft" data-goto="health" style="margin-top:10px">Open Health →</button>
        </div>
        <div class="mtab" id="mt-ping">
          <div class="mrow">Measure latency from your browser or the addon server.<span class="mtag"></span></div>
          <button class="btn-soft" data-goto="ping" style="margin-top:10px">Open Ping test →</button>
        </div>
        <div class="mtab" id="mt-watching">
          <div class="mrow">Live "now playing" sessions aren't tracked yet.<span class="mtag"></span></div>
          <div class="field-hint" style="margin-top:6px">Active-session reporting can be enabled per server in a future update.</div>
        </div>
      </div>`);
  });

  // tab links that jump to a page
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    if (window.closeModal) window.closeModal();
    location.hash = '#/' + g.dataset.goto;
  });
})();
