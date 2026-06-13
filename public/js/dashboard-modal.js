// Dashboard server-detail modal. Reads data from rendered .gcard DOM.
(function () {
  let _modalServer = { label: '', url: '' };

  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function refreshModalWatching() {
    const slot = document.getElementById('mt-watching');
    if (!slot || !slot.classList.contains('on')) return;
    const listEl = document.getElementById('modal-live-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="da-empty">Loading live sessions…</div>';
    try {
      const cached = window.Dashboard?.lastBundle;
      if (!(cached?.ts && Date.now() - cached.ts < 12000) && typeof window.Dashboard?.refreshLive === 'function') {
        await window.Dashboard.refreshLive();
      } else if (typeof window.fetchLiveBundle === 'function') {
        await window.fetchLiveBundle(true, { fast: true });
      }
      const live = window._mebAnnotatedLive || window.Dashboard?.lastBundle?.live || [];
      const ui = window.MEBLiveUI;
      const filtered = ui
        ? ui.filterLiveByServer(live, _modalServer)
        : live.filter(s => s.server === _modalServer.label);
      listEl.innerHTML = ui
        ? ui.renderLiveRows(filtered, { emptyHtml: '<div class="da-empty">Nothing playing on this server right now.</div>' })
        : (filtered.length ? filtered.map(s => `<div class="da-row">${esc(s.title)}</div>`).join('')
          : '<div class="da-empty">Nothing playing on this server right now.</div>');
    } catch {
      listEl.innerHTML = '<div class="da-empty">Could not load live sessions.</div>';
    }
  }

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
    const healthSlot = card.querySelector('.gcard-health');
    const healthHtml = healthSlot ? healthSlot.innerHTML : '<div class="gcard-health-empty">No health data yet</div>';

    _modalServer = { label: name, url: card.dataset.serverUrl || '' };

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
          <div class="modal-health-embed">${healthHtml}</div>
        </div>
        <div class="mtab" id="mt-ping">
          <div class="mrow">Measure latency from your browser or the addon server.<span class="mtag"></span></div>
          <button class="btn-soft" data-goto="ping" style="margin-top:10px">Open Ping test →</button>
        </div>
        <div class="mtab" id="mt-watching">
          <p class="field-hint" style="margin:0 0 10px">Live sessions on <strong>${esc(name)}</strong> · refreshes when you open this tab</p>
          <div class="da-list" id="modal-live-list"><div class="da-empty">Open this tab to load sessions…</div></div>
        </div>
      </div>`);
  });

  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      if (window.closeModal) window.closeModal();
      location.hash = '#/' + g.dataset.goto;
      return;
    }
    const tab = e.target.closest('#modal .modal-tabs button[data-mt="watching"]');
    if (tab) setTimeout(refreshModalWatching, 0);
  });
})();