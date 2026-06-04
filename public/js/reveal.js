(function (global) {
  // Pure decision: animate if explicitly forced, else only when motion isn't reduced.
  function shouldAnimate(opts) {
    const o = opts || {};
    return !!o.forced || !o.reduced;
  }

  if (typeof document !== 'undefined') {
    try {
      var params = new URLSearchParams(location.search);
      if (params.get('motion') === 'force') localStorage.setItem('forceMotion', '1');
      if (params.get('motion') === 'off') localStorage.removeItem('forceMotion');
    } catch (e) {}
    var forced = false;
    try { forced = localStorage.getItem('forceMotion') === '1'; } catch (e) {}
    var reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (forced) document.documentElement.classList.add('force-motion');

    if (shouldAnimate({ reduced: reduced, forced: forced })) {
      var root = document.documentElement;
      root.classList.add('js-reveal');

      var io = null;
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { en.target.classList.add('revealed'); io.unobserve(en.target); }
          });
        }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      }
      function observeAll() {
        if (!io) return;
        document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(function (el) { io.observe(el); });
      }

      function staggerPage(page) {
        if (!page) return;
        // Re-trigger the entrance animation on every visit: drop the class, force a
        // reflow, re-add — so switching tabs replays the stagger, not just first load.
        page.classList.remove('reveal-seq');
        void page.offsetWidth;
        page.classList.add('reveal-seq');
        // Index only the children that actually stagger (data-reveal children are
        // excluded from the animation), so delays stay contiguous.
        var kids = page.children, idx = 0;
        for (var k = 0; k < kids.length && idx < 12; k++) {
          if (kids[k].hasAttribute && kids[k].hasAttribute('data-reveal')) continue;
          kids[k].style.setProperty('--i', idx++);
        }
        observeAll();
      }

      // Reveal the currently-active page. Deferred via rAF so it runs AFTER the
      // shell router (shell.js, also on hashchange) has toggled `.page.on` for this
      // route — otherwise we'd stagger the previous page. readyState-guarded so
      // [data-reveal] elements are never left stuck hidden if load timing changes.
      function revealActive() { requestAnimationFrame(function () { observeAll(); staggerPage(document.querySelector('.page.on')); }); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revealActive);
      else revealActive();
      window.addEventListener('hashchange', revealActive);
      // re-scan after late/async content renders so dynamically-filled blocks get observed
      window.addEventListener('load', function () { setTimeout(observeAll, 0); });

      // SAFETY NET: a [data-reveal] block that is at/above the fold but somehow never
      // got observed (late render, clipping quirk) is force-revealed after a beat so
      // content can never be left stuck hidden. Truly below-fold blocks still wait for
      // scroll. Runs a few times to cover async content.
      function rescueVisible() {
        document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('revealed');
        });
      }
      setTimeout(rescueVisible, 1200);
      setTimeout(rescueVisible, 3000);

      var ticking = false;
      function onScroll() {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () {
          var y = window.scrollY || 0;
          // 0.04 = parallax depth (background drifts at 4% of scroll distance)
          document.documentElement.style.setProperty('--par', (y * 0.04).toFixed(1) + 'px');
          ticking = false;
        });
      }
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { shouldAnimate };
  else global.Reveal = { shouldAnimate: shouldAnimate };
})(typeof window !== 'undefined' ? window : globalThis);
