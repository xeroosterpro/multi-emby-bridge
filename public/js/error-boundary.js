// ─── Global client-side error boundary ──────────────────────────────────────
// Loaded first so a thrown exception or rejected promise anywhere in the SPA is
// caught instead of silently white-screening / mis-routing the app. Genuine logic
// errors surface a dismissible recovery toast; routine network blips are logged
// quietly (no toast spam). Self-contained — no dependency on ui.js/toast.
(function () {
  let lastToast = 0;
  let errorCount = 0;

  function recoveryToast() {
    const now = Date.now();
    if (now - lastToast < 5000) return; // throttle
    lastToast = now;
    let el = document.getElementById('meb-error-boundary');
    if (!el) {
      el = document.createElement('div');
      el.id = 'meb-error-boundary';
      el.setAttribute('role', 'alert');
      el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:20px', 'transform:translateX(-50%)',
        'z-index:2147483647', 'max-width:min(520px,92vw)', 'display:flex', 'gap:10px',
        'align-items:center', 'padding:11px 14px', 'border-radius:12px',
        'background:#241019', 'color:#ffd7df', 'border:1px solid rgba(255,90,122,.45)',
        'box-shadow:0 10px 34px rgba(0,0,0,.5)', 'font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif',
      ].join(';');
    }
    el.innerHTML =
      '<span aria-hidden="true" style="font-size:16px">⚠</span>' +
      '<span style="flex:1">Something hiccuped, but the app kept running. If a page looks off, reload.</span>' +
      '<button type="button" data-act="reload" style="cursor:pointer;border:0;border-radius:8px;padding:6px 10px;background:#ff5a7a;color:#1a0a10;font-weight:600">Reload</button>' +
      '<button type="button" data-act="dismiss" aria-label="Dismiss" style="cursor:pointer;border:0;background:transparent;color:#ffd7df;font-size:18px;line-height:1">×</button>';
    el.querySelector('[data-act="reload"]').onclick = () => location.reload();
    el.querySelector('[data-act="dismiss"]').onclick = () => el.remove();
    if (document.body) document.body.appendChild(el);
    clearTimeout(el._t);
    el._t = setTimeout(() => { try { el.remove(); } catch (e) {} }, 14000);
  }

  function handle(kind, message, detail) {
    errorCount++;
    const msg = String(message == null ? '' : message);
    // Transient network/abort failures are expected (polling, flaky servers) — log
    // quietly and never toast; only real logic errors get the recovery prompt.
    const routine = /failed to fetch|networkerror|load failed|the operation was aborted|aborterror|err_network|err_internet|quotaexceeded/i.test(msg);
    try { console[routine ? 'warn' : 'error']('[ui-error]', kind, msg, detail || ''); } catch (e) {}
    if (!routine) recoveryToast();
  }

  window.addEventListener('error', (e) => {
    // Only handle real script exceptions; ignore resource (img/script 404) load errors.
    if (e && e.error) handle('error', e.message || (e.error && e.error.message), e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    handle('unhandledrejection', (r && (r.message || r)) || 'unhandled rejection', r && r.stack);
  });

  window.__mebErrorBoundary = { recoveryToast, get count() { return errorCount; } };
})();
