// ─── Login / Register overlay (server-backed) ───────────────────────────────
// Shows ONLY when accounts are enabled (DATABASE_URL present) AND nobody is
// logged in. Stays hidden otherwise so the addon works before Postgres exists.
(function () {
  const $ = s => document.querySelector(s);
  let mode = 'login';

  async function me() {
    try { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); return await r.json(); }
    catch { return { user: null, enabled: false }; }
  }
  const show = () => { const o = $('#auth-overlay'); if (o) o.style.display = 'grid'; };
  const hide = () => { const o = $('#auth-overlay'); if (o) o.style.display = 'none'; };

  async function submit(e) {
    e.preventDefault();
    const username = $('#au-user').value.trim();
    const password = $('#au-pass').value;
    $('#au-err').textContent = '';
    try {
      const r = await fetch('/api/auth/' + mode, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ username, password }),
      });
      if (r.status === 503) { hide(); return; }
      const data = await r.json();
      if (!r.ok) { $('#au-err').textContent = data.error || 'Something went wrong'; return; }
      hide();
      if (window.toast) window.toast('Signed in as ' + data.username);
    } catch {
      $('#au-err').textContent = 'Network error';
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#auth-form')?.addEventListener('submit', submit);
    document.querySelectorAll('#auth-tabs button').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.auth;
      document.querySelectorAll('#auth-tabs button').forEach(x => x.classList.toggle('on', x === b));
      $('#auth-tabs').classList.toggle('reg', mode === 'register');
      $('#auth-title').textContent = mode === 'register' ? 'Create account' : 'Welcome back';
      $('#auth-sub').textContent = mode === 'register' ? 'Register a new bridge user' : 'Sign in to manage your bridge';
      $('#au-submit').textContent = mode === 'register' ? 'Register' : 'Log in';
      $('#au-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      $('#au-err').textContent = '';
    }));

    const status = await me();
    if (status && status.enabled && status.user === null) show();
  });
})();
