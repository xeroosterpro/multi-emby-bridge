// ─── Billing UI: PayPal subscribe, discount redeem, access gating ───────────
// Activates only when billing is enabled (PayPal configured). When a logged-in
// non-admin user lacks access, the app is gated to the Billing page only.
(function () {
  const $ = s => document.querySelector(s);
  async function api(p, o) {
    const r = await fetch(p, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, o || {}));
    return { status: r.status, body: await r.json().catch(() => null) };
  }

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

  function applyGate(locked) {
    document.body.classList.toggle('locked-billing', locked);
    if (locked && location.hash !== '#/billing') location.hash = '#/billing';
  }

  function activeCardHTML(st) {
    return `<div class="card"><div class="label">Subscription</div>
      <div class="mrow">Plan<span class="mtag">Bridge Pro</span></div>
      <div class="mrow">Status<span class="mtag" style="color:var(--success)">● ${st.status}</span></div>
      ${st.periodEnd ? `<div class="mrow">Renews<span class="mtag">${new Date(st.periodEnd).toLocaleDateString()}</span></div>` : ''}
      <div style="margin-top:12px"><button class="btn-soft bill-cancel" type="button">Cancel subscription</button></div></div>`;
  }
  function renderActive(st) {
    // Managed in Settings (Billing tab is hidden when active); also fill the Billing page if visited.
    const settings = $('#settings-sub'); if (settings) settings.innerHTML = activeCardHTML(st);
    if ($('#billing-body')) $('#billing-body').innerHTML = activeCardHTML(st);
    document.querySelectorAll('.bill-cancel').forEach(b => b.addEventListener('click', async () => {
      await api('/api/billing/cancel', { method: 'POST' }); if (window.toast) window.toast('Subscription cancelled'); init();
    }));
  }

  async function renderLocked(cfg) {
    $('#billing-body').innerHTML = `<div class="card billing-plan"><div class="label">Plan</div>
      <div style="font-size:1.4rem;font-weight:800">Bridge Pro</div>
      <div class="bill-price">${cfg.planPrice}</div>
      <ul class="bill-feat"><li>Unlimited servers</li><li>Your personal manifest URL</li><li>Priority health pings</li><li>Cancel anytime</li></ul>
      <div id="paypal-button-container" style="margin-top:6px"></div>
      <div class="field-label" style="margin-top:14px">Have a discount code?</div>
      <div style="display:flex;gap:8px"><input class="input" id="bill-code" placeholder="Enter code" autocomplete="off"/><button class="btn-soft" id="bill-redeem" type="button">Apply</button></div>
      <div class="auth-err" id="bill-msg"></div></div>`;
    $('#bill-redeem').addEventListener('click', async () => {
      const code = $('#bill-code').value.trim();
      const r = await api('/api/billing/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      if (r.status === 200 && r.body && r.body.applied) { if (window.toast) window.toast('Code applied'); init(); }
      else { $('#bill-msg').textContent = (r.body && (r.body.reason || r.body.error)) || 'Invalid code'; }
    });
    try {
      await loadSDK(cfg.clientId);
      if (window.paypal) {
        window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'subscribe' },
          createSubscription: (d, actions) => actions.subscription.create({ plan_id: cfg.planId }),
          onApprove: async (data) => {
            const r = await api('/api/billing/activate', { method: 'POST', body: JSON.stringify({ subscriptionID: data.subscriptionID }) });
            if (r.status === 200) { if (window.toast) window.toast('Subscription active!'); init(); }
            else { $('#bill-msg').textContent = (r.body && r.body.error) || 'Activation failed'; }
          },
        }).render('#paypal-button-container');
      }
    } catch { $('#bill-msg').textContent = 'Could not load PayPal.'; }
  }

  async function init() {
    const cfg = (await api('/api/billing/config')).body;
    if (!cfg || !cfg.enabled) { applyGate(false); return; }    // billing dormant → no gating
    const me = (await api('/api/auth/me')).body;
    const link = document.querySelector('.billing-link'); if (link) link.style.display = '';
    if (!me || !me.user) { applyGate(false); return; }          // login overlay handles unauthenticated
    const st = (await api('/api/billing/status')).body || {};
    if (st.hasAccess) {
      applyGate(false);
      if (link) link.style.display = 'none';        // hide Billing tab when active — manage in Settings
      renderActive(st);
    } else {
      const settings = $('#settings-sub'); if (settings) settings.innerHTML = '';
      applyGate(me.user.role !== 'admin');
      renderLocked(cfg);
    }
  }

  window.MEBBilling = { refresh: init };
  document.addEventListener('DOMContentLoaded', init);
})();
