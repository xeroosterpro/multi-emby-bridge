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
  const show = () => { const o = $('#auth-overlay'); if (o) { o.style.display = 'grid'; o.classList.add('auth-visible'); } };
  const hide = () => { const o = $('#auth-overlay'); if (o) { o.classList.remove('auth-visible'); setTimeout(() => { o.style.display = 'none'; }, 300); } };

  function setMode(next) {
    mode = next;
    document.querySelectorAll('#auth-tabs button').forEach(x => x.classList.toggle('on', x.dataset.auth === mode));
    $('#auth-tabs')?.classList.toggle('reg', mode === 'register');
    const head = $('#auth-head') || $('.auth-head');
    if (head) { head.style.opacity = '0'; setTimeout(() => { head.style.opacity = '1'; }, 80); }
    if ($('#auth-title')) $('#auth-title').textContent = mode === 'register' ? 'Create your account' : 'Welcome back';
    if ($('#auth-sub')) $('#auth-sub').textContent = mode === 'register' ? 'Start streaming through your own bridge' : 'Sign in to manage your servers & manifest';
    if ($('#au-submit')) {
      const span = $('#au-submit').querySelector('span');
      if (span) span.textContent = mode === 'register' ? 'Create account' : 'Log in';
    }
    if ($('#au-pass')) $('#au-pass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    if ($('#au-err')) $('#au-err').textContent = '';
  }

  async function submit(e) {
    e.preventDefault();
    const username = $('#au-user').value.trim();
    const password = $('#au-pass').value;
    const btn = $('#au-submit');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    $('#au-err').textContent = '';
    try {
      const r = await fetch('/api/auth/' + mode, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ username, password }),
      });
      if (r.status === 503) { hide(); return; }
      const data = await r.json();
      if (!r.ok) { $('#au-err').textContent = data.error || 'Something went wrong'; return; }
      location.reload();
    } catch {
      $('#au-err').textContent = 'Network error';
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    $('#auth-form')?.addEventListener('submit', submit);
    document.querySelectorAll('#auth-tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.auth)));
    $('#au-pass-toggle')?.addEventListener('click', () => {
      const inp = $('#au-pass'); if (!inp) return;
      const showPw = inp.type === 'password';
      inp.type = showPw ? 'text' : 'password';
      $('#au-pass-toggle').textContent = showPw ? '🙈' : '👁';
    });

    const status = await me();
    if (status && status.enabled && status.user === null) show();
  });
})();