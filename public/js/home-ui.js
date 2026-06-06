// ─── Home page — live data + interactions ────────────────────────────────────
(function () {
  const DISCORD_URL = 'https://discord.gg/omegamedia'; // update to real invite if needed

  async function api(path) {
    try {
      const r = await fetch(path, { credentials: 'same-origin' });
      return r.ok ? r.json().catch(() => null) : null;
    } catch { return null; }
  }

  // ── Greeting with username ──────────────────────────────────────────────────
  async function loadGreeting() {
    const me = await api('/api/auth/me');
    const titleEl = document.getElementById('home-title');
    if (!titleEl) return;
    if (me && me.user) {
      const name = me.user.username || 'there';
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      const hour = new Date().getHours();
      const tod = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      titleEl.textContent = `${tod}, ${cap} 👋`;
    } else {
      titleEl.textContent = 'Welcome to Emby Bridge 👋';
    }
  }

  // ── Active services panel ───────────────────────────────────────────────────
  async function loadServices() {
    const body = document.getElementById('home-services-body');
    if (!body) return;

    const [cfg, st] = await Promise.all([
      api('/api/billing/config'),
      api('/api/billing/status'),
    ]);

    const billingEnabled = cfg && cfg.enabled;

    if (!billingEnabled) {
      // Billing not configured — show generic addon access row
      body.innerHTML = svcRowHTML(
        'Emby Bridge Addon',
        'Multi-server Stremio integration · Active',
        'Active',
        'success'
      );
      return;
    }

    if (!st) {
      body.innerHTML = '<div class="home-svc-loading">Could not load subscription info.</div>';
      return;
    }

    const isActive = st.status === 'active' || st.status === 'comped';
    if (isActive) {
      const renewal = st.periodEnd
        ? 'Renews ' + new Date(st.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      const planLabel = st.status === 'comped' ? 'Bridge Pro · Comped' : 'Bridge Pro';
      body.innerHTML = svcRowHTML(planLabel, renewal, 'Active', 'success');
      // update invoices count
      const inv = document.getElementById('hc-invoices-num');
      if (inv) inv.textContent = '0';
    } else {
      // No active sub — prompt to subscribe
      body.innerHTML = `<div class="home-no-service">No active subscription. <a class="home-panel-btn" data-page="billing" href="#" style="display:inline-flex;margin-left:6px">Subscribe →</a></div>`;
      wirePageLinks(body);
    }

    // services count
    const svcNum = document.getElementById('hc-services-num');
    if (svcNum) svcNum.textContent = isActive ? '1' : '0';
  }

  function svcRowHTML(name, meta, badgeText, badgeType) {
    const color = badgeType === 'success'
      ? 'color:var(--success);background:color-mix(in srgb,var(--success) 16%,transparent);border-color:color-mix(in srgb,var(--success) 30%,transparent)'
      : 'color:var(--warning);background:color-mix(in srgb,var(--warning) 16%,transparent);border-color:color-mix(in srgb,var(--warning) 30%,transparent)';
    return `
      <div class="home-svc-row">
        <span class="home-svc-badge" style="${color}">${badgeText}</span>
        <div class="home-svc-info">
          <div class="home-svc-name">${name}</div>
          ${meta ? `<div class="home-svc-meta">${meta}</div>` : ''}
        </div>
        <button class="home-svc-detail" data-page="billing">View Details</button>
      </div>
      <div class="home-view-more" data-page="billing">View More ›</div>`;
  }

  // ── Wire all data-page links/buttons inside a container ────────────────────
  function wirePageLinks(root) {
    root.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        location.hash = '#/' + el.dataset.page;
      });
    });
  }

  // ── Discord / ticket links ──────────────────────────────────────────────────
  function setupTicketLinks() {
    const btn = document.getElementById('home-ticket-btn');
    if (btn) { btn.href = DISCORD_URL; btn.target = '_blank'; btn.rel = 'noopener'; }

    const openBtn = document.getElementById('home-open-ticket');
    if (openBtn) openBtn.addEventListener('click', () => window.open(DISCORD_URL, '_blank', 'noopener'));
  }

  // ── Hero card click routing ─────────────────────────────────────────────────
  function setupHeroCards() {
    document.querySelectorAll('.home-hero-card[data-page]').forEach(card => {
      card.addEventListener('click', () => { location.hash = '#/' + card.dataset.page; });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/' + card.dataset.page; }
      });
    });

    // Discord card — opens external
    const discord = document.getElementById('hc-discord');
    if (discord) {
      discord.addEventListener('click', () => window.open(DISCORD_URL, '_blank', 'noopener'));
      discord.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.open(DISCORD_URL, '_blank', 'noopener'); }
      });
    }
  }

  // ── Launch / greeting button ────────────────────────────────────────────────
  function setupGreetingBtn() {
    document.querySelectorAll('.home-launch-btn').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = '#/' + (btn.dataset.page || 'dashboard'); });
    });
  }

  // ── Re-run animations when home becomes visible ─────────────────────────────
  function setupPageTransition() {
    // Resets animation by briefly removing + re-adding animated elements' class
    const origShow = window.onPageShow;
    window.onPageShow = function (name) {
      if (origShow) origShow(name);
      if (name !== 'home') return;
      const page = document.getElementById('page-home');
      if (!page) return;
      // force reflow to restart CSS animations
      const animEls = page.querySelectorAll('.home-hero-card, .home-panel, .home-greeting');
      animEls.forEach(el => { el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; });
    };
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    setupHeroCards();
    setupGreetingBtn();
    setupTicketLinks();
    setupPageTransition();

    const page = document.getElementById('page-home');
    if (page) wirePageLinks(page);

    // Load live data
    loadGreeting();
    loadServices();
  });
})();
