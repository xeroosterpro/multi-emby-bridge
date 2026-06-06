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
    const titleEl = document.getElementById('home-title');
    if (!titleEl) return;
    if (_me && _me.user) {
      const name = _me.user.username || 'there';
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      const hour = new Date().getHours();
      const tod = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      titleEl.textContent = `${tod}, ${cap} 👋`;
    } else {
      titleEl.textContent = 'Welcome to Emby Bridge 👋';
    }
  }

  // ── Open Dashboard button — only for admin or active subscriber ─────────────
  function showDashBtn(isAccess) {
    const btn = document.getElementById('home-dash-btn');
    if (btn) btn.style.display = isAccess ? 'flex' : 'none';
  }

  // ── Active services panel ───────────────────────────────────────────────────
  async function loadServices() {
    const body = document.getElementById('home-services-body');
    if (!body) return;

    if (_me && _me.user && _me.user.role === 'admin') {
      body.innerHTML = svcRowHTML('Emby Bridge Addon', 'Admin · Full Access', 'Admin', 'success');
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
      body.innerHTML = svcRowHTML('Emby Bridge Addon', 'Multi-server Stremio integration · Active', 'Active', 'success');
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
        ? 'Renews ' + new Date(st.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
    return `
      <div class="home-svc-row">
        <span class="home-svc-badge" style="${color}">${esc(badgeText)}</span>
        <div class="home-svc-info">
          <div class="home-svc-name">${esc(name)}</div>
          ${meta ? `<div class="home-svc-meta">${esc(meta)}</div>` : ''}
        </div>
        <button class="home-svc-detail" data-page="billing">View Details</button>
      </div>
      <div class="home-view-more" data-page="billing">View More ›</div>`;
  }

  // ── Recent tickets panel ────────────────────────────────────────────────────
  async function loadRecentTickets() {
    const body = document.getElementById('home-recent-tickets-body');
    if (!body) return;

    const tickets = await api('/api/tickets');

    // Update hero card count
    const hcNum = document.querySelector('#hc-discord .hhc-num');
    if (hcNum) hcNum.textContent = Array.isArray(tickets) ? tickets.filter(t => t.status === 'open').length : 0;

    // Update sidebar badge via tickets-ui if loaded
    if (window._tktBadge && Array.isArray(tickets)) window._tktBadge(tickets);

    if (!Array.isArray(tickets) || tickets.length === 0) {
      body.innerHTML = `<div class="home-empty-state" style="padding:16px 0">No recent tickets yet.<br>Click <strong>+ Open New Ticket</strong> if you need help.</div>`;
      return;
    }

    const tagFor = t => {
      if (t.status === 'closed')  return ['Closed',     'hrc-tag-closed'];
      if (t.unread  > 0)          return ['Responded',  'hrc-tag-responded'];
      return                             ['Waiting',     'hrc-tag-waiting'];
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

    body.querySelectorAll('.hrc-row').forEach(row => {
      row.addEventListener('click', () => { location.hash = '#/tickets'; });
    });
  }

  // ── News feed ───────────────────────────────────────────────────────────────
  async function loadNews() {
    const body = document.getElementById('home-news-body');
    if (!body) return;
    const news = await api('/api/news');
    if (!news || !Array.isArray(news) || news.length === 0) {
      body.innerHTML = '<div class="home-news-empty">No news yet.</div>';
      return;
    }
    const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    body.innerHTML = news.slice(0, 8).map(n => `
      <div class="home-news-item">
        <div class="home-news-title">${esc(n.title)}</div>
        ${n.body ? `<div class="home-news-body">${esc(n.body)}</div>` : ''}
        <div class="home-news-date">${fmtDate(n.created_at)}</div>
      </div>`).join('');
  }

  // ── Wire all data-page links/buttons inside a container ────────────────────
  function wirePageLinks(root) {
    root.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); location.hash = '#/' + el.dataset.page; });
    });
  }

  // ── Ticket panel header button ──────────────────────────────────────────────
  function setupTicketLinks() {
    const btn = document.getElementById('home-ticket-btn');
    if (btn) btn.addEventListener('click', e => { e.preventDefault(); location.hash = '#/tickets'; });
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

  // ── Greeting launch button ──────────────────────────────────────────────────
  function setupGreetingBtn() {
    document.querySelectorAll('.home-launch-btn').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = '#/' + (btn.dataset.page || 'dashboard'); });
    });
  }

  // ── Re-run animations when home becomes visible ─────────────────────────────
  function setupPageTransition() {
    const origShow = window.onPageShow;
    window.onPageShow = function (name) {
      if (origShow) origShow(name);
      if (name !== 'home') return;
      const page = document.getElementById('page-home');
      if (!page) return;
      const animEls = page.querySelectorAll('.home-hero-card, .home-panel, .home-greeting');
      animEls.forEach(el => { el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; });
      // Refresh live data when user returns to home
      loadRecentTickets();
      loadNews();
    };
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    _me = await api('/api/auth/me');

    setupHeroCards();
    setupGreetingBtn();
    setupTicketLinks();
    setupPageTransition();

    const page = document.getElementById('page-home');
    if (page) wirePageLinks(page);

    loadGreeting();
    loadServices();
    loadRecentTickets();
    loadNews();
  });
})();
