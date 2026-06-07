// ─── Full-site demo mode: 1:1 UI with realistic sample data + guided tour ───
(function () {
  const LS_KEY = 'meb_config_v1';
  const FLAG = 'meb_demo_active';
  const BACKUP = 'meb_demo_ls_backup';
  const LIB_CACHE = 'meb-libstats-cache';
  const TOUR_FLAG = 'meb_demo_tour_start';

  const S_CLOUD = 'Cloud Emby';
  const S_HOME = 'Home Jellyfin';
  const S_NAS = 'Backup NAS';

  const SERVERS = [
    { label: S_CLOUD, type: 'emby', url: 'https://emby.cloud.example.com', apiKey: 'demo_cloud_key_8f2a', userId: 'a1b2c3d4', enabled: true, cost: 12.99, costPeriod: 'monthly' },
    { label: S_HOME, type: 'jellyfin', url: 'https://jellyfin.home.lab:8096', apiKey: 'demo_jelly_key_9c41', userId: 'e5f6a7b8', enabled: true, username: 'demo', password: '••••••••' },
    { label: S_NAS, type: 'emby', url: 'https://192.168.1.42:8096', apiKey: 'demo_nas_key_3d77', userId: 'c9d0e1f2', enabled: true, cost: 4.5, costPeriod: 'monthly' },
  ];

  const LIB_STATS = {
    'https://emby.cloud.example.com|demo_cloud_key_8f2a|a1b2c3d4': { movies: 2847, shows: 412, episodes: 8934, ms: 42, ts: Date.now() },
    'https://jellyfin.home.lab:8096|demo_jelly_key_9c41|e5f6a7b8': { movies: 1203, shows: 198, episodes: 4102, ms: 68, ts: Date.now() },
    'https://192.168.1.42:8096|demo_nas_key_3d77|c9d0e1f2': { movies: 890, shows: 56, episodes: 890, ms: 31, ts: Date.now() },
  };

  const DEMO_FORM_STATE = {
    mode: 'normal',
    sortOrder: 'size',
    recommend: true,
    showPing: true,
    pingDetail: false,
    audioLang: 'en',
    prefCodec: 'hevc',
    codecMode: 'prefer',
    audioRank: true,
    maxBitrate: '',
    autoSelect: true,
    labelPreset: 'quality',
    showSummary: true,
    summaryStyle: 'compact',
    showCatalog: true,
    catalogContent: 'recent',
    libraryRows: ['recent', 'resume', 'nextup', 'favorites'],
    traktClientId: 'demo_trakt_client_id',
    mdblistApiKey: 'demo_mdblist_key',
    tmdbApiKey: 'demo_tmdb_key',
    rpdbKey: '',
    pingOrigin: 'server',
    externalCatalogs: [
      { provider: 'trakt', listType: 'trending', mediaType: 'movie', name: 'Trakt Trending', enabled: true, count: 250, valid: true },
      { provider: 'mdblist', listUrl: 'https://mdblist.com/lists/demo/watchlist', mediaType: 'movie', name: 'My Watchlist', enabled: true, shuffle: true, count: 142, valid: true },
      { provider: 'tmdb', tmdbMode: 'charts', tmdbChart: 'popular', mediaType: 'movie', name: 'TMDB Popular', enabled: true, count: 500, valid: true },
    ],
    servers: SERVERS,
  };

  const SITE_TOUR = [
    {
      page: 'dashboard',
      title: 'Every server in one place',
      desc: 'Your dashboard shows all connected Emby & Jellyfin servers — library size, uptime, and live activity. This is the hub for everything the bridge monitors.',
      bullets: ['3 demo servers pre-loaded', 'Live “now playing” sessions', 'Uptime & response charts'],
      highlight: '#dash-cards',
    },
    {
      page: 'servers',
      title: 'Add all your servers',
      desc: 'Connect every Emby and Jellyfin instance you have — cloud, home lab, NAS, a friend’s server. The bridge searches all of them every time you press play in Stremio.',
      bullets: ['Unlimited servers on Bridge Pro', 'Emby & Jellyfin mixed', 'Encrypted API keys'],
      highlight: '#servers-container',
    },
    {
      page: 'streaming',
      title: 'Tell it what “best” means',
      desc: 'This is where you set the rules: prefer the largest file (usually best quality), favorite audio language, codec priority, and server order. The bridge compares every match against these preferences.',
      bullets: ['Sort by file size = best quality', 'Audio language & codec prefs', 'Per-server priority'],
      highlight: '#ms-prefs-panel',
    },
    {
      page: 'log',
      title: 'See which server won',
      desc: 'The request log is proof of the bread & butter: for each Stremio play, you see every server searched, what was found, and which file was picked as the winner.',
      bullets: ['Per-server ✓ / miss / offline', 'Best file highlighted', 'Duration & success rate'],
      highlight: '#rlog-stats',
    },
    {
      page: 'install',
      title: 'One link into Stremio',
      desc: 'Generate your private manifest URL and paste it into Stremio once. From then on, every play triggers the multi-server search-and-compare flow automatically.',
      bullets: ['Personal manifest URL', 'QR code for mobile', 'Settings sync automatically'],
      highlight: '#inst-stats',
    },
    {
      page: 'billing',
      title: 'Unlock your real servers',
      desc: 'Subscribe to Bridge Pro to replace this demo data with your own Emby & Jellyfin servers — same UI, real streams, best file wins every time.',
      bullets: ['$4/mo · cancel anytime', 'Discount codes supported', 'Priority support'],
      highlight: null,
    },
  ];

  let tourStep = 0;
  let tourOpen = false;
  let tourScrollHandler = null;
  const HIGHLIGHT_STOP = new Set(['ms-prefs-panel', 'ms-controls', 'ms-card', 'dash-cards', 'rlog-stats', 'inst-stats', 'servers-container', 'acc']);

  function isActive() {
    try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
  }

  function genHealthHistory(label, url, type, baseMs, uptime = 0.97) {
    const now = Date.now();
    const hist = [];
    for (let i = 0; i < 96; i++) {
      const up = Math.random() < uptime;
      hist.push({
        ts: now - i * 5 * 60 * 1000,
        up,
        ms: up ? Math.round(baseMs + (Math.random() - 0.5) * 18) : null,
        label, url, type,
      });
    }
    return hist;
  }

  function requestLogEntries() {
    const now = Date.now();
    return [
      { ts: now - 120000, type: 'movie', contentName: 'Dune: Part Two', imdbId: 'tt15239678', season: 0, episode: 0, ms: 842,
        bestServer: { label: S_CLOUD, size: 26843545600, bitrate: 45000000 },
        serverStatus: [
          { label: S_CLOUD, status: 'found', size: 26843545600, bitrate: 45000000 },
          { label: S_HOME, status: 'not_found' },
          { label: S_NAS, status: 'found', size: 12884901888, bitrate: 22000000 },
        ] },
      { ts: now - 480000, type: 'series', contentName: 'Breaking Bad', imdbId: 'tt0903747', season: 1, episode: 1, ms: 1124,
        bestServer: { label: S_HOME, size: 2147483648, bitrate: 8500000 },
        serverStatus: [
          { label: S_CLOUD, status: 'not_found' },
          { label: S_HOME, status: 'found', size: 2147483648, bitrate: 8500000 },
          { label: S_NAS, status: 'offline' },
        ] },
      { ts: now - 900000, type: 'movie', contentName: 'Oppenheimer', imdbId: 'tt15398776', ms: 623,
        bestServer: { label: S_CLOUD, size: 32212254720, bitrate: 52000000 },
        serverStatus: [
          { label: S_CLOUD, status: 'found', size: 32212254720, bitrate: 52000000 },
          { label: S_HOME, status: 'found', size: 16106127360, bitrate: 28000000 },
          { label: S_NAS, status: 'not_found' },
        ] },
      { ts: now - 1800000, type: 'series', contentName: 'The Bear', imdbId: 'tt1442464', season: 2, episode: 4, ms: 1456,
        bestServer: { label: S_HOME, size: 1073741824, bitrate: 6200000 },
        serverStatus: [
          { label: S_CLOUD, status: 'not_found' },
          { label: S_HOME, status: 'found', size: 1073741824, bitrate: 6200000 },
          { label: S_NAS, status: 'not_found' },
        ] },
      { ts: now - 3600000, type: 'movie', contentName: 'Interstellar', imdbId: 'tt0816692', ms: 391,
        bestServer: { label: S_NAS, size: 19327352832, bitrate: 38000000 },
        serverStatus: [
          { label: S_CLOUD, status: 'found', size: 19327352832, bitrate: 38000000 },
          { label: S_HOME, status: 'offline' },
          { label: S_NAS, status: 'found', size: 19327352832, bitrate: 38000000 },
        ] },
      { ts: now - 7200000, type: 'movie', contentName: 'Poor Things', imdbId: 'tt14230458', ms: 2103,
        bestServer: null,
        serverStatus: [
          { label: S_CLOUD, status: 'not_found' },
          { label: S_HOME, status: 'not_found' },
          { label: S_NAS, status: 'not_found' },
        ] },
    ];
  }

  function dailyUptime(days, pct) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < days; i++) {
      const day = new Date(d); day.setDate(day.getDate() - i);
      const checks = 288;
      const up = Math.round(checks * (pct / 100 + (Math.random() - 0.5) * 0.04));
      out.push({ day: day.toISOString().slice(0, 10), checks, up_checks: Math.min(checks, Math.max(0, up)) });
    }
    return out;
  }

  function mockResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function resolveMock(path, method, init) {
    const m = method.toUpperCase();
    const healthRows = SERVERS.map(s => ({
      url: s.url, label: s.label, type: s.type,
      history: genHealthHistory(s.label, s.url, s.type, s.label.includes('NAS') ? 31 : s.type === 'jellyfin' ? 68 : 42),
    }));

    if (path === '/api/billing/status' && m === 'GET') {
      return { body: { status: 'active', hasAccess: true, periodEnd: new Date(Date.now() + 28 * 86400000).toISOString(), planPrice: '$4/mo' } };
    }
    if (path === '/api/billing/config' && m === 'GET') {
      return { body: { enabled: true, planPrice: '$4/mo', clientId: null, planId: null, plans: [
        { id: 'free', name: 'Free', price: '$0', period: 'forever', features: ['Browse only'], limited: true },
        { id: 'pro', name: 'Bridge Pro', price: '$4/mo', period: 'month', features: ['Unlimited servers', 'Best-file routing', 'Manifest URL'], featured: true },
      ] } };
    }
    if (path === '/api/billing/history' && m === 'GET') {
      return { body: { payments: [{ paid_at: new Date(Date.now() - 30 * 86400000).toISOString(), amount: 4, currency: 'USD', status: 'completed' }], upcoming: { date: new Date(Date.now() + 28 * 86400000).toISOString(), amount: '$4.00' } } };
    }
    if (path.startsWith('/api/billing/') && m === 'POST') return { body: { ok: true, demo: true } };
    if (path === '/api/user/config') {
      if (m === 'GET') return { body: { config: DEMO_FORM_STATE } };
      if (m === 'POST') return { body: { ok: true, demo: true } };
    }
    if (path === '/api/health/history' && m === 'GET') return { body: healthRows };
    if (path === '/api/health/register' && m === 'POST') return { body: { ok: true } };
    if (path === '/api/health/ping-now' && m === 'POST') return { body: { ok: true } };
    if (path === '/api/user/server-history' && m === 'GET') {
      return { body: { servers: SERVERS.map(s => ({ url: s.url.replace(/\/+$/, ''), daily: dailyUptime(30, s.label.includes('NAS') ? 99.2 : 97.5) })) } };
    }
    if (path === '/api/server-sessions' && m === 'POST') {
      let body = {};
      try { body = JSON.parse(init?.body || '{}'); } catch {}
      const live = body.label === S_CLOUD
        ? [{ title: 'Dune: Part Two', server: S_CLOUD, user: 'Alex', client: 'Apple TV' }]
        : body.label === S_HOME
          ? [{ title: 'Breaking Bad', server: S_HOME, user: 'demo', client: 'Stremio Web' }]
          : [];
      return { body: { live } };
    }
    if (path === '/api/user/activity' && m === 'GET') {
      return { body: {
        hasServers: true, serverCount: 3,
        live: [
          { title: 'Dune: Part Two', server: S_CLOUD, user: 'Alex', client: 'Apple TV' },
          { title: 'Breaking Bad S01E01', server: S_HOME, user: 'demo', client: 'Stremio Web' },
        ],
        recent: [
          { title: 'Oppenheimer', server: S_CLOUD, ts: new Date(Date.now() - 3600000).toISOString() },
          { title: 'The Bear', server: S_HOME, season: 2, episode: 4, ts: new Date(Date.now() - 7200000).toISOString() },
          { title: 'Interstellar', server: S_NAS, ts: new Date(Date.now() - 86400000).toISOString() },
          { title: 'Shogun', server: S_CLOUD, season: 1, episode: 3, ts: new Date(Date.now() - 172800000).toISOString() },
        ],
      } };
    }
    if (path === '/api/request-log' && m === 'GET') return { body: requestLogEntries() };
    if (path === '/api/clear-request-log' && m === 'POST') return { body: { ok: true, demo: true } };
    if (path === '/api/library-stats' && m === 'POST') {
      let body = {};
      try { body = JSON.parse(init?.body || '{}'); } catch {}
      const k = [body.url, body.apiKey, body.userId].join('|');
      const st = LIB_STATS[k] || { movies: 500, shows: 80, episodes: 1200 };
      return { body: { movies: st.movies, shows: st.shows, episodes: st.episodes } };
    }
    if (path === '/api/ping-servers' && m === 'POST') {
      return { body: { results: [{ label: S_CLOUD, ms: 42 }, { label: S_HOME, ms: 68 }, { label: S_NAS, ms: 31 }] } };
    }
    if (path === '/api/test-connection' && m === 'POST') return { body: { ok: true, message: 'Demo: connection successful' } };
    if (path === '/api/fetch-credentials' && m === 'POST') return { body: { apiKey: 'demo_refreshed_key_a1b2', userId: 'demo_user_99' } };
    if (path === '/api/catalog/validate' && m === 'POST') return { body: { valid: true, count: 248 } };
    if (path === '/api/server-info' && m === 'GET') return { body: { region: 'US-East (Railway)', demo: true } };
    if (path === '/api/tickets/stats' && m === 'GET') return { body: { open: 1, in_progress: 1, closed: 2, awaiting: 1 } };
    if (path === '/api/tickets' && m === 'GET') {
      return { body: [
        { id: 'demo-tkt-1', subject: '4K not picked over 1080p', status: 'open', category: 'streaming', priority: 'normal', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString(), unread: 1 },
        { id: 'demo-tkt-2', subject: 'Trakt row not refreshing', status: 'in_progress', category: 'general', priority: 'low', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 7200000).toISOString(), unread: 0 },
      ] };
    }
    if (path.startsWith('/api/tickets/') && m === 'GET') {
      return { body: {
        id: 'demo-tkt-1', subject: '4K not picked over 1080p', status: 'open', category: 'streaming',
        body: 'When I play Dune in Stremio it picks the 1080p on Jellyfin instead of the 4K on Cloud Emby.',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        messages: [
          { id: 'm1', body: 'When I play Dune it picks 1080p on Jellyfin instead of 4K on Cloud Emby.', author: 'you', created_at: new Date(Date.now() - 86400000).toISOString() },
          { id: 'm2', body: 'Check Streaming → sort by largest file. Cloud Emby should win if the 4K file is bigger.', author: 'support', created_at: new Date(Date.now() - 3600000).toISOString() },
        ],
      } };
    }
    if (path.startsWith('/api/tickets') && m === 'POST') return { body: { id: 'demo-new', demo: true } };
    if (path === '/api/news' && m === 'GET') {
      return { body: [
        { id: 'n1', title: 'Best-file routing got faster', body: 'Parallel server lookups now finish ~30% quicker.', created_at: new Date(Date.now() - 259200000).toISOString() },
        { id: 'n2', title: 'Compare every server in the request log', body: 'See exactly which server had the biggest file for each play.', created_at: new Date(Date.now() - 604800000).toISOString() },
      ] };
    }
    if (path === '/api/user/manifest' && m === 'GET') {
      const base = `${location.origin}/u/demo-preview-token`;
      return { body: { url: `${base}/manifest.json`, token: 'demo-preview-token' } };
    }
    if (path === '/api/user/manifest' && m === 'POST') {
      const base = `${location.origin}/u/demo-preview-token`;
      return { body: { url: `${base}/manifest.json`, token: 'demo-preview-token' } };
    }
    if (path === '/api/user/manifest-qr' && m === 'GET') {
      return { body: { dataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect fill="#111" width="120" height="120"/><text x="60" y="64" text-anchor="middle" fill="#7b61ff" font-size="11" font-family="sans-serif">DEMO QR</text></svg>') } };
    }
    if (path.startsWith('/api/') && m === 'POST') return { body: { ok: true, demo: true } };
    return undefined;
  }

  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (!isActive()) return _fetch(input, init);
    try {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const path = new URL(raw, location.origin).pathname;
      const method = (init && init.method) || 'GET';
      const mock = resolveMock(path, method, init);
      if (mock !== undefined) return Promise.resolve(mockResponse(mock.body, mock.status));
    } catch { /* fall through */ }
    return _fetch(input, init);
  };

  function ensureTourDom() {
    if (document.getElementById('demo-site-tour')) return;
    const el = document.createElement('div');
    el.id = 'demo-site-tour';
    el.style.display = 'none';
    el.innerHTML = `<div class="dst-backdrop" id="dst-backdrop"></div>
      <div class="dst-spot" id="dst-spot"></div>
      <div class="dst-card">
        <div class="dst-top"><span class="dst-badge">Guided tour</span><span class="dst-step" id="dst-step-lbl">1 / 6</span></div>
        <h3 class="dst-title" id="dst-title"></h3>
        <p class="dst-desc" id="dst-desc"></p>
        <ul class="dst-bullets" id="dst-bullets"></ul>
        <div class="dst-nav">
          <button type="button" class="btn-soft" id="dst-back">← Back</button>
          <button type="button" class="btn-soft" id="dst-skip">Skip</button>
          <button type="button" class="btn-generate" id="dst-next">Next →</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#dst-skip').onclick = closeSiteTour;
    el.querySelector('#dst-back').onclick = () => { if (tourStep > 0) { tourStep--; renderSiteTourStep(); } };
    el.querySelector('#dst-next').onclick = () => {
      if (tourStep < SITE_TOUR.length - 1) { tourStep++; renderSiteTourStep(); }
      else closeSiteTour();
    };
    el.querySelector('#dst-backdrop').onclick = closeSiteTour;
  }

  function clearTourHighlight() {
    document.querySelectorAll('.demo-tour-highlight').forEach(el => el.classList.remove('demo-tour-highlight'));
  }

  function isVisibleTarget(el) {
    if (!el || el === document.body) return false;
    if (el.classList.contains('hidden-canonical')) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8;
  }

  function resolveHighlightTarget(el) {
    if (!el) return null;
    let best = null;
    let node = el;
    while (node && node !== document.body) {
      if (isVisibleTarget(node)) best = node;
      if ([...HIGHLIGHT_STOP].some(cls => node.classList?.contains(cls)) || node.id === 'servers-container') break;
      node = node.parentElement;
    }
    return best || el;
  }

  function detachTourScroll() {
    if (!tourScrollHandler) return;
    window.removeEventListener('scroll', tourScrollHandler);
    tourScrollHandler = null;
  }

  function positionSpot(sel) {
    const spot = document.getElementById('dst-spot');
    if (!spot) return;
    clearTourHighlight();
    detachTourScroll();
    if (!sel) { spot.style.display = 'none'; return; }
    const raw = document.querySelector(sel);
    if (!raw) { spot.style.display = 'none'; return; }
    const target = resolveHighlightTarget(raw);
    if (!target) { spot.style.display = 'none'; return; }

    const place = () => {
      const r = target.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const pad = 8;
      clearTourHighlight();
      spot.style.display = 'block';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.left = (r.left - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      target.classList.add('demo-tour-highlight');
    };

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    place();
    requestAnimationFrame(() => requestAnimationFrame(place));
    setTimeout(place, 450);
    tourScrollHandler = () => { if (tourOpen) place(); };
    window.addEventListener('scroll', tourScrollHandler, { passive: true });
  }

  function renderSiteTourStep() {
    const step = SITE_TOUR[tourStep];
    if (!step) return;
    const lbl = document.getElementById('dst-step-lbl');
    const title = document.getElementById('dst-title');
    const desc = document.getElementById('dst-desc');
    const bullets = document.getElementById('dst-bullets');
    const back = document.getElementById('dst-back');
    const next = document.getElementById('dst-next');
    if (lbl) lbl.textContent = `${tourStep + 1} / ${SITE_TOUR.length}`;
    if (title) title.textContent = step.title;
    if (desc) desc.textContent = step.desc;
    if (bullets) bullets.innerHTML = (step.bullets || []).map(b => `<li>${b}</li>`).join('');
    if (back) back.style.visibility = tourStep === 0 ? 'hidden' : 'visible';
    if (next) next.textContent = tourStep === SITE_TOUR.length - 1 ? 'Finish tour' : 'Next →';

    const go = () => {
      if (location.hash !== '#/' + step.page) location.hash = '#/' + step.page;
      setTimeout(() => {
        if (window.onPageShow) window.onPageShow(step.page);
        positionSpot(step.highlight);
      }, step.page === 'install' ? 500 : 320);
    };
    go();
  }

  function openSiteTour(start = 0) {
    if (!isActive()) return;
    ensureTourDom();
    tourStep = Math.max(0, Math.min(start, SITE_TOUR.length - 1));
    tourOpen = true;
    const el = document.getElementById('demo-site-tour');
    el.style.display = 'block';
    requestAnimationFrame(() => el.classList.add('on'));
    document.body.classList.add('demo-tour-active');
    renderSiteTourStep();
  }

  function closeSiteTour() {
    tourOpen = false;
    detachTourScroll();
    clearTourHighlight();
    const el = document.getElementById('demo-site-tour');
    if (!el) return;
    el.classList.remove('on');
    document.body.classList.remove('demo-tour-active');
    setTimeout(() => { el.style.display = 'none'; }, 280);
    try { sessionStorage.removeItem(TOUR_FLAG); } catch {}
  }

  function renderBanner() {
    let el = document.getElementById('demo-site-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-site-banner';
      document.body.appendChild(el);
    }
    el.className = 'demo-site-banner';
    el.innerHTML = `<span class="dsb-icon">◆</span>
      <span class="dsb-text"><strong>Demo site</strong> · sample servers — best-file routing in action</span>
      <button type="button" class="dsb-btn dsb-tour" id="demo-tour-btn">Guided tour</button>
      <button type="button" class="dsb-btn dsb-exit" id="demo-exit-btn">Exit</button>
      <button type="button" class="dsb-btn dsb-sub" id="demo-sub-btn">Subscribe</button>`;
    el.querySelector('#demo-exit-btn').onclick = exitDemo;
    el.querySelector('#demo-sub-btn').onclick = () => { closeSiteTour(); exitDemo(); location.hash = '#/billing'; };
    el.querySelector('#demo-tour-btn').onclick = () => openSiteTour(0);
  }

  function applyDemoChrome() {
    document.body.classList.add('demo-site');
    document.body.classList.remove('locked-billing');
    renderBanner();
  }

  function enterDemo(startTour = true) {
    try {
      if (!sessionStorage.getItem(BACKUP)) {
        sessionStorage.setItem(BACKUP, localStorage.getItem(LS_KEY) || '');
      }
      localStorage.setItem(LS_KEY, JSON.stringify(DEMO_FORM_STATE));
      localStorage.setItem(LIB_CACHE, JSON.stringify(LIB_STATS));
      sessionStorage.setItem(FLAG, '1');
      if (startTour) sessionStorage.setItem(TOUR_FLAG, '1');
      location.href = location.pathname + '#/dashboard';
      location.reload();
    } catch {
      if (window.toast) window.toast('Could not start demo');
    }
  }

  function exitDemo() {
    try {
      closeSiteTour();
      const backup = sessionStorage.getItem(BACKUP);
      if (backup != null) localStorage.setItem(LS_KEY, backup);
      else localStorage.removeItem(LS_KEY);
      sessionStorage.removeItem(FLAG);
      sessionStorage.removeItem(BACKUP);
      sessionStorage.removeItem(TOUR_FLAG);
      localStorage.removeItem(LIB_CACHE);
      location.href = location.pathname + '#/billing';
      location.reload();
    } catch {
      location.reload();
    }
  }

  function init() {
    if (!isActive()) return;
    applyDemoChrome();
    if (window.MEBBilling && window.MEBBilling.refresh) window.MEBBilling.refresh();
    setTimeout(() => {
      if (typeof window.generateLinks === 'function') {
        try { window.generateLinks({ silent: true }); } catch {}
      }
      const page = (location.hash || '#/dashboard').replace(/^#\//, '');
      if (window.onPageShow) window.onPageShow(page);
      try {
        if (sessionStorage.getItem(TOUR_FLAG) === '1') {
          setTimeout(() => openSiteTour(0), 600);
        }
      } catch {}
    }, 400);
    window.addEventListener('resize', () => { if (tourOpen) positionSpot(SITE_TOUR[tourStep]?.highlight); });
  }

  window.MEBDemo = { isActive, enter: enterDemo, exit: exitDemo, applyChrome: applyDemoChrome, openTour: openSiteTour };

  if (isActive()) applyDemoChrome();
  document.addEventListener('DOMContentLoaded', init);
})();