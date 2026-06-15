// ─── Home page — live data + interactions ────────────────────────────────────
(function () {
  let _me = null;
  const HOME_CACHE_KEY = 'meb_home_cache';

  function saveHomeCache(data) {
    try { sessionStorage.setItem(HOME_CACHE_KEY, JSON.stringify(data)); } catch {}
  }

  function hydrateHomeCache() {
    if (!document.documentElement.classList.contains('meb-returning')) return false;
    try {
      const raw = sessionStorage.getItem(HOME_CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw);
      const title = document.getElementById('home-title');
      if (title && c.titleHtml) title.innerHTML = c.titleHtml;
      const dashBtn = document.getElementById('home-dash-btn');
      if (dashBtn && c.dashBtn != null) dashBtn.style.display = c.dashBtn ? 'flex' : 'none';
      const svcNum = document.getElementById('hc-services-num');
      if (svcNum && c.servicesNum != null) svcNum.textContent = c.servicesNum;
      const invNum = document.getElementById('hc-invoices-num');
      if (invNum && c.invoicesNum != null) invNum.textContent = c.invoicesNum;
      const ticketNum = document.getElementById('hc-tickets-num');
      const ticketSub = document.getElementById('hc-tickets-sub');
      if (ticketNum && c.ticketsNum != null) ticketNum.textContent = c.ticketsNum;
      if (ticketSub && c.ticketsSub != null) ticketSub.textContent = c.ticketsSub;
      const servicesBody = document.getElementById('home-services-body');
      if (servicesBody && c.servicesHtml) servicesBody.innerHTML = c.servicesHtml;
      const ticketsBody = document.getElementById('home-recent-tickets-body');
      if (ticketsBody && c.ticketsHtml) ticketsBody.innerHTML = c.ticketsHtml;
      const newsBody = document.getElementById('home-news-body');
      if (newsBody && c.newsHtml) newsBody.innerHTML = c.newsHtml;
      return true;
    } catch { return false; }
  }

  function snapshotHomeCache() {
    const title = document.getElementById('home-title');
    const dashBtn = document.getElementById('home-dash-btn');
    const servicesBody = document.getElementById('home-services-body');
    const ticketsBody = document.getElementById('home-recent-tickets-body');
    const newsBody = document.getElementById('home-news-body');
    if (!title || !servicesBody || !ticketsBody || !newsBody) return;
    if (servicesBody.querySelector('.home-svc-loading')) return;
    saveHomeCache({
      titleHtml: title.innerHTML,
      dashBtn: dashBtn ? dashBtn.style.display !== 'none' : false,
      servicesNum: document.getElementById('hc-services-num')?.textContent ?? '',
      invoicesNum: document.getElementById('hc-invoices-num')?.textContent ?? '',
      ticketsNum: document.getElementById('hc-tickets-num')?.textContent ?? '',
      ticketsSub: document.getElementById('hc-tickets-sub')?.textContent ?? '',
      servicesHtml: servicesBody.innerHTML,
      ticketsHtml: ticketsBody.innerHTML,
      newsHtml: newsBody.innerHTML,
    });
  }

  async function api(path) {
    try {
      const r = await fetch(path, { credentials: 'same-origin' });
      return r.ok ? r.json().catch(() => null) : null;
    } catch { return null; }
  }

  const esc = x => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtAgo = d => { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+'m ago'; if(s<86400) return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; };

  const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed', resolved: 'Resolved' };
  const CAT_LABEL = { general: 'General', streaming: 'Streaming', servers: 'Servers', billing: 'Billing', bug: 'Bug', feature: 'Feature' };

  // ── Greeting ────────────────────────────────────────────────────────────────
  function loadGreeting() {
    const el = document.getElementById('home-title');
    const sub = document.getElementById('home-sub');
    if (!el) return;
    if (_me && _me.user) {
      const cap = (_me.user.username||'there')[0].toUpperCase() + (_me.user.username||'there').slice(1);
      const h = new Date().getHours();
      const tod = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      // Username is user-controlled — set as text (not interpolated into innerHTML)
      // to prevent self-XSS, then append the decorative wave.
      el.textContent = `${tod}, ${cap} `;
      const wave = document.createElement('span');
      wave.className = 'wave';
      wave.textContent = '👋';
      el.appendChild(wave);
      if (sub) {
        if (_me.user.role === 'admin') {
          sub.textContent = 'Full admin access — manage servers, users, and support from here.';
        } else {
          sub.textContent = 'Glad you\'re here — your bridge settings are synced and ready.';
        }
      }
    } else {
      el.innerHTML = 'Welcome to Stream Hub <span class="wave">👋</span>';
      if (sub) sub.textContent = 'Sign in to manage your servers, manifest, and support tickets.';
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
      body.innerHTML = svcRowHTML('Stream Hub', 'Admin · Full Access', 'Admin', 'success');
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
      body.innerHTML = svcRowHTML('Stream Hub', 'Multi-server Stremio integration · Active', 'Active', 'success');
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

  function updateTicketStats(tickets) {
    const list = Array.isArray(tickets) ? tickets : [];
    const open = list.filter(t => t.status === 'open' || t.status === 'in_progress').length;
    const total = list.length;
    const num = document.getElementById('hc-tickets-num');
    const sub = document.getElementById('hc-tickets-sub');
    if (num) num.textContent = String(total);
    if (sub) sub.textContent = open === 1 ? '1 open' : `${open} open`;
  }

  function openTicket(id) {
    try { sessionStorage.setItem('meb_open_ticket', id); } catch {}
    location.hash = '#/tickets';
  }

  // ── Recent tickets — renders pre-fetched data immediately ───────────────────
  function renderRecentTickets(tickets) {
    const body = document.getElementById('home-recent-tickets-body');
    if (!body) return;

    updateTicketStats(tickets);

    if (!Array.isArray(tickets) || tickets.length === 0) {
      body.innerHTML = `
        <div class="home-empty-state">
          <span class="empty-emoji">🕊️</span>
          <div style="font-weight:600; color:var(--text-primary); margin-bottom:2px;">All quiet here</div>
          <div style="font-size:.78rem; opacity:.75;">Use <strong>+ New Ticket</strong> above when you need help.</div>
        </div>`;
      return;
    }

    const tagFor = t => {
      if (t.status === 'closed' || t.status === 'resolved') return [STATUS_LABEL[t.status] || 'Closed', 'hrc-tag-closed'];
      if (t.unread > 0) return ['New reply', 'hrc-tag-responded'];
      if (t.status === 'in_progress') return ['In progress', 'hrc-tag-progress'];
      return ['Open', 'hrc-tag-waiting'];
    };

    body.innerHTML = tickets.slice(0, 5).map(t => {
      const [tag, cls] = tagFor(t);
      const cat = CAT_LABEL[t.category] || t.category || 'General';
      return `<div class="hrc-row" data-id="${esc(t.id)}">
        <div class="hrc-dot hrc-dot-${esc(t.status)}"></div>
        <div class="hrc-info">
          <div class="hrc-subject">${esc(t.subject)}</div>
          <div class="hrc-meta">${esc(cat)} · ${fmtAgo(t.updated_at)}${t.unread > 0 ? ` · <span class="hrc-unread">${t.unread} new</span>` : ''}</div>
        </div>
        <span class="hrc-tag ${cls}">${tag}</span>
      </div>`;
    }).join('');

    body.querySelectorAll('.hrc-row').forEach(row =>
      row.addEventListener('click', () => openTicket(row.dataset.id))
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
    if (btn) btn.addEventListener('click', e => {
      e.preventDefault();
      try { sessionStorage.setItem('meb_new_ticket', '1'); } catch {}
      location.hash = '#/tickets';
    });
    document.getElementById('home-view-tickets')?.addEventListener('click', e => {
      e.preventDefault();
      location.hash = '#/tickets';
    });
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
        snapshotHomeCache();
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
    const hydrated = hydrateHomeCache();
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
    await loadServices();         // starts billing API calls async
    renderRecentTickets(tickets);   // instant — data already here
    renderNews(news);               // instant — data already here
    if (hydrated) {
      const page = document.getElementById('page-home');
      if (page) wirePageLinks(page);
      setupHeroCards();
      setupGreetingBtn();
      setupTicketLinks();
    }
    snapshotHomeCache();
  });
})();
