// ─── Account panel: save setup to account + personal manifest link ──────────
// Non-destructive: only injects UI when logged in. Reuses configure.js's
// existing config (via the encoded blob it stores in localStorage) — no edits
// to configure.js. POSTs to the Phase 3 endpoints (/api/user/*).
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

  function panelHTML(user) {
    return `<div class="card acct-card" id="acct-card">
      <div class="label">My account</div>
      <div class="mrow">Signed in as <span class="mtag">${user.username}${user.role === 'admin' ? ' · admin' : ''}</span></div>
      <div id="acct-link-wrap" style="display:none;margin-top:10px">
        <div class="field-label">Your personal manifest URL</div>
        <div style="display:flex;gap:8px"><input class="input allow-select" id="acct-url" readonly /><button class="btn-soft" id="acct-copy" type="button">Copy</button></div>
        <div class="field-hint" style="margin-top:4px">Regenerating invalidates the old link immediately.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn-generate" id="acct-save" type="button" style="flex:1;min-width:200px">Save my setup &amp; get personal link</button>
        <button class="btn-soft" id="acct-regen" type="button">Regenerate</button>
        <button class="btn-soft" id="acct-logout" type="button">Log out</button>
      </div>
      <div class="auth-err" id="acct-msg"></div>
    </div>`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const me = await api('/api/auth/me');
    if (!me.body || !me.body.enabled || !me.body.user) return; // accounts off or not logged in
    const install = document.getElementById('page-install');
    if (!install) return;
    install.insertAdjacentHTML('afterbegin', panelHTML(me.body.user));

    const showUrl = url => { if (url) { $('#acct-url').value = url; $('#acct-link-wrap').style.display = 'block'; } };
    const cur = await api('/api/user/manifest');
    if (cur.body) showUrl(cur.body.url);

    $('#acct-logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
    $('#acct-copy').addEventListener('click', () => { const i = $('#acct-url'); i.select(); try { document.execCommand('copy'); } catch {} if (window.toast) window.toast('Copied'); });

    async function saveSetup() {
      $('#acct-msg').textContent = '';
      if (typeof window.generateLinks === 'function') { try { window.generateLinks(); } catch {} }
      const enc = localStorage.getItem('meb-last-config');
      if (!enc) { $('#acct-msg').textContent = 'Add a server and generate your install link first.'; return false; }
      let cfg; try { cfg = b64urlToObj(enc); } catch { $('#acct-msg').textContent = 'Could not read your config.'; return false; }
      const s = await api('/api/user/config', { method: 'POST', body: JSON.stringify(cfg) });
      if (s.status !== 200) { $('#acct-msg').textContent = (s.body && s.body.error) || 'Save failed'; return false; }
      return true;
    }

    $('#acct-save').addEventListener('click', async () => {
      if (!await saveSetup()) return;
      const m = await api('/api/user/manifest', { method: 'POST' });
      if (m.body && m.body.url) { showUrl(m.body.url); if (window.toast) window.toast('Saved & personal link ready'); }
    });
    $('#acct-regen').addEventListener('click', async () => {
      const m = await api('/api/user/manifest', { method: 'POST' });
      if (m.body && m.body.url) { showUrl(m.body.url); if (window.toast) window.toast('New link generated — old one revoked'); }
    });
  });
})();
