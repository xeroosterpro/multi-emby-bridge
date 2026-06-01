// Theme + UI preferences: theme color, UI scale, sidebar lock, reduce motion.
(function () {
  const LS = {
    theme: 'meb-theme', scale: 'meb-ui-scale', lock: 'meb-sidebar-lock', motion: 'meb-reduce-motion',
  };
  const root = document.documentElement;

  function applyTheme(t) { root.dataset.theme = t || 'purple'; }
  function applyScale(v) { root.style.zoom = (v / 100); }
  function applyMotion(on) { document.body.classList.toggle('noanim', !!on); }
  function applyLock(on) {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('locked', !!on);
    document.body.classList.toggle('sb-locked', !!on);
    const sw = document.getElementById('lock-switch');
    if (sw) sw.classList.toggle('on', !!on);
  }

  const prefs = {
    theme: localStorage.getItem(LS.theme) || 'purple',
    scale: parseInt(localStorage.getItem(LS.scale) || '100', 10),
    lock: localStorage.getItem(LS.lock) === '1',
    motion: localStorage.getItem(LS.motion) === '1',
  };

  // expose a tiny API for shell.js / settings controls
  window.MEBPrefs = {
    get: () => ({ ...prefs }),
    setTheme(t) { prefs.theme = t; localStorage.setItem(LS.theme, t); applyTheme(t); },
    setScale(v) { prefs.scale = v; localStorage.setItem(LS.scale, String(v)); applyScale(v); },
    setLock(on) { prefs.lock = on; localStorage.setItem(LS.lock, on ? '1' : '0'); applyLock(on); },
    setMotion(on) { prefs.motion = on; localStorage.setItem(LS.motion, on ? '1' : '0'); applyMotion(on); },
  };

  function boot() {
    applyTheme(prefs.theme); applyScale(prefs.scale); applyMotion(prefs.motion); applyLock(prefs.lock);
    // reflect into controls if present
    const scaleEl = document.getElementById('ui-scale');
    if (scaleEl) { scaleEl.value = prefs.scale; const sv = document.getElementById('scale-val'); if (sv) sv.textContent = prefs.scale + '%'; }
    const motionEl = document.getElementById('motion-switch'); if (motionEl) motionEl.classList.toggle('on', prefs.motion);
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.t === prefs.theme));
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
