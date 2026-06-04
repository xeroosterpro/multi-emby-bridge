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

      var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('revealed'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }) : null;
      function observeAll() {
        if (!io) return;
        document.querySelectorAll('[data-reveal]:not(.revealed)').forEach(function (el) { io.observe(el); });
      }
      document.addEventListener('DOMContentLoaded', observeAll);

      function staggerPage(page) {
        if (!page) return;
        page.classList.add('reveal-seq');
        var kids = page.children, i = 0;
        for (var k = 0; k < kids.length && i < 12; k++, i++) kids[k].style.setProperty('--i', i);
        observeAll();
      }
      window.addEventListener('hashchange', function () { staggerPage(document.querySelector('.page.on')); });
      document.addEventListener('DOMContentLoaded', function () { staggerPage(document.querySelector('.page.on')); });

      var ticking = false;
      function onScroll() {
        if (ticking) return; ticking = true;
        requestAnimationFrame(function () {
          var y = window.scrollY || 0;
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
