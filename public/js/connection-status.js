// ─── Offline / reconnect banner ──────────────────────────────────────────────
// Surfaces lost connectivity so failed actions read as "you're offline" rather
// than mysterious errors. Self-contained; uses the browser's online/offline
// events (and a fetch probe on resume to confirm the server is actually back).
(function () {
  let bannerEl = null;

  function banner(show, text) {
    if (!show) { if (bannerEl) { bannerEl.remove(); bannerEl = null; } return; }
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'meb-conn-banner';
      bannerEl.setAttribute('role', 'status');
      bannerEl.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483646',
        'text-align:center', 'padding:7px 12px', 'font:13px/1.4 system-ui,sans-serif',
        'background:#3a2a12', 'color:#ffe6b3', 'border-bottom:1px solid rgba(255,200,80,.4)',
      ].join(';');
      if (document.body) document.body.appendChild(bannerEl);
    }
    bannerEl.textContent = text;
  }

  function goOffline() { banner(true, '⚠ You appear to be offline — changes won’t save until you reconnect.'); }

  async function goOnline() {
    banner(true, '↻ Reconnecting…');
    // Confirm the server is actually reachable, not just the NIC.
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('/health', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('not ok');
    } catch (e) { goOffline(); return; }
    banner(false);
  }

  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);
  // If we boot already offline, say so.
  if (navigator && navigator.onLine === false) goOffline();
})();
