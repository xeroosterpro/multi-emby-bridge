// ─── Billing UI: plans, PayPal subscribe, discount redeem, access gating ─────
(function () {
  const $ = s => document.querySelector(s);
  async function api(p, o) {
    const r = await fetch(p, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, o || {}));
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  const esc = x => String(x == null ? '' : x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const money = p => (p.amount != null ? '$' + Number(p.amount).toFixed(2) : '—') + (p.currency && p.currency !== 'USD' ? ' ' + esc(p.currency) : '');
  const date = d => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  let sdkLoading = null;
  function loadSDK(clientId) {
    if (window.paypal) return Promise.resolve();
    if (sdkLoading) return sdkLoading;
    sdkLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription`;
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    return sdkLoading;
  }

  function viewAsMode() {
    return window.MEBSite && window.MEBSite.getViewAsMode ? window.MEBSite.getViewAsMode() : 'off';
  }

  function applyGate(locked) {
    if (window.MEBDemo && window.MEBDemo.isActive()) { locked = false; }
    document.body.classList.toggle('locked-billing', locked);
    if (locked && location.hash !== '#/billing') location.hash = '#/billing';
  }

  function setBillingNav(subscribed) {
    window._mebBillingPreview = { subscribed: !!subscribed };
    const link = document.querySelector('.billing-link');
    if (link) link.style.display = subscribed ? 'none' : '';
  }

  function renderActiveShell(st, opts = {}) {
    const preview = opts.demo ? '<span class="bill-preview-tag">Demo mode · sample data</span>'
      : opts.preview ? '<span class="bill-preview-tag">Preview mode</span>' : '';
    const renew = st.periodEnd ? date(st.periodEnd) : '—';
    return `<div class="bill-shell">
      <div class="bill-hero bill-hero-active">
        <div class="bill-hero-glow"></div>
        ${preview}
        <div class="bill-hero-badge">● Active</div>
        <h2 class="bill-hero-title">Bridge Pro</h2>
        <p class="bill-hero-sub">Your subscription is active — full streaming access enabled</p>
      </div>
      <div class="bill-active-grid">
        <div class="bill-card bill-card-status">
          <div class="bill-card-head"><span class="bill-card-label">Subscription</span><span class="bill-status-pill active">${esc(st.status)}</span></div>
          <div class="bill-stat-row"><span>Plan</span><strong>Bridge Pro</strong></div>
          <div class="bill-stat-row"><span>Renews</span><strong>${renew}</strong></div>
          <div class="bill-stat-row"><span>Price</span><strong>${esc(st.planPrice || '$4/mo')}</strong></div>
          ${opts.preview ? '' : '<button class="btn-soft bill-cancel" type="button">Cancel subscription</button>'}
        </div>
        <div class="bill-card bill-card-perks">
          <div class="bill-card-head"><span class="bill-card-label">Your plan includes</span></div>
          <ul class="bill-perk-list">
            <li>Unlimited servers</li><li>Personal manifest URL</li><li>Stream routing</li>
            <li>Health monitoring</li><li>Support tickets</li>
          </ul>
        </div>
      </div>
      <div id="bill-history-slot"></div>
    </div>`;
  }

  const DEMO_STEPS = [
    {
      title: 'Your bridge into Stremio',
      desc: 'Stream-Hub connects every Emby and Jellyfin server you own into one private Stremio addon. Browse in Stremio, play from your libraries — no uploads, no piracy, just your media.',
      bullets: ['Works with Emby & Jellyfin', 'One addon, unlimited servers', 'Cloud-synced settings'],
      visual: `<div class="demo-mock demo-mock-hero"><div class="demo-mock-logo">◢</div><p class="demo-mock-tagline">Stremio on the front.<br>Your servers on the back.</p></div>`,
    },
    {
      title: 'Click play in Stremio',
      desc: 'Install the addon once and every movie or episode you open in Stremio gets real streams from your libraries. It feels native — like the content was always there.',
      bullets: ['Movies & series supported', 'Episode-aware for TV shows', 'Instant stream links'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Stremio · Streams</div>
        <div class="demo-mock-row"><div class="demo-mock-poster"></div><div><div class="demo-mock-name">Dune: Part Two</div><div class="demo-mock-meta">2160p · HDR · Atmos</div></div><span class="demo-mock-play">▶ Play</span></div>
        <div class="demo-mock-row"><div class="demo-mock-poster"></div><div><div class="demo-mock-name">Breaking Bad S01E01</div><div class="demo-mock-meta">1080p · HEVC</div></div><span class="demo-mock-play">▶ Play</span></div></div></div>`,
    },
    {
      title: 'The bread & butter: best file wins',
      desc: 'When you hit play, StreamHub digs into every server for the same title, compares file size, quality, and your audio preferences — then serves the winner in Stremio.',
      bullets: ['Parallel search across all servers', 'Largest / best-quality file wins', 'Your audio & codec rules apply'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Request log · routing</div>
        <div class="demo-mock-flow"><span class="demo-mock-node">Stremio</span><span class="demo-mock-arrow">→</span><span class="demo-mock-node hub">Bridge</span><span class="demo-mock-arrow">→</span><span class="demo-mock-node">Servers</span></div>
        <div class="demo-mock-servers"><span class="demo-mock-chip ok">✓ Cloud Emby 4K</span><span class="demo-mock-chip miss">– Jellyfin</span><span class="demo-mock-chip win">★ Best pick</span></div></div></div>`,
    },
    {
      title: 'Streaming preferences',
      desc: 'Set defaults for quality, audio language, subtitles, and source priority. The bridge respects your choices every time Stremio asks for a stream.',
      bullets: ['Quality & codec preferences', 'Audio / subtitle defaults', 'Per-server priority order'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Streaming settings</div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">Prefer 4K when available</div><div class="demo-mock-meta">Largest file wins</div></div></div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">English audio first</div><div class="demo-mock-meta">Fallback to original</div></div></div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">Server priority</div><div class="demo-mock-meta">Emby → Jellyfin → Backup</div></div></div></div></div>`,
    },
    {
      title: 'Custom catalog rows',
      desc: 'Optional but powerful: add Trakt lists, MDBList collections, IMDb RSS, and Letterboxd lists as rows on your Stremio home screen — curated by you.',
      bullets: ['Trakt & MDBList integration', 'Shuffle rows on refresh', 'Mix personal lists with your servers'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Stremio home · catalogs</div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">🔥 Trakt Trending</div><div class="demo-mock-meta">Updated hourly</div></div></div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">📋 My Watchlist</div><div class="demo-mock-meta">MDBList · shuffled</div></div></div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">🎬 Continue Watching</div><div class="demo-mock-meta">From your servers</div></div></div></div></div>`,
    },
    {
      title: 'Your private manifest',
      desc: 'Every account gets a unique install URL. Paste it into Stremio once — settings update automatically whenever you change servers or preferences here.',
      bullets: ['Personal /u/:token manifest', 'QR code for mobile Stremio', 'Encrypted API keys stored server-side'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Install link</div>
        <div class="demo-mock-url">…/u/your-token/manifest.json</div>
        <div class="demo-mock-servers" style="margin-top:12px"><span class="demo-mock-chip">Copy link</span><span class="demo-mock-chip">QR scan</span><span class="demo-mock-chip win">Auto-sync</span></div></div></div>`,
    },
    {
      title: 'Health & monitoring',
      desc: 'The dashboard shows uptime bars and response charts per server. The request log records every lookup — so you always know what played and from where.',
      bullets: ['Live server status cards', 'Ping test from browser & cloud', 'Request log with success rate'],
      visual: `<div class="demo-mock"><div class="demo-mock-card"><div class="demo-mock-title">Dashboard · uptime</div>
        <div class="demo-mock-row"><div><div class="demo-mock-name">Cloud Emby</div><div class="demo-mock-meta">Online · 42ms</div></div></div>
        <div class="demo-mock-bars"><span class="demo-mock-bar" style="height:80%"></span><span class="demo-mock-bar" style="height:100%"></span><span class="demo-mock-bar" style="height:95%"></span><span class="demo-mock-bar" style="height:88%"></span><span class="demo-mock-bar" style="height:100%"></span></div></div></div>`,
    },
    {
      title: 'Ready to unlock?',
      desc: 'Subscribe to Bridge Pro and get full streaming access in minutes: add servers, generate your install link, and start watching from Stremio today.',
      bullets: ['Cancel anytime via PayPal', 'Discount codes supported', 'Priority support tickets included'],
      visual: `<div class="demo-mock demo-mock-hero"><div class="demo-mock-logo">▶</div><p class="demo-mock-tagline">Subscribe below to activate your bridge and start streaming.</p></div>`,
    },
  ];

  let demoStep = 0;

  function renderDemoStep(i) {
    const step = DEMO_STEPS[i];
    if (!step) return;
    const total = DEMO_STEPS.length;
    const label = $('#bill-demo-step-label');
    const title = $('#bill-demo-title');
    const desc = $('#bill-demo-desc');
    const bullets = $('#bill-demo-bullets');
    const visual = $('#bill-demo-visual');
    const dots = $('#bill-demo-dots');
    const next = $('#bill-demo-next');
    const back = $('#bill-demo-back');
    if (label) label.textContent = `Step ${i + 1} of ${total}`;
    if (title) title.textContent = step.title;
    if (desc) desc.textContent = step.desc;
    if (bullets) bullets.innerHTML = (step.bullets || []).map(b => `<li>${esc(b)}</li>`).join('');
    if (visual) visual.innerHTML = step.visual;
    if (dots) {
      dots.innerHTML = DEMO_STEPS.map((_, j) =>
        `<span class="bill-demo-dot${j === i ? ' on' : j < i ? ' done' : ''}"></span>`
      ).join('');
    }
    if (back) back.style.visibility = i === 0 ? 'hidden' : 'visible';
    if (next) next.textContent = i === total - 1 ? 'Got it — subscribe' : 'Next →';
  }

  function openDemoTour(start = 0) {
    const overlay = $('#bill-demo-overlay');
    if (!overlay) return;
    demoStep = Math.max(0, Math.min(start, DEMO_STEPS.length - 1));
    renderDemoStep(demoStep);
    overlay.style.display = 'grid';
    requestAnimationFrame(() => overlay.classList.add('on'));
    document.body.style.overflow = 'hidden';
  }

  function closeDemoTour() {
    const overlay = $('#bill-demo-overlay');
    if (!overlay) return;
    overlay.classList.remove('on');
    document.body.style.overflow = '';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }

  function wireDemoTour() {
    document.querySelectorAll('.bill-demo-site').forEach(btn => {
      if (btn._siteW) return;
      btn._siteW = 1;
      btn.addEventListener('click', () => {
        if (window.MEBDemo && window.MEBDemo.enter) window.MEBDemo.enter();
      });
    });
    document.querySelectorAll('.bill-demo-open').forEach(btn => {
      if (btn._demoW) return;
      btn._demoW = 1;
      btn.addEventListener('click', () => openDemoTour(0));
    });
    const close = $('#bill-demo-close');
    const skip = $('#bill-demo-skip');
    const back = $('#bill-demo-back');
    const next = $('#bill-demo-next');
    const overlay = $('#bill-demo-overlay');
    if (close && !close._demoW) { close._demoW = 1; close.addEventListener('click', closeDemoTour); }
    if (skip && !skip._demoW) { skip._demoW = 1; skip.addEventListener('click', closeDemoTour); }
    if (back && !back._demoW) {
      back._demoW = 1;
      back.addEventListener('click', () => { if (demoStep > 0) { demoStep--; renderDemoStep(demoStep); } });
    }
    if (next && !next._demoW) {
      next._demoW = 1;
      next.addEventListener('click', () => {
        if (demoStep < DEMO_STEPS.length - 1) { demoStep++; renderDemoStep(demoStep); }
        else closeDemoTour();
      });
    }
    if (overlay && !overlay._demoW) {
      overlay._demoW = 1;
      overlay.addEventListener('click', e => { if (e.target === overlay) closeDemoTour(); });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay.classList.contains('on')) closeDemoTour();
      });
    }
  }

  function renderLockedShell(cfg) {
    const plans = cfg.plans || [
      { id: 'free', name: 'Free', price: '$0', period: 'forever', features: ['Browse only'], limited: true },
      { id: 'pro', name: 'Bridge Pro', price: cfg.planPrice, period: 'month', features: ['Unlimited servers','Manifest URL','Stream routing'], featured: true },
    ];
    const free = plans.find(p => p.id === 'free') || plans[0];
    const pro = plans.find(p => p.id === 'pro' || p.featured) || plans[1] || plans[0];
    const featList = (arr) => (arr || []).map(f => `<li>${esc(f)}</li>`).join('');
    const preview = viewAsMode() === 'unpaid' ? '<span class="bill-preview-tag">Preview · unpaid user</span>' : '';

    const proFeats = [
      'Search every Emby & Jellyfin server at once',
      'Auto-pick the biggest / best-quality file',
      'Your preferred audio, codec & language rules',
      'Personal Stremio manifest URL',
      'Health monitoring & request log',
      'Unlimited servers · cancel anytime',
    ];

    return `<div class="bill-shell bill-shell-v2">
      <div class="bill-layout">
        <section class="bill-pitch-compact">
          <div class="bill-pitch-glow"></div>
          ${preview}
          <div class="bill-pitch-grid">
            <div class="bill-pitch-copy">
              <p class="bill-pitch-eyebrow">The bread &amp; butter</p>
              <h1 class="bill-pitch-title">All your servers. One Stremio addon. <span class="bill-pitch-accent">The best file wins.</span></h1>
              <p class="bill-pitch-lead">Add every Emby &amp; Jellyfin server. On play, StreamHub searches each library, compares file size, quality &amp; your audio prefs — then serves the winner.</p>
              <div class="bill-pitch-flow">
                <span class="bpf-node">▶ Stremio</span><span class="bpf-arrow">→</span>
                <span class="bpf-node bpf-hub">StreamHub</span><span class="bpf-arrow">→</span>
                <span class="bpf-servers"><span>Emby</span><span>Jellyfin</span><span>+ more</span></span>
                <span class="bpf-arrow">→</span><span class="bpf-win">★ Best stream</span>
              </div>
              <div class="bill-pitch-chips">
                <span class="bill-chip"><em>1</em> Search all servers</span>
                <span class="bill-chip"><em>2</em> Compare files</span>
                <span class="bill-chip"><em>3</em> Play best pick</span>
              </div>
            </div>
            <div class="bill-pitch-actions">
              <button class="bill-demo-btn bill-demo-site" type="button">
                <span class="bill-demo-btn-ic">◆</span><span>Explore full demo site</span>
              </button>
              <button class="bill-demo-btn bill-demo-tour bill-demo-open" type="button">
                <span class="bill-demo-btn-ic">▶</span><span>Quick slideshow</span>
              </button>
            </div>
          </div>
        </section>

        <section class="bill-plans bill-plans-v2">
          <div class="bill-plan${free.limited ? ' bill-plan-muted' : ''}">
            <div class="bill-plan-name">${esc(free.name)}</div>
            <div class="bill-plan-price">${esc(free.price)}</div>
            <div class="bill-plan-period">${esc(free.period || '')}</div>
            <ul class="bill-plan-feats"><li>Browse the site</li><li>No streaming</li><li>No routing</li></ul>
            <div class="bill-plan-cta muted">Current level</div>
          </div>
          <div class="bill-plan bill-plan-featured">
            <div class="bill-plan-badge">Recommended</div>
            <div class="bill-plan-name">${esc(pro.name)}</div>
            <div class="bill-plan-price">${esc(pro.price)}</div>
            <div class="bill-plan-period">per ${esc(pro.period || 'month')}</div>
            <ul class="bill-plan-feats bill-plan-feats-compact">${proFeats.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            <button class="bill-demo-btn bill-demo-site bill-plan-demo-btn" type="button">
              <span class="bill-demo-btn-ic">◆</span><span>Launch demo + guided tour</span>
            </button>
            <div id="paypal-button-container" class="bill-paypal-slot"></div>
          </div>
        </section>

        <section class="bill-bottom">
          <div class="bill-compare bill-compare-v2">
            <div class="bill-compare-head">Why Bridge Pro</div>
            <div class="bill-compare-grid bill-compare-compact">
              <div class="bill-compare-item bill-compare-featured"><span class="bill-compare-ic">⬡</span><div><strong>Best file wins</strong><span>Largest / best quality across every server</span></div></div>
              <div class="bill-compare-item"><span class="bill-compare-ic">▶</span><div><strong>One Stremio link</strong><span>Private manifest — all servers combined</span></div></div>
              <div class="bill-compare-item"><span class="bill-compare-ic">♥</span><div><strong>Request log proof</strong><span>See which server won each play</span></div></div>
              <div class="bill-compare-item"><span class="bill-compare-ic">◎</span><div><strong>Unlimited servers</strong><span>Emby, Jellyfin, NAS — no cap</span></div></div>
            </div>
          </div>
          <div class="bill-code-card bill-code-v2">
            <div class="bill-code-icon" aria-hidden="true">%</div>
            <div class="bill-code-body">
              <div class="bill-code-title">Discount code</div>
              <p class="bill-code-hint">Have a promo? Apply it before subscribing.</p>
              <div class="bill-code-row">
                <input class="input bill-code-input" id="bill-code" type="text" placeholder="e.g. FAMILY100" autocomplete="off" spellcheck="false"/>
                <button class="btn-generate bill-code-apply" id="bill-redeem" type="button">Apply</button>
              </div>
              <div class="auth-err bill-code-msg" id="bill-msg"></div>
            </div>
          </div>
        </section>
      </div>
    </div>`;
  }

  async function mountPayPal(cfg) {
    if (!cfg.enabled || !cfg.clientId) return;
    try {
      await loadSDK(cfg.clientId);
      const slot = document.getElementById('paypal-button-container');
      if (!slot || !window.paypal) return;
      slot.innerHTML = '';
      window.paypal.Buttons({
        style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'subscribe' },
        createSubscription: (d, actions) => actions.subscription.create({ plan_id: cfg.planId }),
        onApprove: async (data) => {
          const r = await api('/api/billing/activate', { method: 'POST', body: JSON.stringify({ subscriptionID: data.subscriptionID }) });
          if (r.status === 200) { if (window.toast) window.toast('Subscription active!'); init(); }
          else { const m = $('#bill-msg'); if (m) m.textContent = (r.body && r.body.error) || 'Activation failed'; }
        },
      }).render('#paypal-button-container');
    } catch {
      const m = $('#bill-msg'); if (m) m.textContent = 'Could not load PayPal.';
    }
  }

  function wireLocked() {
    wireDemoTour();
    $('#bill-redeem')?.addEventListener('click', async () => {
      const code = ($('#bill-code')?.value || '').trim();
      const r = await api('/api/billing/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      if (r.status === 200 && r.body && r.body.applied) { if (window.toast) window.toast('Code applied'); init(); }
      else { const m = $('#bill-msg'); if (m) m.textContent = (r.body && (r.body.reason || r.body.error)) || 'Invalid code'; }
    });
  }

  function wireCancel() {
    document.querySelectorAll('.bill-cancel').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Cancel your subscription?')) return;
      await api('/api/billing/cancel', { method: 'POST' });
      if (window.toast) window.toast('Subscription cancelled');
      init();
    }));
  }

  async function renderHistory(slot) {
    const el = slot || document.getElementById('bill-history-slot');
    if (!el) return;
    const h = (await api('/api/billing/history')).body;
    if (!h) return;
    const rows = (h.payments || []).map(p =>
      `<tr><td>${date(p.paid_at)}</td><td>${money(p)}</td><td><span class="pay-status ${esc(p.status)}">${esc(p.status)}</span></td></tr>`
    ).join('') || '<tr><td colspan="3" class="log-empty">No payments yet</td></tr>';
    el.innerHTML = `<div class="bill-card bill-card-history">
      <div class="bill-card-head"><span class="bill-card-label">Payment history</span></div>
      ${h.upcoming ? `<div class="bill-upcoming">Next charge <strong>${date(h.upcoming.date)}</strong> · ${esc(h.upcoming.amount)}</div>` : ''}
      <div class="log-table-wrap"><table class="log-table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  async function init() {
    const body = $('#billing-body');
    if (!body) return;

    const cfg = (await api('/api/billing/config')).body;
    const me = (await api('/api/auth/me')).body;
    const link = document.querySelector('.billing-link');

    if (!me || !me.user) { applyGate(false); setBillingNav(false); return; }

    if (window.MEBDemo && window.MEBDemo.isActive()) {
      applyGate(false);
      setBillingNav(true);
      const fakeEnd = new Date(Date.now() + 28 * 86400000).toISOString();
      body.innerHTML = renderActiveShell({ status: 'active', periodEnd: fakeEnd, planPrice: cfg?.planPrice || '$4/mo' }, { demo: true })
        + `<div class="bill-card" style="margin-top:14px"><div class="bill-card-label">Try before you buy</div>
           <p style="font-size:.84rem;color:var(--text-dim);margin:0 0 12px">You're browsing the full site with sample servers and realistic fake data. Use the guided tour to see how best-file routing works — nothing is saved.</p>
           <button class="bill-demo-btn bill-demo-site" type="button" style="width:100%;justify-content:center;border-radius:12px;margin-bottom:8px"><span class="bill-demo-btn-ic">◆</span><span>Restart demo</span></button>
           <button class="btn-soft" type="button" id="bill-demo-tour-restart" style="width:100%">↻ Replay guided tour</button></div>`;
      wireDemoTour();
      document.getElementById('bill-demo-tour-restart')?.addEventListener('click', () => {
        if (window.MEBDemo && window.MEBDemo.openTour) window.MEBDemo.openTour(0);
      });
      return;
    }

    const va = viewAsMode();
    const isAdmin = me.user.role === 'admin';

    // Admin preview modes
    if (isAdmin && va === 'unpaid') {
      applyGate(true);
      setBillingNav(false);
      if (link) link.style.display = '';
      body.innerHTML = renderLockedShell(cfg || { planPrice: '$4/mo', enabled: false });
      wireLocked();
      if (cfg && cfg.enabled) mountPayPal(cfg);
      return;
    }
    if (isAdmin && va === 'paid') {
      applyGate(false);
      setBillingNav(true);
      const fakeEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      body.innerHTML = renderActiveShell({ status: 'active', periodEnd: fakeEnd, planPrice: cfg?.planPrice }, { preview: true });
      wireCancel();
      return;
    }

    if (!cfg || !cfg.enabled) {
      applyGate(false);
      setBillingNav(false);
      body.innerHTML = `<div class="bill-shell"><div class="bill-empty">Billing is not configured on this deployment.</div></div>`;
      return;
    }

    if (link) link.style.display = '';
    const st = (await api('/api/billing/status')).body || {};
    const realSub = st.status === 'active' || st.status === 'comped';

    if (realSub) {
      applyGate(false);
      setBillingNav(true);
      body.innerHTML = renderActiveShell({ ...st, planPrice: cfg.planPrice });
      wireCancel();
      await renderHistory();
      const settings = $('#settings-sub');
      if (settings) settings.innerHTML = `<div class="card"><div class="label">Subscription</div><div class="mrow">Status<span class="mtag" style="color:var(--success)">● ${esc(st.status)}</span></div></div>`;
    } else if (st.hasAccess) {
      applyGate(false);
      setBillingNav(true);
      body.innerHTML = `<div class="bill-shell"><div class="bill-card"><div class="bill-card-label">Access</div><div class="bill-stat-row"><span>Role</span><strong style="color:var(--success)">Admin · full access</strong></div></div></div>`;
      await renderHistory(document.getElementById('bill-history-slot') || body);
    } else {
      setBillingNav(false);
      applyGate(true);
      body.innerHTML = renderLockedShell(cfg);
      wireLocked();
      mountPayPal(cfg);
    }
  }

  window.MEBBilling = { refresh: init, openDemo: openDemoTour };
  document.addEventListener('DOMContentLoaded', () => { init(); wireDemoTour(); });
  document.addEventListener('viewas-changed', init);
})();