// ─── Full-site demo mode: 1:1 UI with realistic sample data ─────────────────
(function () {
  const LS_KEY = 'meb_config_v1';
  const FLAG = 'meb_demo_active';
  const BACKUP = 'meb_demo_ls_backup';
  const LIB_CACHE = 'meb-libstats-cache';

  const SERVERS = [
    { label: 'ARCTV Emby', type: 'emby', url: 'https://emby.arctv.live', apiKey: 'demo_arctv_key_8f2a', userId: 'a1b2c3d4', enabled: true, cost: 12.99, costPeriod: 'monthly' },
    { label: 'Home Jellyfin', type: 'jellyfin', url: 'https://jellyfin.home.lab:8096', apiKey: 'demo_jelly_key_9c41', userId: 'e5f6a7b8', enabled: true, username: 'demo', password: '••••••••' },
    { label: 'Backup NAS', type: 'emby', url: 'https://192.168.1.42:8096', apiKey: 'demo_nas_key_3d77', userId: 'c9d0e1f2', enabled: true, cost: 4.5, costPeriod: 'monthly' },
  ];

  const LIB_STATS = {
    'https://emby.arctv.live|demo_arctv_key_8f2a|a1b2c3d4': { movies: 2847, shows: 412, episodes: 8934, ms: 42, ts: Date.now() },
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

  function isActive() {
    try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
  }

  function normUrl(u) { return (u || '').replace(/\/+$/, '').toLowerCase(); }

  function genHealthHistory(label, url, type, baseMs, uptime = 0.97) {
    const now = Date.now();
    const hist = [];
    for (let i = 0; i < 96; i++) {
      const up = Math.random() < uptime;
      hist.push({
        ts: now - i * 5 * 60 * 1000,
        up,
        ms: up ? Math.round(baseMs + (Math.random() - 0.5) * 18) : null,
        label,
        url,
        type,
      });
    }
    return hist;
  }

  function requestLogEntries() {
    const now = Date.now();
    return [
      { ts: now - 120000, type: 'movie', contentName: 'Dune: Part Two', imdbId: 'tt15239678', season: 0, episode: 0, ms: 842,
        bestServer: { label: 'ARCTV Emby', size: 26843545600, bitrate: 45000000 },
        serverStatus: [
          { label: 'ARCTV Emby', status: 'found', size: 26843545600, bitrate: 45000000 },
          { label: 'Home Jellyfin', status: 'not_found' },
          { label: 'Backup NAS', status: 'found', size: 12884901888, bitrate: 22000000 },
        ] },
      { ts: now - 480000, type: 'series', contentName: 'Breaking Bad', imdbId: 'tt0903747', season: 1, episode: 1, ms: 1124,
        bestServer: { label: 'Home Jellyfin', size: 2147483648, bitrate: 8500000 },
        serverStatus: [
          { label: 'ARCTV Emby', status: 'not_found' },
          { label: 'Home Jellyfin', status: 'found', size: 2147483648, bitrate: 8500000 },
          { label: 'Backup NAS', status: 'offline' },
        ] },
      { ts: now - 900000, type: 'movie', contentName: 'Oppenheimer', imdbId: 'tt15398776', ms: 623,
        bestServer: { label: 'ARCTV Emby', size: 32212254720, bitrate: 52000000 },
        serverStatus: [
          { label: 'ARCTV Emby', status: 'found', size: 32212254720, bitrate: 52000000 },
          { label: 'Home Jellyfin', status: 'found', size: 16106127360, bitrate: 28000000 },
          { label: 'Backup NAS', status: 'not_found' },
        ] },
      { ts: now - 1800000, type: 'series', contentName: 'The Bear', imdbId: 'tt1442464', season: 2, episode: 4, ms: 1456,
        bestServer: { label: 'Home Jellyfin', size: 1073741824, bitrate: 6200000 },
        serverStatus: [
          { label: 'ARCTV Emby', status: 'not_found' },
          { label: 'Home Jellyfin', status: 'found', size: 1073741824, bitrate: 6200000 },
          { label: 'Backup NAS', status: 'not_found' },
        ] },
      { ts: now - 3600000, type: 'movie', contentName: 'Interstellar', imdbId: 'tt0816692', ms: 391,
        bestServer: { label: 'Backup NAS', size: 19327352832, bitrate: 38000000 },
        serverStatus: [
          { label: 'ARCTV Emby', status: 'found', size: 19327352832, bitrate: 38000000 },
          { label: 'Home Jellyfin', status: 'offline' },
          { label: 'Backup NAS', status: 'found', size: 19327352832, bitrate: 38000000 },
        ] },
      { ts: now - 7200000, type: 'movie', contentName: 'Poor Things', imdbId: 'tt14230458', ms: 2103,
        bestServer: null,
        serverStatus: [
          { label: 'ARCTV Emby', status: 'not_found' },
          { label: 'Home Jellyfin', status: 'not_found' },
          { label: 'Backup NAS', status: 'not_found' },
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
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function resolveMock(path, method, init) {
    const m = method.toUpperCase();
    const healthRows = SERVERS.map(s => ({
      url: s.url,
      label: s.label,
      type: s.type,
      history: genHealthHistory(s.label, s.url, s.type, s.label.includes('NAS') ? 31 : s.type === 'jellyfin' ? 68 : 42),
    }));

    if (path === '/api/billing/status' && m === 'GET') {
      return { body: { status: 'active', hasAccess: true, periodEnd: new Date(Date.now() + 28 * 86400000).toISOString(), planPrice: '$4/mo' } };
    }
    if (path === '/api/billing/config' && m === 'GET') {
      return { body: { enabled: true, planPrice: '$4/mo', clientId: null, planId: null, plans: [
        { id: 'free', name: 'Free', price: '$0', period: 'forever', features: ['Browse only'], limited: true },
        { id: 'pro', name: 'Bridge Pro', price: '$4/mo', period: 'month', features: ['Unlimited servers', 'Manifest URL', 'Stream routing'], featured: true },
      ] } };
    }
    if (path === '/api/billing/history' && m === 'GET') {
      return { body: { payments: [{ paid_at: new Date(Date.now() - 30 * 86400000).toISOString(), amount: 4, currency: 'USD', status: 'completed' }], upcoming: { date: new Date(Date.now() + 28 * 86400000).toISOString(), amount: '$4.00' } } };
    }
    if (path.startsWith('/api/billing/') && m === 'POST') {
      return { body: { ok: true, demo: true } };
    }
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
      const live = body.label === 'ARCTV Emby'
        ? [{ title: 'Dune: Part Two', server: 'ARCTV Emby', user: 'Master', client: 'Apple TV' }]
        : body.label === 'Home Jellyfin'
          ? [{ title: 'Breaking Bad', server: 'Home Jellyfin', user: 'demo', client: 'Stremio Web' }]
          : [];
      return { body: { live } };
    }
    if (path === '/api/user/activity' && m === 'GET') {
      return { body: {
        hasServers: true,
        serverCount: 3,
        live: [
          { title: 'Dune: Part Two', server: 'ARCTV Emby', user: 'Master', client: 'Apple TV' },
          { title: 'Breaking Bad S01E01', server: 'Home Jellyfin', user: 'demo', client: 'Stremio Web' },
        ],
        recent: [
          { title: 'Oppenheimer', server: 'ARCTV Emby', ts: new Date(Date.now() - 3600000).toISOString() },
          { title: 'The Bear', server: 'Home Jellyfin', season: 2, episode: 4, ts: new Date(Date.now() - 7200000).toISOString() },
          { title: 'Interstellar', server: 'Backup NAS', ts: new Date(Date.now() - 86400000).toISOString() },
          { title: 'Shogun', server: 'ARCTV Emby', season: 1, episode: 3, ts: new Date(Date.now() - 172800000).toISOString() },
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
      return { body: { results: [
        { label: 'ARCTV Emby', ms: 42 },
        { label: 'Home Jellyfin', ms: 68 },
        { label: 'Backup NAS', ms: 31 },
      ] } };
    }
    if (path === '/api/test-connection' && m === 'POST') {
      return { body: { ok: true, message: 'Demo: connection successful' } };
    }
    if (path === '/api/fetch-credentials' && m === 'POST') {
      return { body: { apiKey: 'demo_refreshed_key_a1b2', userId: 'demo_user_99' } };
    }
    if (path === '/api/catalog/validate' && m === 'POST') {
      return { body: { valid: true, count: 248 } };
    }
    if (path === '/api/server-info' && m === 'GET') {
      return { body: { region: 'US-East (Railway)', demo: true } };
    }
    if (path === '/api/tickets/stats' && m === 'GET') {
      return { body: { open: 1, in_progress: 1, closed: 2, awaiting: 1 } };
    }
    if (path === '/api/tickets' && m === 'GET') {
      return { body: [
        { id: 'demo-tkt-1', subject: 'Best server not picking 4K', status: 'open', category: 'streaming', priority: 'normal', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString(), unread: 1 },
        { id: 'demo-tkt-2', subject: 'Trakt row not refreshing', status: 'in_progress', category: 'general', priority: 'low', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 7200000).toISOString(), unread: 0 },
        { id: 'demo-tkt-3', subject: 'Welcome to Stream-Hub!', status: 'resolved', category: 'general', priority: 'normal', created_at: new Date(Date.now() - 604800000).toISOString(), updated_at: new Date(Date.now() - 432000000).toISOString(), unread: 0 },
      ] };
    }
    if (path.startsWith('/api/tickets/') && m === 'GET') {
      return { body: {
        id: 'demo-tkt-1', subject: 'Best server not picking 4K', status: 'open', category: 'streaming',
        body: 'When I play Dune in Stremio it picks the 1080p file on Jellyfin instead of the 4K on ARCTV. Is there a priority setting?',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        messages: [
          { id: 'm1', body: 'When I play Dune in Stremio it picks the 1080p file on Jellyfin instead of the 4K on ARCTV.', author: 'you', created_at: new Date(Date.now() - 86400000).toISOString() },
          { id: 'm2', body: 'Check Streaming → sort order is set to largest file. ARCTV should win if the 4K file is bigger. Want us to look at your request log?', author: 'support', created_at: new Date(Date.now() - 3600000).toISOString() },
        ],
      } };
    }
    if (path.startsWith('/api/tickets') && m === 'POST') {
      return { body: { id: 'demo-new', demo: true, message: 'Demo mode — ticket not saved' } };
    }
    if (path === '/api/news' && m === 'GET') {
      return { body: [
        { id: 'n1', title: 'Multi-server routing just got faster', body: 'Parallel lookups now complete ~30% quicker on average.', created_at: new Date(Date.now() - 259200000).toISOString() },
        { id: 'n2', title: 'New: Request log filters', body: 'Search and filter your stream resolution history from the Monitoring tab.', created_at: new Date(Date.now() - 604800000).toISOString() },
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
    if (path.startsWith('/api/') && m === 'POST') {
      return { body: { ok: true, demo: true } };
    }
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

  function renderBanner() {
    let el = document.getElementById('demo-site-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-site-banner';
      document.body.appendChild(el);
    }
    el.className = 'demo-site-banner';
    el.innerHTML = `<span class="dsb-icon">◆</span>
      <span class="dsb-text"><strong>Full demo site</strong> · sample servers &amp; data — explore every page</span>
      <button type="button" class="dsb-btn dsb-exit" id="demo-exit-btn">Exit demo</button>
      <button type="button" class="dsb-btn dsb-sub" id="demo-sub-btn">Subscribe</button>`;
    el.querySelector('#demo-exit-btn').onclick = exitDemo;
    el.querySelector('#demo-sub-btn').onclick = () => { exitDemo(); location.hash = '#/billing'; };
  }

  function applyDemoChrome() {
    document.body.classList.add('demo-site');
    document.body.classList.remove('locked-billing');
    renderBanner();
  }

  function enterDemo() {
    try {
      if (!sessionStorage.getItem(BACKUP)) {
        sessionStorage.setItem(BACKUP, localStorage.getItem(LS_KEY) || '');
      }
      localStorage.setItem(LS_KEY, JSON.stringify(DEMO_FORM_STATE));
      localStorage.setItem(LIB_CACHE, JSON.stringify(LIB_STATS));
      sessionStorage.setItem(FLAG, '1');
      sessionStorage.setItem('meb_demo_hash', '#/dashboard');
      location.href = location.pathname + '#/dashboard';
      location.reload();
    } catch {
      if (window.toast) window.toast('Could not start demo');
    }
  }

  function exitDemo() {
    try {
      const backup = sessionStorage.getItem(BACKUP);
      if (backup != null) localStorage.setItem(LS_KEY, backup);
      else localStorage.removeItem(LS_KEY);
      sessionStorage.removeItem(FLAG);
      sessionStorage.removeItem(BACKUP);
      sessionStorage.removeItem('meb_demo_hash');
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
    }, 400);
  }

  window.MEBDemo = { isActive, enter: enterDemo, exit: exitDemo, applyChrome: applyDemoChrome };

  if (isActive()) applyDemoChrome();
  document.addEventListener('DOMContentLoaded', init);
})();