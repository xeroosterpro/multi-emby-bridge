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
    document.body.classList.toggle('locked-billing', locked);
    if (locked && location.hash !== '#/billing') location.hash = '#/billing';
  }

  function setBillingNav(subscribed) {
    window._mebBillingPreview = { subscribed: !!subscribed };
    const link = document.querySelector('.billing-link');
    if (link) link.style.display = subscribed ? 'none' : '';
  }

  function renderActiveShell(st, opts = {}) {
    const preview = opts.preview ? '<span class="bill-preview-tag">Preview mode</span>' : '';
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

  function renderLockedShell(cfg) {
    const plans = cfg.plans || [
      { id: 'free', name: 'Free', price: '$0', period: 'forever', features: ['Browse only'], limited: true },
      { id: 'pro', name: 'Bridge Pro', price: cfg.planPrice, period: 'month', features: ['Unlimited servers','Manifest URL','Stream routing'], featured: true },
    ];
    const free = plans.find(p => p.id === 'free') || plans[0];
    const pro = plans.find(p => p.id === 'pro' || p.featured) || plans[1] || plans[0];
    const featList = (arr) => (arr || []).map(f => `<li>${esc(f)}</li>`).join('');
    const preview = viewAsMode() === 'unpaid' ? '<span class="bill-preview-tag">Preview · unpaid user</span>' : '';

    return `<div class="bill-shell">
      <div class="bill-hero">
        <div class="bill-hero-glow"></div>
        ${preview}
        <h2 class="bill-hero-title">Unlock your bridge</h2>
        <p class="bill-hero-sub">Subscribe to stream from your Emby &amp; Jellyfin servers through Stremio</p>
      </div>
      <div class="bill-plans">
        <div class="bill-plan${free.limited ? ' bill-plan-muted' : ''}">
          <div class="bill-plan-name">${esc(free.name)}</div>
          <div class="bill-plan-price">${esc(free.price)}</div>
          <div class="bill-plan-period">${esc(free.period || '')}</div>
          <ul class="bill-plan-feats">${featList(free.features)}</ul>
          <div class="bill-plan-cta muted">Current access level</div>
        </div>
        <div class="bill-plan bill-plan-featured">
          <div class="bill-plan-badge">Recommended</div>
          <div class="bill-plan-name">${esc(pro.name)}</div>
          <div class="bill-plan-price">${esc(pro.price)}</div>
          <div class="bill-plan-period">per ${esc(pro.period || 'month')}</div>
          <ul class="bill-plan-feats">${featList(pro.features)}</ul>
          <div id="paypal-button-container" class="bill-paypal-slot"></div>
        </div>
      </div>
      <div class="bill-compare">
        <div class="bill-compare-head">What you get with Bridge Pro</div>
        <div class="bill-compare-grid">
          <div class="bill-compare-item"><span class="bill-compare-ic">⬡</span><div><strong>Multi-server routing</strong><span>Pick the best stream across all your servers</span></div></div>
          <div class="bill-compare-item"><span class="bill-compare-ic">▶</span><div><strong>Stremio manifest</strong><span>Your own private install link</span></div></div>
          <div class="bill-compare-item"><span class="bill-compare-ic">♥</span><div><strong>Health monitoring</strong><span>Uptime bars &amp; response charts</span></div></div>
          <div class="bill-compare-item"><span class="bill-compare-ic">◎</span><div><strong>Priority support</strong><span>In-house ticket system</span></div></div>
        </div>
      </div>
      <div class="bill-code-card">
        <div class="bill-card-head"><span class="bill-card-label">Have a discount code?</span></div>
        <div class="bill-code-row">
          <input class="input" id="bill-code" placeholder="e.g. FAMILY100" autocomplete="off"/>
          <button class="btn-generate" id="bill-redeem" type="button">Apply code</button>
        </div>
        <div class="auth-err" id="bill-msg"></div>
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

  window.MEBBilling = { refresh: init };
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('viewas-changed', init);
})();