// ─── API Keys & Manifest page wiring ───────────────────────────────────────
// Drives the static "API Keys & Manifest" markup in #page-install: saves keys
// (via configure.js's encoded config blob) to the account and mints/regenerates
// the personal manifest link. Non-destructive: configure.js is untouched.
(function () {
  const $ = s => document.querySelector(s);

  function b64urlToObj(enc) {
    let b = enc.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const bin = atob(b);
    const json = decodeURIComponent(Array.prototype.map.call(bin, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  }
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    return { status: r.status, body: await r.json().catch(() => null) };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const install = document.getElementById('page-install');
    if (!install) return;
    const me = await api('/api/auth/me');
    const loggedIn = !!(me.body && me.body.enabled && me.body.user);

    const urlEl = $('#acct-url'), msg = $('#acct-msg');
    const showUrl = url => { if (url && urlEl) { urlEl.value = url; } };

    if (!loggedIn) {
      // accounts off / signed out — keys still save into the install blob, but
      // there's no personal link to mint. Soften the manifest card.
      if (urlEl) urlEl.placeholder = 'Sign in to generate your personal link';
      ['acct-regen', 'acct-copy'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
    } else {
      const cur = await api('/api/user/manifest');
      if (cur.body) showUrl(cur.body.url);
      // Auto-sync config → account on any change (debounced, silent) so the saved
      // account config (which drives the manifest + admin views) never drifts stale.
      let syncT;
      const syncToAccount = async () => {
        try {
          if (typeof window.generateLinks === 'function') window.generateLinks({ silent: true });
          const enc = localStorage.getItem('meb-last-config');
          if (!enc) return;
          await api('/api/user/config', { method: 'POST', body: JSON.stringify(b64urlToObj(enc)) });
        } catch { /* best-effort */ }
      };
      const scheduleSync = () => { clearTimeout(syncT); syncT = setTimeout(syncToAccount, 1500); };
      document.addEventListener('input', scheduleSync, true);
      document.addEventListener('change', scheduleSync, true);
    }

    async function saveSetup() {
      if (msg) msg.textContent = '';
      if (typeof window.generateLinks === 'function') { try { window.generateLinks(); } catch {} }
      const enc = localStorage.getItem('meb-last-config');
      if (!enc) { if (msg) msg.textContent = 'Add a server on the Servers page first.'; return false; }
      let cfg; try { cfg = b64urlToObj(enc); } catch { if (msg) msg.textContent = 'Could not read your config.'; return false; }
      const s = await api('/api/user/config', { method: 'POST', body: JSON.stringify(cfg) });
      if (s.status !== 200) { if (msg) msg.textContent = (s.body && s.body.error) || 'Save failed'; return false; }
      return true;
    }

    const saveBtn = $('#ak-save');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      if (!await saveSetup()) return;
      if (loggedIn) {
        const m = await api('/api/user/manifest', { method: 'POST' });
        if (m.body && m.body.url) showUrl(m.body.url);
      }
      if (window.toast) window.toast('Keys saved' + (loggedIn ? ' · link ready' : ''));
    });

    const copyBtn = $('#acct-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      if (!urlEl || !urlEl.value) return;
      urlEl.select(); try { document.execCommand('copy'); } catch {}
      if (window.toast) window.toast('Copied');
    });

    const regenBtn = $('#acct-regen');
    if (regenBtn) regenBtn.addEventListener('click', async () => {
      const m = await api('/api/user/manifest', { method: 'POST' });
      if (m.body && m.body.url) { showUrl(m.body.url); if (window.toast) window.toast('New link generated — old one revoked'); }
    });

    const installBtn = $('#acct-install');
    if (installBtn) installBtn.addEventListener('click', () => {
      if (typeof window.generateLinks === 'function') { try { window.generateLinks(); } catch {} }
      const res = document.getElementById('result-section');
      if (res) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // QR code toggle for mobile install
    const linkWrap = document.getElementById('acct-link-wrap');
    if (linkWrap && loggedIn) {
      const qrBtn = document.createElement('button');
      qrBtn.className = 'btn-soft'; qrBtn.type = 'button'; qrBtn.textContent = 'Show QR';
      qrBtn.style.marginTop = '10px';
      const qrBox = document.createElement('div'); qrBox.id = 'acct-qr'; qrBox.style.marginTop = '10px';
      linkWrap.appendChild(qrBtn); linkWrap.appendChild(qrBox);
      qrBtn.addEventListener('click', async () => {
        if (qrBox.dataset.shown) { qrBox.innerHTML = ''; delete qrBox.dataset.shown; qrBtn.textContent = 'Show QR'; return; }
        const r = await api('/api/user/manifest-qr');
        if (r.status === 200 && r.body && r.body.dataUrl) {
          qrBox.innerHTML = `<img src="${r.body.dataUrl}" alt="Install QR" style="width:200px;height:200px;border-radius:10px;background:#fff;padding:6px"/><div class="field-hint" style="margin-top:6px">Scan in your phone's camera to install on a mobile device.</div>`;
          qrBox.dataset.shown = '1'; qrBtn.textContent = 'Hide QR';
        } else { qrBox.innerHTML = '<div class="field-hint">Save your keys first to generate a link.</div>'; }
      });
    }
  });
})();
