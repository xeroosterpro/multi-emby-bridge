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
  });
})();
