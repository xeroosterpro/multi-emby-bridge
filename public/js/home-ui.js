// ─── Home page — live data + interactions ────────────────────────────────────
(function () {
  let _me = null;

  async function api(path) {
    try {
      const r = await fetch(path, { credentials: 'same-origin' });
      return r.ok ? r.json().catch(() => null) : null;
    } catch { return null; }
  }

  const esc = x => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtAgo = d => { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+'m ago'; if(s<86400) return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; };

  // ── Greeting ────────────────────────────────────────────────────────────────
  function loadGreeting() {
    const el = document.getElementById('home-title');
    if (!el) return;
    if (_me && _me.user) {
      const cap = (_me.user.username||'there')[0].toUpperCase() + (_me.user.username||'there').slice(1);
      const h = new Date().getHours();
      const tod = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      el.innerHTML = `${tod}, ${cap} <span class="wave">👋</span>`;
    } else {
      el.innerHTML = 'Welcome to Stream-Hub <span class="wave">👋</span>';
    }
  }

  // ── Open Dashboard button — admin or active subscriber only ─────────────────
  function showDashBtn(show) {
    const btn = document.getElementById('home-dash-btn');
    if (btn) btn.style.display = show ? 'flex' : 'none';
  }

  // ── Active services panel ───────────────────────────────────────────────────
  async function loadServices() {
    const body = document.getElementById('home-services-body');
    if (!body) return;

    if (_me && _me.user && _me.user.role === 'admin') {
      body.innerHTML = svcRowHTML('Stream-Hub', 'Admin · Full Access', 'Admin', 'success');
      wirePageLinks(body);
      const svcNum = document.getElementById('hc-services-num');
      if (svcNum) svcNum.textContent = '1';
      showDashBtn(true);
      return;
    }

    const [cfg, st] = await Promise.all([
      api('/api/billing/config'),
      api('/api/billing/status'),
    ]);

    const billingEnabled = cfg && cfg.enabled;
    if (!billingEnabled) {
      body.innerHTML = svcRowHTML('Stream-Hub', 'Multi-server Stremio integration · Active', 'Active', 'success');
      wirePageLinks(body);
      showDashBtn(true);
      return;
    }

    if (!st) {
      body.innerHTML = '<div class="home-svc-loading">Could not load subscription info.</div>';
      showDashBtn(false);
      return;
    }

    const isActive = st.status === 'active' || st.status === 'comped';
    showDashBtn(isActive);

    if (isActive) {
      const renewal = st.periodEnd
        ? 'Renews ' + new Date(st.periodEnd).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
        : '';
      const planLabel = st.status === 'comped' ? 'Bridge Pro · Comped' : 'Bridge Pro';
      body.innerHTML = svcRowHTML(planLabel, renewal, 'Active', 'success');
      wirePageLinks(body);
      const inv = document.getElementById('hc-invoices-num');
      if (inv) inv.textContent = '0';
    } else {
      body.innerHTML = `<div class="home-no-service">No active subscription. <a class="home-panel-btn" data-page="billing" href="#" style="display:inline-flex;margin-left:6px">Subscribe →</a></div>`;
      wirePageLinks(body);
    }
    const svcNum = document.getElementById('hc-services-num');
    if (svcNum) svcNum.textContent = isActive ? '1' : '0';
  }

  function svcRowHTML(name, meta, badgeText, badgeType) {
    const color = badgeType === 'success'
      ? 'color:var(--success);background:color-mix(in srgb,var(--success) 16%,transparent);border-color:color-mix(in srgb,var(--success) 30%,transparent)'
      : 'color:var(--warning);background:color-mix(in srgb,var(--warning) 16%,transparent);border-color:color-mix(in srgb,var(--warning) 30%,transparent)';
    return `<div class="home-svc-row">
        <span class="home-svc-badge" style="${color}">${esc(badgeText)}</span>
        <div class="home-svc-info">
          <div class="home-svc-name">${esc(name)}</div>
          ${meta ? `<div class="home-svc-meta">${esc(meta)}</div>` : ''}
        </div>
        <button class="home-svc-detail" data-page="billing">View Details</button>
      </div>
      <div class="home-view-more" data-page="billing">View More ›</div>`;
  }

  // ── Recent tickets — renders pre-fetched data immediately ───────────────────
  function renderRecentTickets(tickets) {
    const body = document.getElementById('home-recent-tickets-body');
    if (!body) return;

    // Update hero card
    const hcNum = document.querySelector('#hc-discord .hhc-num');
    if (hcNum) hcNum.textContent = Array.isArray(tickets) ? tickets.filter(t => t.status === 'open').length : 0;

    if (!Array.isArray(tickets) || tickets.length === 0) {
      body.innerHTML = `
        <div class="home-empty-state">
          <span class="empty-emoji">🕊️</span>
          <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px;">All quiet here</div>
          <div style="font-size:.78rem; opacity:.75;">Use the <strong>+ Open New Ticket</strong> button above to get started.</div>
        </div>`;
      return;
    }

    const tagFor = t => {
      if (t.status === 'closed') return ['Closed',    'hrc-tag-closed'];
      if (t.unread  > 0)         return ['Responded', 'hrc-tag-responded'];
      return                            ['Waiting',   'hrc-tag-waiting'];
    };

    body.innerHTML = tickets.slice(0, 5).map(t => {
      const [tag, cls] = tagFor(t);
      return `<div class="hrc-row" data-id="${esc(t.id)}">
        <div class="hrc-dot hrc-dot-${esc(t.status)}"></div>
        <div class="hrc-info">
          <div class="hrc-subject">${esc(t.subject)}</div>
          <div class="hrc-meta">${fmtAgo(t.updated_at)}</div>
        </div>
        <span class="hrc-tag ${cls}">${tag}</span>
      </div>`;
    }).join('');

    body.querySelectorAll('.hrc-row').forEach(row =>
      row.addEventListener('click', () => { location.hash = '#/tickets'; })
    );
  }

  // ── News — renders pre-fetched data immediately ─────────────────────────────
  function renderNews(news) {
    const body = document.getElementById('home-news-body');
    if (!body) return;
    if (!Array.isArray(news) || news.length === 0) {
      body.innerHTML = `
        <div class="home-empty-state" style="padding:20px 14px; background:transparent; box-shadow:none; margin:0; border-radius:10px;">
          <span class="empty-emoji" style="font-size:1.55rem; margin-bottom:4px; opacity:.7;">🌱</span>
          <div style="font-size:.8rem; color:var(--text-muted); line-height:1.35;">No updates yet.<br>We'll share exciting news here as it happens.</div>
        </div>`;
      return;
    }
    const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
    body.innerHTML = news.slice(0, 8).map(n => `
      <div class="home-news-item">
        <div class="home-news-title">${esc(n.title)}</div>
        ${n.body ? `<div class="home-news-body">${esc(n.body)}</div>` : ''}
        <div class="home-news-date">${fmtDate(n.created_at)}</div>
      </div>`).join('');
  }

  // ── Wire all data-page links inside a container ─────────────────────────────
  function wirePageLinks(root) {
    root.querySelectorAll('[data-page]').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; })
    );
  }

  // ── Hero card click routing ─────────────────────────────────────────────────
  function setupHeroCards() {
    document.querySelectorAll('.home-hero-card[data-page]').forEach(card => {
      card.addEventListener('click', () => { location.hash = '#/' + card.dataset.page; });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/' + card.dataset.page; }
      });
    });
    const supportCard = document.getElementById('hc-discord');
    if (supportCard) {
      supportCard.addEventListener('click', () => { location.hash = '#/tickets'; });
      supportCard.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/tickets'; }
      });
    }
  }

  function setupGreetingBtn() {
    document.querySelectorAll('.home-launch-btn').forEach(btn =>
      btn.addEventListener('click', () => { location.hash = '#/' + (btn.dataset.page || 'dashboard'); })
    );
  }

  function setupTicketLinks() {
    const btn = document.getElementById('home-ticket-btn');
    if (btn) btn.addEventListener('click', e => { e.preventDefault(); location.hash = '#/tickets'; });
  }

  // ── Re-run animations + refresh data when home becomes active ───────────────
  let _homeShownOnce = false;
  function setupPageTransition() {
    const origShow = window.onPageShow;
    window.onPageShow = function (name) {
      if (origShow) origShow(name);
      if (name !== 'home') return;
      const page = document.getElementById('page-home');
      if (!page) return;
      /* First paint (incl. F5 refresh): CSS handles one entrance — don't force a second replay. */
      if (!_homeShownOnce) { _homeShownOnce = true; return; }
      page.querySelectorAll('.home-hero-card, .home-panel, .home-greeting')
          .forEach(el => { el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; });
      // Refresh tickets + news when revisiting home
      Promise.all([api('/api/tickets'), api('/api/news')]).then(([t, n]) => {
        renderRecentTickets(t);
        renderNews(n);
      });
      // re-init mouse glow + 3D tilts
      setupMouseGlow();
      setupCardTilts();
    };
  }

  // Premium mouse-follow soft spotlight for wow interactive smoothness on home
  function setupMouseGlow() {
    const wrap = document.querySelector('#page-home .home-wrap');
    if (!wrap) return;

    let raf = null;
    const onMove = (e) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = wrap.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        wrap.style.setProperty('--mx', `${x}%`);
        wrap.style.setProperty('--my', `${y}%`);
      });
    };

    const onLeave = () => {
      // gently return to a nice default position (top-center, warm welcome spot)
      wrap.style.setProperty('--mx', '48%');
      wrap.style.setProperty('--my', '18%');
    };

    wrap.addEventListener('mousemove', onMove, { passive: true });
    wrap.addEventListener('mouseleave', onLeave);

    // set nice initial position
    wrap.style.setProperty('--mx', '48%');
    wrap.style.setProperty('--my', '18%');
  }

  // Real 3D tilt on individual hero cards — physical, delightful, high-wow UX
  function setupCardTilts() {
    const cards = document.querySelectorAll('#page-home .home-hero-card');
    cards.forEach(card => {
      let tiltRaf = null;

      const applyTilt = (e) => {
        if (tiltRaf) cancelAnimationFrame(tiltRaf);
        tiltRaf = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width - 0.5;
          const y = (e.clientY - rect.top) / rect.height - 0.5;
          // Subtle but noticeable 3D tilt (stronger on request)
          card.style.setProperty('--rx', `${y * -11}deg`);
          card.style.setProperty('--ry', `${x * 15}deg`);
        });
      };

      const resetTilt = () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      };

      card.addEventListener('mousemove', applyTilt, { passive: true });
      card.addEventListener('mouseleave', resetTilt);
      card.addEventListener('mouseenter', resetTilt); // clean start
    });
  }

  // ── Boot — fire ALL fetches at the same time ────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    // All three requests start immediately in parallel — no sequential waiting
    const [meData, tickets, news] = await Promise.all([
      api('/api/auth/me'),
      api('/api/tickets'),
      api('/api/news'),
    ]);
    _me = meData;

    setupHeroCards();
    setupGreetingBtn();
    setupTicketLinks();
    setupPageTransition();
    setupMouseGlow();
    setupCardTilts();
    const page = document.getElementById('page-home');
    if (page) wirePageLinks(page);

    loadGreeting();
    loadServices();         // starts billing API calls async
    renderRecentTickets(tickets);   // instant — data already here
    renderNews(news);               // instant — data already here
  });
})();
