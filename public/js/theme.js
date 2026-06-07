// Theme + UI preferences: theme presets, UI scale, sidebar lock, reduce motion.
(function () {
  const LS = {
    theme: 'meb-theme', scale: 'meb-ui-scale', lock: 'meb-sidebar-lock', motion: 'meb-bg-motion',
    bgStyle: 'meb-bg-style',
  };
  const VALID_BG = new Set(['orbs', 'aurora', 'mesh', 'pulse', 'nebula']);
  const VALID_THEMES = new Set([
    'streamhub', 'purple', 'red', 'pink', 'blue', 'rgb',
    'emerald', 'amber', 'cyan', 'sunset', 'solstice', 'lime',
    'family', 'neon', 'outline', 'glass', 'vapor', 'cyber', 'aurora', 'mono',
  ]);
  const root = document.documentElement;

  function applyTheme(t) {
    const theme = VALID_THEMES.has(t) ? t : 'streamhub';
    root.dataset.theme = theme;
  }
  function applyBgStyle(v) {
    root.dataset.bg = VALID_BG.has(v) ? v : 'orbs';
  }
  function applyScale(v) { root.style.zoom = (v / 100); }
  // v: 'on' = force animations (override OS reduce-motion); 'off' = pause; null = follow OS
  function applyMotion(v) {
    document.body.classList.toggle('force-motion', v === 'on');
    document.body.classList.toggle('noanim', v === 'off');
  }
  function osReduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
  function applyLock(on) {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('locked', !!on);
    document.body.classList.toggle('sb-locked', !!on);
    const sw = document.getElementById('lock-switch');
    if (sw) sw.classList.toggle('on', !!on);
    const pin = document.getElementById('pin-btn');
    if (pin) pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const prefs = {
    theme: localStorage.getItem(LS.theme) || 'streamhub',
    scale: parseInt(localStorage.getItem(LS.scale) || '100', 10),
    lock: localStorage.getItem(LS.lock) !== '0',
    motion: localStorage.getItem(LS.motion) || null,   // 'on' | 'off' | null (follow OS)
    bgStyle: localStorage.getItem(LS.bgStyle) || 'orbs',
  };

  // expose a tiny API for shell.js / settings controls
  window.MEBPrefs = {
    get: () => ({ ...prefs }),
    setTheme(t) { prefs.theme = t; localStorage.setItem(LS.theme, t); applyTheme(t); },
    setScale(v) { prefs.scale = v; localStorage.setItem(LS.scale, String(v)); applyScale(v); },
    setLock(on) { prefs.lock = on; localStorage.setItem(LS.lock, on ? '1' : '0'); applyLock(on); },
    setMotion(v) { prefs.motion = v; if (v) localStorage.setItem(LS.motion, v); else localStorage.removeItem(LS.motion); applyMotion(v); },
    setBgStyle(v) { prefs.bgStyle = v; localStorage.setItem(LS.bgStyle, v); applyBgStyle(v); },
  };

  function boot() {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    if (mobile) prefs.lock = false;
    applyTheme(prefs.theme); applyBgStyle(prefs.bgStyle); applyScale(prefs.scale); applyMotion(prefs.motion); applyLock(prefs.lock);
    // reflect into controls if present
    const scaleEl = document.getElementById('ui-scale');
    if (scaleEl) { scaleEl.value = prefs.scale; const sv = document.getElementById('scale-val'); if (sv) sv.textContent = prefs.scale + '%'; }
    // switch ON = background will animate (explicit 'on', or following OS when not reduced)
    const motionEl = document.getElementById('motion-switch');
    if (motionEl) motionEl.classList.toggle('on', prefs.motion === 'on' || (prefs.motion == null && !osReduced()));
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.t === prefs.theme));
    document.querySelectorAll('.bg-style-chip').forEach(c => c.classList.toggle('sel', c.dataset.bg === prefs.bgStyle));
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
