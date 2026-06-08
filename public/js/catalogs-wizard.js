// Catalogs wizard + external catalog management (extracted from configure.js)
(function () {
  'use strict';

  function esc(t) {
    return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  const escHtml = (typeof window !== 'undefined' && window.escHtml) ? window.escHtml : esc;

  const WIZARD_STEPS = ['connect', 'library', 'discover', 'review'];
  const NAV_HINTS = {
    connect: 'Keys optional — Streaming Top 10 works without any keys',
    library: 'Toggle rows your family actually watches',
    discover: 'Pick platforms — live Top 10 charts, refreshed automatically',
    review: 'Test rows, then save to push to Stremio',
  };
  const PROGRESS_RING = 113;
  let _currentStep = 'connect';
  let _selectedPreset = null;
  let _galleryCat = 'all';
  let _keyTested = { trakt: null, tmdb: null, mdblist: null, rpdb: null };

  window.nextCatId = window.nextCatId || 0;
// -- External Catalogs --------------------------------------------------------
const TRAKT_LIST_NAMES = {
  'trending': 'Trending', 'popular': 'Popular',
  'watched/weekly': 'Most Watched', 'anticipated': 'Anticipated',
};

// -- Streaming charts source (proxied addon; display names are white-labeled in UI) --
const TOP_STREAMING = {
  baseUrl: 'https://top-streaming.stream/471c23c0-6756-471c-a7eb-f41927b5c214',
  mainPlatforms: ['netflix', 'prime', 'disney', 'hulu', 'max', 'apple'],
};

const PLATFORM_LABELS = {
  netflix: 'Netflix', prime: 'Prime Video', disney: 'Disney+', hulu: 'Hulu',
  max: 'Max', apple: 'Apple TV+', paramount: 'Paramount+', peacock: 'Peacock',
  discovery: 'Discovery+', vudu: 'Vudu', starz: 'STARZ', viki: 'Viki', crunchyroll: 'Crunchyroll',
};

function friendlyCatalogName(c) {
  const plat = PLATFORM_LABELS[c.group] || c.group;
  if (c.id && c.id.indexOf('overall') >= 0) return plat + ' Trending';
  return plat + ' Top 10 — ' + (c.type === 'series' ? 'Shows' : 'Movies');
}

const TOP_STREAMING_MANIFEST_CATALOGS = [
  { id: 'netflix-movies-united-states', type: 'movie', name: 'Netflix - Top 10 United States', group: 'netflix' },
  { id: 'netflix-series-united-states', type: 'series', name: 'Netflix - Top 10 United States', group: 'netflix' },
  { id: 'amazon-prime-movies-united-states', type: 'movie', name: 'Amazon Prime Video - Top 10 United States', group: 'prime' },
  { id: 'amazon-prime-series-united-states', type: 'series', name: 'Amazon Prime Video - Top 10 United States', group: 'prime' },
  { id: 'disney-movies-united-states', type: 'movie', name: 'Disney+ - Top 10 United States', group: 'disney' },
  { id: 'disney-series-united-states', type: 'series', name: 'Disney+ - Top 10 United States', group: 'disney' },
  { id: 'apple-tv-movies-united-states', type: 'movie', name: 'Apple TV - Top 10 United States', group: 'apple' },
  { id: 'apple-tv-series-united-states', type: 'series', name: 'Apple TV - Top 10 United States', group: 'apple' },
  { id: 'hbo-max-movies-united-states', type: 'movie', name: 'HBO Max - Top 10 United States', group: 'max' },
  { id: 'hbo-max-series-united-states', type: 'series', name: 'HBO Max - Top 10 United States', group: 'max' },
  { id: 'hulu-movie-united-states', type: 'movie', name: 'Hulu - Top 10 United States', group: 'hulu' },
  { id: 'hulu-series-united-states', type: 'series', name: 'Hulu - Top 10 United States', group: 'hulu' },
  { id: 'paramount-plus-movies-united-states', type: 'movie', name: 'Paramount+ - Top 10 United States', group: 'paramount' },
  { id: 'paramount-plus-series-united-states', type: 'series', name: 'Paramount+ - Top 10 United States', group: 'paramount' },
  { id: 'peacock-movies-united-states', type: 'movie', name: 'Peacock - Top 10 United States', group: 'peacock' },
  { id: 'peacock-series-united-states', type: 'series', name: 'Peacock - Top 10 United States', group: 'peacock' },
  { id: 'discovery-plus-overall-amazon-channels-united-states', type: 'series', name: 'Discovery+ - Overall United States', group: 'discovery' },
  { id: 'vudu-movies-united-states', type: 'movie', name: 'Vudu - Top 10 United States', group: 'vudu' },
  { id: 'vudu-series-united-states', type: 'series', name: 'Vudu - Top 10 United States', group: 'vudu' },
  { id: 'starz-movies-united-states', type: 'movie', name: 'STARZ - Top 10 United States', group: 'starz' },
  { id: 'starz-series-united-states', type: 'series', name: 'STARZ - Top 10 United States', group: 'starz' },
  { id: 'viki-overall-united-states', type: 'series', name: 'Viki - Top 10 United States', group: 'viki' },
  { id: 'crunchyroll-overall-amazon-channels-united-states', type: 'series', name: 'Crunchyroll - Overall United States', group: 'crunchyroll' },
];

function topStreamingEntry(c) {
  return {
    provider: 'addon',
    sourceUrl: TOP_STREAMING.baseUrl,
    catalogId: c.id,
    catalogType: c.type,
    mediaType: c.type,
    name: friendlyCatalogName(c),
  };
}

function setSheetOpen(open) {
  var layer = document.getElementById('cw-sheet-layer');
  var page = document.getElementById('page-catalogs');
  if (layer) {
    if (open) layer.removeAttribute('hidden');
    else layer.setAttribute('hidden', '');
  }
  if (page) page.classList.toggle('cw-sheet-open', !!open);
}

function catalogsForGroup(group) {
  return TOP_STREAMING_MANIFEST_CATALOGS.filter(c => c.group === group).map(topStreamingEntry);
}

const STREAMING_PRESETS = {
  netflix:   { label: 'Netflix',   color: '#E50914', letter: 'N',  category: 'streaming', catalogs: catalogsForGroup('netflix') },
  prime:     { label: 'Prime',     color: '#00A8E1', letter: 'P',  category: 'streaming', catalogs: catalogsForGroup('prime') },
  disney:    { label: 'Disney+',   color: '#0063E5', letter: 'D+', category: 'streaming', catalogs: catalogsForGroup('disney') },
  hulu:      { label: 'Hulu',      color: '#1CE783', letter: 'H',  category: 'streaming', catalogs: catalogsForGroup('hulu') },
  max:       { label: 'Max',       color: '#002BE7', letter: 'M',  category: 'streaming', catalogs: catalogsForGroup('max') },
  apple:     { label: 'Apple TV+', color: '#444444', letter: '\u25cf', category: 'streaming', catalogs: catalogsForGroup('apple') },
  paramount: { label: 'Paramount+', color: '#0064FF', letter: 'P+', category: 'more', catalogs: catalogsForGroup('paramount') },
  peacock:   { label: 'Peacock',   color: '#000000', letter: 'Pc', category: 'more', catalogs: catalogsForGroup('peacock') },
  discovery: { label: 'Discovery+', color: '#1A98FF', letter: 'D+', category: 'more', catalogs: catalogsForGroup('discovery') },
  vudu:      { label: 'Vudu',      color: '#3399FF', letter: 'V',  category: 'more', catalogs: catalogsForGroup('vudu') },
  starz:     { label: 'STARZ',     color: '#000000', letter: 'S',  category: 'more', catalogs: catalogsForGroup('starz') },
  viki:      { label: 'Viki',      color: '#00B4D8', letter: 'Vk', category: 'more', catalogs: catalogsForGroup('viki') },
  crunchyroll: { label: 'Crunchyroll', color: '#F47521', letter: 'Cr', category: 'more', catalogs: catalogsForGroup('crunchyroll') },
};

const GALLERY_KEYS = Object.keys(STREAMING_PRESETS);
const PRESET_CATS = Object.fromEntries(GALLERY_KEYS.map(k => [k, STREAMING_PRESETS[k].category || 'all']));

function shortSheetLabel(cat) {
  if (cat.mediaType === 'series') return 'Top 10 Shows';
  return 'Top 10 Movies';
}

function applySheetTheme(p) {
  var sheet = document.getElementById('cw-preset-sheet');
  var mark = document.getElementById('cw-preset-mark');
  if (sheet && p) sheet.style.setProperty('--sheet-accent', p.color || 'var(--accent)');
  if (mark && p) mark.textContent = p.letter || p.label.charAt(0);
}

function presetQuickSelect(mode) {
  document.querySelectorAll('.cw-preset-quick-btn').forEach(function(btn) {
    btn.classList.toggle('on', btn.dataset.quick === mode);
  });
  document.querySelectorAll('.preset-cb').forEach(function(cb) {
    var cat = STREAMING_PRESETS[_selectedPreset];
    if (!cat) return;
    var entry = cat.catalogs[Number(cb.dataset.idx)];
    if (!entry) return;
    if (mode === 'both') cb.checked = true;
    else if (mode === 'movie') cb.checked = entry.mediaType === 'movie';
    else if (mode === 'series') cb.checked = entry.mediaType === 'series';
    var row = cb.closest('.cw-preset-row');
    if (row) row.classList.toggle('is-checked', cb.checked);
  });
  updatePresetCount();
}

function initPresets() { /* gallery built by renderGallery() */ }
function selectPreset(key) {
  _selectedPreset = key;
  var p = STREAMING_PRESETS[key];
  document.querySelectorAll('.cw-svc-card').forEach(function(b) { b.classList.toggle('active', b.dataset.key === key); });
  var list = document.getElementById('cw-preset-list');
  var sheet = document.getElementById('cw-preset-sheet');
  var sub = document.getElementById('cw-preset-sub');
  var quick = document.getElementById('cw-preset-quick');
  if (!list || !sheet) return;
  applySheetTheme(p);
  if (sub) sub.textContent = 'Tap a row to include or exclude · both selected by default';
  if (quick) {
    quick.hidden = p.catalogs.length < 2;
    quick.querySelectorAll('.cw-preset-quick-btn').forEach(function(btn) {
      btn.classList.toggle('on', btn.dataset.quick === 'both');
    });
  }
  list.className = 'cw-preset-list' + (p.catalogs.length === 2 ? ' cw-preset-list--duo' : '');
  list.innerHTML = '';
  p.catalogs.forEach(function(cat, idx) {
    var row = document.createElement('label');
    row.className = 'cw-preset-row preset-preview-item is-checked';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'preset-cb';
    cb.dataset.idx = idx;
    cb.addEventListener('change', function() {
      row.classList.toggle('is-checked', cb.checked);
      updatePresetCount();
      syncPresetQuickFromChecks();
    });
    var icon = document.createElement('span');
    icon.className = 'cw-preset-row-icon';
    icon.textContent = cat.mediaType === 'series' ? '📺' : '🎬';
    icon.setAttribute('aria-hidden', 'true');
    var body = document.createElement('span');
    body.className = 'cw-preset-row-body';
    var title = document.createElement('span');
    title.className = 'cw-preset-row-title';
    title.textContent = shortSheetLabel(cat);
    var hint = document.createElement('span');
    hint.className = 'cw-preset-row-hint';
    hint.textContent = cat.mediaType === 'series' ? '10 trending series' : '10 trending movies';
    body.appendChild(title);
    body.appendChild(hint);
    var tick = document.createElement('span');
    tick.className = 'cw-preset-row-tick';
    tick.textContent = '✓';
    row.appendChild(cb);
    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(tick);
    list.appendChild(row);
  });
  updatePresetCount();
  sheet.classList.add('on');
  setSheetOpen(true);
  document.getElementById('cw-preset-title').textContent = p.label;
}

function syncPresetQuickFromChecks() {
  var cbs = document.querySelectorAll('.preset-cb');
  if (!cbs.length) return;
  var all = true, movies = true, series = true;
  cbs.forEach(function(cb) {
    if (!cb.checked) all = false;
    var cat = STREAMING_PRESETS[_selectedPreset];
    if (!cat) return;
    var entry = cat.catalogs[Number(cb.dataset.idx)];
    if (!entry) return;
    if (entry.mediaType === 'movie' && !cb.checked) movies = false;
    if (entry.mediaType === 'series' && !cb.checked) series = false;
  });
  var mode = all ? 'both' : (movies && !series ? 'movie' : (!movies && series ? 'series' : 'custom'));
  document.querySelectorAll('.cw-preset-quick-btn').forEach(function(btn) {
    btn.classList.toggle('on', btn.dataset.quick === mode);
  });
}

function closePresetSheet() {
  var sheet = document.getElementById('cw-preset-sheet');
  if (sheet) sheet.classList.remove('on');
  setSheetOpen(false);
  document.querySelectorAll('.cw-svc-card').forEach(function(b) { b.classList.remove('active'); });
  _selectedPreset = null;
}
function updatePresetCount() {
  if (!_selectedPreset) return;
  var cbs = document.querySelectorAll('.preset-cb');
  var checked = document.querySelectorAll('.preset-cb:checked').length;
  var ab = document.getElementById('btn-apply-preset');
  var hint = document.getElementById('cw-preset-foot-hint');
  if (!ab) return;
  ab.textContent = 'Add to home';
  ab.disabled = checked === 0;
  if (hint) {
    if (!checked) {
      hint.textContent = 'Select at least one row';
    } else if (checked === cbs.length) {
      hint.textContent = cbs.length === 1 ? '1 chart row' : 'Movies + Shows · ' + checked + ' rows';
    } else if (checked === 1) {
      var only = document.querySelector('.preset-cb:checked');
      var row = only && only.closest('.cw-preset-row');
      var title = row && row.querySelector('.cw-preset-row-title');
      hint.textContent = (title ? title.textContent : '1 row') + ' only';
    } else {
      hint.textContent = checked + ' rows selected';
    }
  }
}
function catalogRowExists(cat) {
  var dominated = false;
  document.querySelectorAll('.catalog-row').forEach(function(row) {
    if (cat.provider === 'addon') {
      if (row.dataset.provider === 'addon'
        && row.dataset.sourceUrl === (cat.sourceUrl || '')
        && row.dataset.catalogId === (cat.catalogId || '')
        && row.dataset.catalogType === (cat.catalogType || cat.mediaType || 'movie')) dominated = true;
      return;  // addon rows are identified by source+id+type, not display name
    }
    if (row.dataset.provider === cat.provider && row.dataset.name === cat.name && row.dataset.mediaType === (cat.mediaType || 'movie')) dominated = true;
    if (row.dataset.provider === cat.provider && row.dataset.listUrl && row.dataset.listUrl === (cat.listUrl || '') && row.dataset.mediaType === (cat.mediaType || 'movie')) dominated = true;
    if (row.dataset.provider === cat.provider && row.dataset.listType && row.dataset.listType === (cat.listType || '') && row.dataset.mediaType === (cat.mediaType || 'movie')) dominated = true;
  });
  return dominated;
}

function applyPreset() {
  if (!_selectedPreset) return;
  var p = STREAMING_PRESETS[_selectedPreset];
  var mdbKey = (document.getElementById("mdblist-api-key") || {}).value || "";
  var cbs = document.querySelectorAll(".preset-cb");
  var skipped = 0;
  cbs.forEach(function(cb) {
    if (!cb.checked) return;
    var cat = p.catalogs[parseInt(cb.dataset.idx, 10)];
    if (!cat) return;
    var catObj = { provider: cat.provider, listType: cat.listType || "", listUrl: cat.listUrl || "",
      mediaType: cat.mediaType || "movie", name: cat.name, apiKey: cat.provider === "mdblist" ? mdbKey : "", enabled: true };
    if (cat.provider === 'tmdb') {
      catObj.tmdbMode          = cat.tmdbMode          || 'charts';
      catObj.tmdbChart         = cat.tmdbChart         || '';
      catObj.tmdbGenre         = cat.tmdbGenre         || '';
      catObj.tmdbWatchProvider = cat.tmdbWatchProvider || '';
      catObj.tmdbSortBy        = cat.tmdbSortBy        || 'popularity.desc';
      if (cat.tmdbMinRating != null) catObj.tmdbMinRating = cat.tmdbMinRating;
      if (cat.tmdbYearFrom  != null) catObj.tmdbYearFrom  = cat.tmdbYearFrom;
      if (cat.tmdbYearTo    != null) catObj.tmdbYearTo    = cat.tmdbYearTo;
    }
    if (cat.provider === 'addon') {
      catObj.sourceUrl   = cat.sourceUrl   || '';
      catObj.catalogId   = cat.catalogId   || '';
      catObj.catalogType = cat.catalogType || cat.mediaType || 'movie';
    }
    if (catalogRowExists(catObj)) { skipped++; return; }
    addExternalCatalog(catObj);
  });
  if (skipped > 0) { var ind = document.getElementById('autosave-indicator'); if (ind) { ind.textContent = skipped + ' duplicate(s) skipped'; ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); } }
  closePresetSheet();
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
}

function addCatalogEntries(catalogs, opts) {
  var added = 0, skipped = 0;
  (catalogs || []).forEach(function(cat) {
    var catObj = Object.assign({ enabled: true }, cat);
    if (catalogRowExists(catObj)) { skipped++; return; }
    addExternalCatalog(catObj);
    added++;
  });
  if (added || skipped) {
    var msg = added ? 'Added ' + added + ' row' + (added === 1 ? '' : 's') : '';
    if (skipped) msg += (msg ? ', ' : '') + skipped + ' duplicate(s) skipped';
    var ind = document.getElementById('autosave-indicator');
    if (ind) { ind.textContent = msg || 'No new rows'; ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); }
    if (window.autoSave) window.autoSave();
    if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
    if (opts && opts.goReview && added) goToStep('review');
  }
  return added;
}

function installTopStreamingAll() {
  return addCatalogEntries(TOP_STREAMING_MANIFEST_CATALOGS.map(topStreamingEntry), { goReview: true });
}

function installTopStreamingMain() {
  var cats = TOP_STREAMING.mainPlatforms.flatMap(function(g) { return catalogsForGroup(g); });
  return addCatalogEntries(cats, { goReview: true });
}

function onCatalogProviderChange() {
  const provider = document.getElementById('cat-provider').value;
  const traktFld = document.getElementById('cat-trakt-list');
  const urlFld   = document.getElementById('cat-list-url');
  const nameFld  = document.getElementById('cat-name');
  traktFld.style.display = provider === 'trakt' ? '' : 'none';
  urlFld.style.display   = (provider === 'mdblist' || provider === 'imdb' || provider === 'letterboxd') ? '' : 'none';
  var tmdbFld = document.getElementById('cat-tmdb-fields');
  if (tmdbFld) tmdbFld.style.display = provider === 'tmdb' ? 'flex' : 'none';
  if (provider !== 'tmdb') { var mtEl = document.getElementById('cat-media-type'); if (mtEl) mtEl.disabled = false; }
  const mt = document.getElementById('cat-media-type').value;
  const typeName = mt === 'series' ? 'Shows' : mt === 'both' ? 'Movies & Shows' : 'Movies';
  if (provider === 'trakt') { const lt = document.getElementById('cat-trakt-list').value; nameFld.value = 'Trakt ' + (TRAKT_LIST_NAMES[lt] || 'Trending') + ' ' + typeName; }
  else if (provider === 'mdblist')    { nameFld.value = 'MDbList ' + typeName; }
  else if (provider === 'imdb')       { nameFld.value = 'IMDb List'; }
  else if (provider === 'letterboxd') { nameFld.value = 'Letterboxd List'; }
  else if (provider === 'tmdb') { updateTmdbAutoName(); return; }
  else { nameFld.value = ''; }
}

function onCatalogUrlInput() {
  const url = (document.getElementById('cat-list-url').value || '').trim();
  const nameFld = document.getElementById('cat-name');
  const autos = ['Trakt', 'MDbList', 'IMDb', 'Letterboxd'];
  if (!nameFld.value || autos.some(function(a){ return nameFld.value.startsWith(a); })) {
    const m = url.match(/\/([^/?#]+)\/?(?:[?#].*)?$/);
    if (m) nameFld.value = decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
  }
}

function setTmdbMode(mode) {
  document.querySelectorAll('.tmdb-mode-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.mode === mode); });
  var chartsEl = document.getElementById('cat-tmdb-charts-fields');
  var discEl   = document.getElementById('cat-tmdb-discover-fields');
  if (chartsEl) chartsEl.style.display = mode === 'charts' ? '' : 'none';
  if (discEl)   discEl.style.display   = mode === 'discover' ? 'flex' : 'none';
  updateTmdbAutoName();
}

function onTmdbChartChange() {
  var chart = (document.getElementById('cat-tmdb-chart')||{}).value || '';
  var mtSel = document.getElementById('cat-media-type');
  if (chart === 'now-playing' || chart === 'upcoming') {
    if (mtSel) { mtSel.value = 'movie'; mtSel.disabled = true; }
  } else {
    if (mtSel) mtSel.disabled = false;
  }
  updateTmdbAutoName();
}

function updateTmdbAutoName() {
  var nameFld = document.getElementById('cat-name');
  if (!nameFld) return;
  var autoStarts = ['TMDB ', 'Trakt ', 'MDbList ', 'IMDb ', 'Letterboxd '];
  var isAuto = !nameFld.value || autoStarts.some(function(p){ return nameFld.value.startsWith(p); });
  if (!isAuto) return;
  var activeBtn = document.querySelector('.tmdb-mode-btn.active');
  var mode = activeBtn ? activeBtn.dataset.mode : 'charts';
  var mt = (document.getElementById('cat-media-type')||{}).value || 'movie';
  var typeName = mt === 'series' ? 'Shows' : 'Movies';
  if (mode === 'charts') {
    var chart = (document.getElementById('cat-tmdb-chart')||{}).value || 'trending-week';
    var chartLabels = {'trending-week':'Trending Weekly','trending-day':'Trending Daily',
      'popular':'Popular','top-rated':'Top Rated','now-playing':'Now Playing','upcoming':'Upcoming'};
    nameFld.value = 'TMDB '+(chartLabels[chart]||chart)+' '+typeName;
  } else {
    var provSel = document.getElementById('cat-tmdb-watch-provider');
    var provText = provSel ? (provSel.options[provSel.selectedIndex]||{}).text||'' : '';
    var genreSel = document.getElementById('cat-tmdb-genre');
    var genreText = genreSel ? (genreSel.options[genreSel.selectedIndex]||{}).text||'' : '';
    var rating = (document.getElementById('cat-tmdb-min-rating')||{}).value || '';
    var parts = ['TMDB'];
    if (provText && provText !== 'Any Service') parts.push(provText);
    if (genreText && genreText !== 'Any Genre') parts.push(genreText);
    parts.push(typeName);
    var label = parts.join(' ');
    if (rating) label += ' '+rating+'+';
    nameFld.value = label;
  }
}

function renderCatalogRow(cat, id) {
  const badges = { trakt: 'Trakt', mdblist: 'MDbList', imdb: 'IMDb', letterboxd: 'Letterboxd', tmdb: 'TMDB', addon: 'Charts' };
  const typeBadge = cat.mediaType === 'both' ? 'Movies + Shows' : cat.mediaType === 'series' ? 'Shows' : 'Movies';
  const badge  = badges[cat.provider] || cat.provider;
  var detail;
  if (cat.provider === 'tmdb') {
    var chartNames = {'trending-week':'Trending Weekly','trending-day':'Trending Daily',
      'popular':'Popular','top-rated':'Top Rated','now-playing':'Now Playing','upcoming':'Upcoming'};
    if (cat.tmdbMode === 'trending-provider') {
      var provNamesT = {'8':'Netflix','119':'Prime','337':'Disney+','15':'Hulu','1899':'Max','350':'Apple TV+'};
      detail = (provNamesT[cat.tmdbWatchProvider] || 'Provider '+cat.tmdbWatchProvider) + ' Trending';
    } else if (cat.tmdbMode === 'discover') {
      var dparts = [];
      if (cat.tmdbWatchProvider) {
        var provNames = {'8':'Netflix','119':'Prime','337':'Disney+','15':'Hulu','1899':'Max','350':'Apple TV+'};
        dparts.push(provNames[cat.tmdbWatchProvider] || 'Provider:'+cat.tmdbWatchProvider);
      }
      if (cat.tmdbGenre) dparts.push('Genre:'+cat.tmdbGenre);
      if (cat.tmdbMinRating) dparts.push(cat.tmdbMinRating+'+');
      if (cat.tmdbYearFrom || cat.tmdbYearTo) dparts.push((cat.tmdbYearFrom||'?')+'-'+(cat.tmdbYearTo||'?'));
      detail = dparts.join(' / ') || 'Discover';
    } else {
      detail = chartNames[cat.tmdbChart] || cat.tmdbChart || 'Charts';
    }
  } else if (cat.provider === 'addon') {
    detail = 'Top 10 · United States';
  } else {
    detail = cat.listType
      ? (TRAKT_LIST_NAMES[cat.listType] || cat.listType)
      : (cat.listUrl ? cat.listUrl.replace(/^https?:\/\//, '').substring(0, 38) + (cat.listUrl.length > 42 ? '...' : '') : '');
  }
  const div = document.createElement('div');
  div.className = 'catalog-row';
  div.id = 'cat-row-' + id;
  div.draggable = true;
  div.dataset.provider  = cat.provider  || '';
  div.dataset.listType  = cat.listType  || '';
  div.dataset.listUrl   = cat.listUrl   || '';
  div.dataset.mediaType = cat.mediaType || 'movie';
  div.dataset.name      = cat.name      || '';
  div.dataset.apiKey    = cat.apiKey    || '';
  div.dataset.count     = cat.count || '';
  div.dataset.valid     = cat.valid !== undefined ? cat.valid : '';
  div.dataset.shuffle   = cat.shuffle ? 'true' : '';
  div.dataset.tmdbMode         = cat.tmdbMode         || '';
  div.dataset.tmdbChart        = cat.tmdbChart        || '';
  div.dataset.tmdbGenre        = cat.tmdbGenre        || '';
  div.dataset.tmdbWatchProvider= cat.tmdbWatchProvider|| '';
  div.dataset.tmdbMinRating    = cat.tmdbMinRating != null ? String(cat.tmdbMinRating) : '';
  div.dataset.tmdbYearFrom     = cat.tmdbYearFrom  != null ? String(cat.tmdbYearFrom)  : '';
  div.dataset.tmdbYearTo       = cat.tmdbYearTo    != null ? String(cat.tmdbYearTo)    : '';
  div.dataset.tmdbSortBy       = cat.tmdbSortBy       || '';
  if (cat.provider === 'addon') {
    div.dataset.sourceUrl   = cat.sourceUrl   || '';
    div.dataset.catalogId   = cat.catalogId   || '';
    div.dataset.catalogType = cat.catalogType || cat.mediaType || 'movie';
  }
  function mk(tag, cls, text) { const el = document.createElement(tag); el.className = cls; if (text) el.textContent = text; return el; }
  const handle = mk('span', 'cat-drag-handle'); handle.title = 'Drag to reorder'; handle.textContent = '\u2803';
  const provBadge = mk('span', 'cat-provider-badge cat-prov-' + (cat.provider || ''), badge);
  const nameEl  = mk('span', 'cat-name-text',   cat.name || badge);
  const detailEl = mk('span', 'cat-detail-text', detail);
  const typeEl  = mk('span', 'cat-type-badge',  typeBadge);
  
  // Item count badge
  const countEl = mk('span', 'cat-count-badge', cat.count ? cat.count + ' items' : '');
  countEl.id = 'cat-count-' + id;
  if (cat.valid === false) countEl.classList.add('cat-count-error');
  else if (cat.valid === true) countEl.classList.add('cat-count-ok');
  
  // Test button
  const testBtn = mk('button', 'cat-test-btn', 'Test');
  testBtn.title = 'Test catalog connectivity';
  testBtn.id = 'cat-test-' + id;
  testBtn.addEventListener('click', function() { testCatalog(id); });
  
  const toggle = document.createElement('label'); toggle.className = 'toggle-switch cat-toggle'; toggle.title = 'Enable / disable';
  const togInput = document.createElement('input'); togInput.type = 'checkbox'; togInput.className = 'cat-enabled-cb'; togInput.checked = cat.enabled !== false;
  const togSlider = document.createElement('span'); togSlider.className = 'toggle-slider';
  toggle.appendChild(togInput); toggle.appendChild(togSlider);
  togInput.addEventListener('change', function() { div.classList.toggle('cat-disabled', !togInput.checked); if (window.autoSave) window.autoSave(); });
  if (cat.enabled === false) div.classList.add('cat-disabled');
  const btn = mk('button', 'cat-remove-btn'); btn.title = 'Remove'; btn.textContent = '\u2715';
  btn.addEventListener('click', function() { removeCatalog(id); });
  const shuffleBtn = mk('button', 'cat-shuffle-btn' + (cat.shuffle ? ' cat-shuffle-on' : ''), '🔀');
  shuffleBtn.title = 'Shuffle order each refresh';
  shuffleBtn.addEventListener('click', function() { var on = div.dataset.shuffle === 'true'; div.dataset.shuffle = on ? '' : 'true'; shuffleBtn.classList.toggle('cat-shuffle-on', !on); if (window.autoSave) window.autoSave(); });
  [handle, provBadge, nameEl, detailEl, typeEl, countEl, testBtn, shuffleBtn, toggle, btn].forEach(function(el){ div.appendChild(el); });
  return div;
}

// Test a catalog and update its count/status
async function testCatalog(id) {
  const row = document.getElementById('cat-row-' + id);
  const countEl = document.getElementById('cat-count-' + id);
  const testBtn = document.getElementById('cat-test-' + id);
  if (!row || !countEl || !testBtn) return;
  
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  countEl.textContent = '';
  countEl.className = 'cat-count-badge';
  
  const entry = {
    provider: row.dataset.provider,
    listType: row.dataset.listType,
    listUrl: row.dataset.listUrl,
    mediaType: row.dataset.mediaType,
    name: row.dataset.name,
    apiKey: row.dataset.apiKey
  };
  if (entry.provider === 'tmdb') {
    entry.tmdbMode          = row.dataset.tmdbMode          || 'charts';
    entry.tmdbChart         = row.dataset.tmdbChart         || '';
    entry.tmdbGenre         = row.dataset.tmdbGenre         || '';
    entry.tmdbWatchProvider = row.dataset.tmdbWatchProvider || '';
    if (row.dataset.tmdbMinRating) entry.tmdbMinRating = Number(row.dataset.tmdbMinRating);
    if (row.dataset.tmdbYearFrom)  entry.tmdbYearFrom  = Number(row.dataset.tmdbYearFrom);
    if (row.dataset.tmdbYearTo)    entry.tmdbYearTo    = Number(row.dataset.tmdbYearTo);
    entry.tmdbSortBy = row.dataset.tmdbSortBy || 'popularity.desc';
  }
  if (entry.provider === 'addon') {
    entry.sourceUrl   = row.dataset.sourceUrl   || '';
    entry.catalogId   = row.dataset.catalogId   || '';
    entry.catalogType = row.dataset.catalogType || entry.mediaType || 'movie';
  }
  
  const rpdbKey = document.getElementById('rpdb-key')?.value?.trim() || null;
  const traktClientId = document.getElementById('trakt-client-id')?.value?.trim() || null;
  const catalogLang = document.getElementById('catalog-lang')?.value || null;
  const tmdbApiKey = document.getElementById('tmdb-api-key')?.value?.trim() || null;
  
  try {
    const resp = await fetch('/api/catalog/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry, rpdbKey, traktClientId, catalogLang, tmdbApiKey })
    });
    const result = await resp.json();
    
    row.dataset.count = result.count || 0;
    row.dataset.valid = result.valid;
    
    if (result.valid) {
      const m = result.movies || 0, s = result.shows || 0;
      let label;
      if (m > 0 && s > 0) label = m + ' movies · ' + s + ' shows';
      else if (m > 0) label = m + ' movies';
      else if (s > 0) label = s + ' shows';
      else label = (result.count || 0) + ' items';
      countEl.textContent = label;
      row.dataset.count = result.count;
      countEl.className = 'cat-count-badge cat-count-ok';
      testBtn.textContent = '✓ OK';
      testBtn.classList.add('cat-test-ok');
      setTimeout(function() { testBtn.textContent = 'Test'; testBtn.disabled = false; testBtn.classList.remove('cat-test-ok'); }, 3000);
    } else {
      countEl.textContent = result.message || 'Failed';
      countEl.className = 'cat-count-badge cat-count-error';
      testBtn.textContent = 'Test';
      testBtn.disabled = false;
    }
  } catch (err) {
    countEl.textContent = 'Error';
    countEl.className = 'cat-count-badge cat-count-error';
    testBtn.textContent = 'Test';
    testBtn.disabled = false;
    console.error('Catalog test error:', err);
  }
}


function applyAllNetworks() {
  var cats = TOP_STREAMING.mainPlatforms.map(function(key) {
    var p = STREAMING_PRESETS[key];
    if (!p || !p.catalogs || !p.catalogs.length) return null;
    return p.catalogs.find(function(c) { return c.mediaType === 'movie'; }) || p.catalogs[0];
  }).filter(Boolean);
  addCatalogEntries(cats);
}

function addExternalCatalog(cat, opts) {
  opts = opts || {};
  if (!cat) {
    const provider  = document.getElementById('cat-provider').value;
    if (!provider) { alert('Select a provider first.'); return; }
    const listType  = provider === 'trakt' ? document.getElementById('cat-trakt-list').value : '';
    const listUrl = (provider === 'mdblist' || provider === 'imdb' || provider === 'letterboxd')
      ? (document.getElementById('cat-list-url').value || '').trim() : '';
    const mediaType = document.getElementById('cat-media-type').value;
    const name      = (document.getElementById('cat-name').value || '').trim() || (provider + ' catalog');
    if ((provider === 'mdblist' || provider === 'imdb' || provider === 'letterboxd') && !listUrl) {
      alert('Paste the list URL first.'); return;
    }
    const apiKey = provider === 'mdblist' ? (document.getElementById('mdblist-api-key') ? document.getElementById('mdblist-api-key').value.trim() : '') : '';
    if (provider === 'tmdb') {
      const tmdbMode          = (document.querySelector('.tmdb-mode-btn.active')||{}).dataset.mode || 'charts';
      const tmdbChart         = (document.getElementById('cat-tmdb-chart')||{}).value || 'trending-week';
      const tmdbGenre         = (document.getElementById('cat-tmdb-genre')||{}).value || '';
      const tmdbWatchProvider = (document.getElementById('cat-tmdb-watch-provider')||{}).value || '';
      const rawRating         = (document.getElementById('cat-tmdb-min-rating')||{}).value || '';
      const rawYearF          = (document.getElementById('cat-tmdb-year-from')||{}).value || '';
      const rawYearT          = (document.getElementById('cat-tmdb-year-to')||{}).value || '';
      const tmdbSortBy        = (document.getElementById('cat-tmdb-sort-by')||{}).value || 'popularity.desc';
      cat = { provider, mediaType, name, tmdbMode, tmdbChart, tmdbGenre, tmdbWatchProvider, tmdbSortBy,
        tmdbMinRating: rawRating ? Number(rawRating) : null,
        tmdbYearFrom:  rawYearF  ? Number(rawYearF)  : null,
        tmdbYearTo:    rawYearT  ? Number(rawYearT)  : null };
      // Reset discover inputs
      var dFlds = document.getElementById('cat-tmdb-discover-fields');
      if (dFlds) dFlds.querySelectorAll('input').forEach(function(i){ i.value=''; });
    } else {
      cat = { provider, listType, listUrl, mediaType, name, apiKey };
    }
    document.getElementById('cat-provider').value  = '';
    document.getElementById('cat-list-url').value  = '';
    document.getElementById('cat-name').value      = '';
    document.getElementById('cat-trakt-list').style.display = 'none';
    document.getElementById('cat-list-url').style.display   = 'none';
    var tmdbFldR = document.getElementById('cat-tmdb-fields');
    if (tmdbFldR) tmdbFldR.style.display = 'none';
    var mtR = document.getElementById('cat-media-type');
    if (mtR) mtR.disabled = false;
    if (window.Controls) Controls.syncAll();  // clear stale provider-tile/segment highlight after reset
  }
  if (cat.provider === 'mdblist' && !cat.apiKey) {
    const keyEl = document.getElementById('mdblist-api-key');
    cat.apiKey = keyEl ? keyEl.value.trim() : '';
  }
  const id  = nextCatId++;
  const row = renderCatalogRow(cat, id);
  document.getElementById('catalog-list').appendChild(row);
  initDragRow(row);
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
  if (opts.autoTest !== false && !cat.count && cat.enabled !== false) testCatalog(id);
}

function removeCatalog(id) {
  const el = document.getElementById('cat-row-' + id);
  if (el) el.remove();
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
}

function clearAllCatalogs() {
  var list = document.getElementById('catalog-list');
  if (!list || !list.children.length) return;
  if (!confirm('Remove all ' + list.children.length + ' catalog rows?')) return;
  list.innerHTML = '';
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
}

function collectExternalCatalogs() {
  const cats = [];
  document.querySelectorAll('.catalog-row').forEach(function(row) {
    var cb = row.querySelector('.cat-enabled-cb');
    var catEntry = { provider: row.dataset.provider||'', listType: row.dataset.listType||'',
      listUrl: row.dataset.listUrl||'', mediaType: row.dataset.mediaType||'movie',
      name: row.dataset.name||'', apiKey: row.dataset.apiKey||'',
      enabled: cb ? cb.checked : true, shuffle: row.dataset.shuffle === 'true' };
    if (catEntry.provider === 'tmdb') {
      catEntry.tmdbMode          = row.dataset.tmdbMode          || 'charts';
      catEntry.tmdbChart         = row.dataset.tmdbChart         || '';
      catEntry.tmdbGenre         = row.dataset.tmdbGenre         || '';
      catEntry.tmdbWatchProvider = row.dataset.tmdbWatchProvider || '';
      if (row.dataset.tmdbMinRating) catEntry.tmdbMinRating = Number(row.dataset.tmdbMinRating);
      if (row.dataset.tmdbYearFrom)  catEntry.tmdbYearFrom  = Number(row.dataset.tmdbYearFrom);
      if (row.dataset.tmdbYearTo)    catEntry.tmdbYearTo    = Number(row.dataset.tmdbYearTo);
      catEntry.tmdbSortBy = row.dataset.tmdbSortBy || 'popularity.desc';
    }
    if (catEntry.provider === 'addon') {
      catEntry.sourceUrl   = row.dataset.sourceUrl   || '';
      catEntry.catalogId   = row.dataset.catalogId   || '';
      catEntry.catalogType = row.dataset.catalogType || catEntry.mediaType;
    }
    cats.push(catEntry);
  });
  return cats;
}

let _dragSrc = null;
function initDragRow(row) {
  row.addEventListener('dragstart', function(e) { _dragSrc = row; e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
  row.addEventListener('dragend', function() { row.classList.remove('dragging'); document.querySelectorAll('.catalog-row').forEach(function(r){ r.classList.remove('drag-over'); }); if (window.autoSave) window.autoSave(); });
  row.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (_dragSrc && _dragSrc !== row) { document.querySelectorAll('.catalog-row').forEach(function(r){ r.classList.remove('drag-over'); }); row.classList.add('drag-over'); } });
  row.addEventListener('drop', function(e) { e.preventDefault(); if (_dragSrc && _dragSrc !== row) { const list = document.getElementById('catalog-list'); const all = Array.from(list.querySelectorAll('.catalog-row')); if (all.indexOf(_dragSrc) < all.indexOf(row)) list.insertBefore(_dragSrc, row.nextSibling); else list.insertBefore(_dragSrc, row); } row.classList.remove('drag-over'); });
}



// == Addon Catalog Importer ==
async function browseAddonCatalogs() {
  const url = (document.getElementById('addon-import-url').value || '').trim();
  const box = document.getElementById('addon-import-results');
  if (!url) { box.innerHTML = '<div class="profile-status error">Paste a manifest URL first.</div>'; return; }
  box.innerHTML = '<div class="profile-status info">Loading…</div>';
  try {
    const r = await fetch('/api/addon-catalogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: url }) });
    const data = await r.json();
    if (!r.ok || data.error) { box.innerHTML = '<div class="profile-status error">' + escHtml(data.error || 'Failed') + '</div>'; return; }
    window._addonImport = { baseUrl: data.baseUrl, catalogs: data.catalogs };
    let html = '<div class="profile-status info">' + escHtml(data.name) + ' ' + escHtml(data.version) + ' — ' + data.catalogs.length + ' catalogs</div>';
    html += '<label style="display:block;margin:6px 0;font-size:.78rem"><input type="checkbox" id="addon-sel-all" onchange="document.querySelectorAll(&quot;.addon-imp-cb&quot;).forEach(function(c){c.checked=document.getElementById(&quot;addon-sel-all&quot;).checked;})"> Select all</label>';
    data.catalogs.forEach(function(c, i) {
      html += '<label class="preset-preview-item"><input type="checkbox" class="addon-imp-cb" data-idx="' + i + '" checked> '
            + escHtml(c.name) + ' <span class="cat-provider-badge">' + (c.type === 'series' ? 'Shows' : 'Movies') + '</span></label>';
    });
    html += '<button class="btn-add-catalog" style="margin-top:8px" onclick="addImportedAddonCatalogs()">+ Add selected</button>';
    box.innerHTML = html;
  } catch (e) { box.innerHTML = '<div class="profile-status error">' + escHtml(e.message) + '</div>'; }
}

function addImportedAddonCatalogs() {
  const imp = window._addonImport; if (!imp) return;
  let added = 0;
  document.querySelectorAll('.addon-imp-cb:checked').forEach(function(cb) {
    const c = imp.catalogs[Number(cb.dataset.idx)];
    if (!c) return;
    const entry = { provider: 'addon', sourceUrl: imp.baseUrl, catalogId: c.id, catalogType: c.type, mediaType: c.type, name: c.name };
    if (catalogRowExists(entry)) return;   // skip already-added catalogs
    addExternalCatalog(entry);
    added++;
  });
  const box = document.getElementById('addon-import-results');
  if (box) box.innerHTML = '<div class="profile-status success">Added ' + added + ' catalog row(s).</div>';
}

// == MDbList User Browser ==
async function browseMdblistUser() {
  var username = (document.getElementById('mdblist-browse-user') || {}).value.trim();
  var apiKey = (document.getElementById('mdblist-api-key') || {}).value.trim();
  var resultsEl = document.getElementById('mdblist-browse-results');
  if (!username) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter a username.</div>'; return; }
  if (!apiKey) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Add your MDbList key in Step 1 (Connect) first.</div>'; return; }
  resultsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">Loading lists...</div>';
  try {
    var resp = await fetch('/api/catalogs/browse-mdblist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, apiKey: apiKey }),
    });
    var data = await resp.json().catch(function() { return {}; });
    if (!resp.ok || data.error) throw new Error(data.error || 'API returned ' + resp.status);
    var lists = data.lists || [];
    if (!Array.isArray(lists) || !lists.length) { resultsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">No public lists found for this user.</div>'; return; }
    var h = '<div class="mdblist-browse-grid">';
    lists.forEach(function(l, i) {
      h += '<label class="mdblist-browse-item"><input type="checkbox" class="mdblist-browse-cb" data-idx="' + i + '" />'
        + '<span class="mdblist-browse-name">' + escHtml(l.name) + '</span>'
        + '<span class="mdblist-browse-count">' + (l.items || 0) + ' items</span></label>';
    });
    h += '</div><div class="mdblist-browse-actions">'
      + '<select id="mdblist-browse-media"><option value="movie">Movies</option><option value="series">Shows</option><option value="both">Both</option></select>'
      + '<button class="btn-add-catalog" onclick="addMdblistBrowseSelection()">+ Add Selected</button></div>';
    resultsEl.innerHTML = h;
    resultsEl._lists = lists;
    resultsEl._username = username;
  } catch (err) {
    resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">' + escHtml(err.message) + '</div>';
  }
}

function addMdblistBrowseSelection() {
  var resultsEl = document.getElementById('mdblist-browse-results');
  var lists = resultsEl._lists || [];
  var username = resultsEl._username || '';
  var mediaType = (document.getElementById('mdblist-browse-media') || {}).value || 'movie';
  var mdbKey = (document.getElementById('mdblist-api-key') || {}).value.trim();
  var cbs = document.querySelectorAll('.mdblist-browse-cb:checked');
  var added = 0, skipped = 0;
  cbs.forEach(function(cb) {
    var l = lists[parseInt(cb.dataset.idx, 10)];
    if (!l) return;
    var listUrl = 'https://mdblist.com/lists/' + encodeURIComponent(username) + '/' + encodeURIComponent(l.slug);
    var catObj = { provider: 'mdblist', listType: '', listUrl: listUrl, mediaType: mediaType, name: l.name, apiKey: mdbKey, enabled: true };
    if (catalogRowExists(catObj)) { skipped++; return; }
    addExternalCatalog(catObj);
    added++;
  });
  if (added || skipped) {
    var msg = added + ' added'; if (skipped) msg += ', ' + skipped + ' duplicate(s) skipped';
    var ind = document.getElementById('autosave-indicator'); if (ind) { ind.textContent = msg; ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); }
  }
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
}

// == Trakt User Lists ==
async function browseTraktUser() {
  var input = (document.getElementById('trakt-browse-user') || {}).value.trim();
  var clientId = (document.getElementById('trakt-client-id') || {}).value.trim();
  var resultsEl = document.getElementById('trakt-browse-results');
  if (!clientId) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Add your Trakt Client ID in Step 1 (Connect) first.</div>'; return; }
  var username = input.replace(/^https?:\/\/trakt\.tv\/users\//, '').replace(/\/.*$/, '').trim();
  if (!username) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter a Trakt username or profile URL.</div>'; return; }
  resultsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">Loading lists...</div>';
  try {
    var resp = await fetch('/api/catalogs/browse-trakt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, traktClientId: clientId }),
    });
    var data = await resp.json().catch(function() { return {}; });
    if (!resp.ok || data.error) throw new Error(data.error || 'Trakt API returned ' + resp.status);
    var lists = data.lists || [];
    var allLists = [{ name: 'Watchlist', slug: 'watchlist', item_count: '?', _isWatchlist: true }].concat(lists);
    var h = '<div class="mdblist-browse-grid">';
    allLists.forEach(function(l, i) {
      h += '<label class="mdblist-browse-item"><input type="checkbox" class="trakt-browse-cb" data-idx="' + i + '" />'
        + '<span class="mdblist-browse-name">' + escHtml(l.name) + '</span>'
        + '<span class="mdblist-browse-count">' + (l.item_count || '?') + ' items</span></label>';
    });
    h += '</div><div class="mdblist-browse-actions">'
      + '<select id="trakt-browse-media"><option value="movie">Movies</option><option value="series">Shows</option><option value="both">Both</option></select>'
      + '<button class="btn-add-catalog" onclick="addTraktBrowseSelection()">+ Add Selected</button></div>';
    resultsEl.innerHTML = h;
    resultsEl._lists = allLists;
    resultsEl._username = username;
  } catch (err) {
    resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">' + escHtml(err.message) + '</div>';
  }
}

function addTraktBrowseSelection() {
  var resultsEl = document.getElementById('trakt-browse-results');
  var lists = resultsEl._lists || [];
  var username = resultsEl._username || '';
  var mediaType = (document.getElementById('trakt-browse-media') || {}).value || 'movie';
  var cbs = document.querySelectorAll('.trakt-browse-cb:checked');
  var added = 0, skipped = 0;
  cbs.forEach(function(cb) {
    var l = lists[parseInt(cb.dataset.idx, 10)];
    if (!l) return;
    var catObj = { provider: 'trakt', listType: 'user:' + username + ':' + l.slug, listUrl: '',
      mediaType: mediaType, name: l.name + ' (' + username + ')', apiKey: '', enabled: true };
    if (catalogRowExists(catObj)) { skipped++; return; }
    addExternalCatalog(catObj);
    added++;
  });
  if (added || skipped) {
    var msg = added + ' added'; if (skipped) msg += ', ' + skipped + ' duplicate(s) skipped';
    var ind = document.getElementById('autosave-indicator'); if (ind) { ind.textContent = msg; ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); }
  }
  if (window.autoSave) window.autoSave();
  if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
}
  function parseStepFromHash() {
    const hash = location.hash || '';
    const q = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?') + 1) : '';
    const qs = new URLSearchParams(q);
    const step = qs.get('step');
    if (step && WIZARD_STEPS.includes(step)) return step;
    try {
      const saved = sessionStorage.getItem('meb-catalog-step');
      if (saved && WIZARD_STEPS.includes(saved)) return saved;
    } catch {}
    return 'connect';
  }

  function updateProgress() {
    const idx = WIZARD_STEPS.indexOf(_currentStep);
    const pct = Math.round(((idx + 1) / WIZARD_STEPS.length) * 100);
    const pctEl = document.getElementById('cw-progress-pct');
    const fill = document.getElementById('cw-progress-fill');
    const rail = document.getElementById('cw-step-rail-fill');
    if (pctEl) pctEl.textContent = pct + '%';
    if (fill) fill.style.strokeDashoffset = String(PROGRESS_RING - (PROGRESS_RING * pct / 100));
    if (rail) rail.style.width = (idx / (WIZARD_STEPS.length - 1) * 100) + '%';
    const hint = document.getElementById('cw-nav-hint');
    if (hint) hint.textContent = NAV_HINTS[_currentStep] || '';
  }

  function goToStep(step) {
    if (!WIZARD_STEPS.includes(step)) step = 'connect';
    _currentStep = step;
    try { sessionStorage.setItem('meb-catalog-step', step); } catch {}
    document.querySelectorAll('.cw-step-btn').forEach(btn => {
      const s = btn.dataset.step;
      btn.classList.toggle('active', s === step);
      btn.classList.toggle('done', WIZARD_STEPS.indexOf(s) < WIZARD_STEPS.indexOf(step));
    });
    document.querySelectorAll('.cw-panel').forEach(p => {
      const on = p.dataset.step === step;
      p.classList.toggle('on', on);
      if (on) {
        p.classList.remove('cw-panel-enter');
        void p.offsetWidth;
        p.classList.add('cw-panel-enter');
      }
    });
    const back = document.getElementById('cw-nav-back');
    const next = document.getElementById('cw-nav-next');
    if (back) back.style.visibility = step === 'connect' ? 'hidden' : 'visible';
    if (next) next.textContent = step === 'review' ? 'Save to Stremio' : 'Continue →';
    updateProgress();
    if (step === 'review') updateReviewUI();
    if (step === 'discover') renderGallery();
  }

  function renderGallery() {
    const gal = document.getElementById('cw-gallery');
    if (!gal) return;
    gal.innerHTML = '';
    GALLERY_KEYS.forEach(k => {
      const cat = PRESET_CATS[k] || 'all';
      if (_galleryCat !== 'all' && cat !== _galleryCat) return;
      const p = STREAMING_PRESETS[k];
      if (!p || !p.catalogs || !p.catalogs.length) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cw-svc-card';
      btn.dataset.key = k;
      btn.style.background = 'linear-gradient(145deg, ' + p.color + ', color-mix(in srgb, ' + p.color + ' 55%, #000))';
      btn.innerHTML = '<span class="cw-svc-count">' + p.catalogs.length + '</span>'
        + '<div class="cw-svc-letter">' + escHtml(p.letter) + '</div>'
        + '<div class="cw-svc-label">' + escHtml(p.label) + '</div>';
      btn.title = 'Click to choose rows · double-click to add both instantly';
      btn.addEventListener('click', () => selectPreset(k));
      btn.addEventListener('dblclick', function(e) {
        e.preventDefault();
        selectPreset(k);
        presetQuickSelect('both');
        applyPreset();
      });
      gal.appendChild(btn);
    });
  }

  function bindCategoryTabs() {
    document.querySelectorAll('.cw-cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        _galleryCat = tab.dataset.cat || 'all';
        document.querySelectorAll('.cw-cat-tab').forEach(t => t.classList.toggle('active', t === tab));
        renderGallery();
      });
    });
  }

  function updateChartsHeroMeta() {
    const countEl = document.getElementById('cw-charts-platform-count');
    if (countEl) countEl.textContent = String(GALLERY_KEYS.length);
  }

  function bindKeyCards() {
    document.querySelectorAll('.cw-key-card').forEach(card => {
      const h = card.querySelector('.cw-key-card-h');
      if (h) h.addEventListener('click', () => {
        const opening = !card.classList.contains('open');
        document.querySelectorAll('.cw-key-card.open').forEach(c => { if (c !== card) c.classList.remove('open'); });
        card.classList.toggle('open', opening);
      });
    });
    [['trakt-client-id','trakt'],['tmdb-api-key','tmdb'],['mdblist-api-key','mdblist'],['rpdb-key','rpdb']].forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => { _keyTested[key] = null; refreshKeyPills(); if (window.autoSave) window.autoSave(); });
    });
    document.querySelectorAll('[data-test-key]').forEach(btn => {
      btn.addEventListener('click', () => testProviderKey(btn.dataset.testKey));
    });
  }

  async function testProviderKey(provider) {
    const probes = {
      trakt: { entry: { provider: 'trakt', listType: 'trending', mediaType: 'movie', name: 'Test' }, keyId: 'trakt-client-id', field: 'traktClientId' },
      tmdb: { entry: { provider: 'tmdb', tmdbMode: 'charts', tmdbChart: 'trending-week', mediaType: 'movie', name: 'Test' }, keyId: 'tmdb-api-key', field: 'tmdbApiKey' },
      mdblist: { entry: { provider: 'mdblist', listUrl: 'https://mdblist.com/lists/noveggies/imdb-toprated-250', mediaType: 'movie', name: 'Test', apiKey: '' }, keyId: 'mdblist-api-key', field: 'mdblistApiKey', useRowKey: true },
      rpdb: null,
    };
    const p = probes[provider];
    if (!p) { _keyTested.rpdb = !!document.getElementById('rpdb-key')?.value.trim(); refreshKeyPills(); return; }
    const body = { entry: { ...p.entry }, rpdbKey: document.getElementById('rpdb-key')?.value?.trim() || null, catalogLang: null };
    if (p.useRowKey) body.entry.apiKey = document.getElementById(p.keyId)?.value?.trim() || '';
    else body[p.field] = document.getElementById(p.keyId)?.value?.trim() || null;
    try {
      const r = await fetch('/api/catalog/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      _keyTested[provider] = !!data.valid;
    } catch { _keyTested[provider] = false; }
    refreshKeyPills();
  }

  function refreshKeyPills() {
    const map = [
      ['trakt-client-id', 'trakt', 'cw-pill-trakt'],
      ['tmdb-api-key', 'tmdb', 'cw-pill-tmdb'],
      ['mdblist-api-key', 'mdblist', 'cw-pill-mdblist'],
      ['rpdb-key', 'rpdb', 'cw-pill-rpdb'],
    ];
    map.forEach(([inpId, key, pillId]) => {
      const i = document.getElementById(inpId);
      const p = document.getElementById(pillId);
      if (!i || !p) return;
      const v = i.value.trim();
      let cls = 'unset', txt = 'Not set';
      if (v) {
        if (_keyTested[key] === true) { cls = 'ok'; txt = 'Connected'; }
        else if (_keyTested[key] === false) { cls = 'bad'; txt = 'Invalid'; }
        else { cls = 'set'; txt = 'Added'; }
      }
      p.className = 'cw-key-pill ' + cls;
      p.textContent = txt;
      const card = document.querySelector('.cw-key-card[data-provider="' + key + '"]');
      if (card) {
        card.classList.toggle('cw-key-linked', !!v);
        card.classList.toggle('cw-key-verified', _keyTested[key] === true);
        card.classList.toggle('cw-key-invalid', _keyTested[key] === false);
      }
    });
  }

  function toggleCatalogOptions() {
    const show = document.getElementById('show-catalog')?.checked ?? true;
    const opts = document.getElementById('catalog-options');
    if (opts) opts.style.display = show ? '' : 'none';
  }

  function syncLibChips() {
    document.querySelectorAll('.cw-lib-tile, .cw-lib-chip').forEach(chip => {
      const inp = chip.querySelector('input[type="checkbox"]');
      if (inp) chip.classList.toggle('on', inp.checked);
    });
  }

  const LIB_NAMES = { recent: 'Recently Added', resume: 'Continue Watching', nextup: 'Next Up', favorites: 'Favorites' };
  const LIB_TV = {
    recent: { icon: '✨', hint: 'From your servers', variant: 'library' },
    resume: { icon: '▶', hint: 'In progress', variant: 'resume', progress: [72, 45, 88, 33, 61] },
    nextup: { icon: '⏭', hint: 'Next episode', variant: 'library' },
    favorites: { icon: '★', hint: 'Starred titles', variant: 'favorites' },
  };
  const PROVIDER_HUES = { library: 215, trakt: 0, tmdb: 195, mdblist: 248, imdb: 45, letterboxd: 130, addon: 265 };
  const PROVIDER_LABELS = { library: 'Library', trakt: 'Trakt', tmdb: 'TMDB', mdblist: 'MDB', imdb: 'IMDb', letterboxd: 'LB', addon: 'Charts' };
  const MOCK_TITLES = {
    library: ['Fresh Cut', 'Last Light', 'Northbound', 'Glass House', 'Afterglow'],
    resume: ['Episode 4', 'S2 E7', 'Part II', 'Ch. 12', 'Finale'],
    favorites: ['Saved One', 'Starred', 'Pinned', 'Loved', 'Top Pick'],
    chart: ['#1 Hit', 'Rising', 'Trending', 'Hot Now', 'Chart Top'],
    catalog: ['Pick One', 'Featured', 'Curated', 'Spotlight', 'Fresh'],
  };
  let _lastRowTotal = -1;

  function mockTitleFor(row, rowIndex, posterIndex) {
    const pool = MOCK_TITLES[row.variant] || MOCK_TITLES.catalog;
    return pool[(rowIndex * 3 + posterIndex) % pool.length];
  }

  function chartAccentForCatalog(r) {
    const match = TOP_STREAMING_MANIFEST_CATALOGS.find(function(c) { return c.id === r.catalogId; });
    if (!match) return null;
    const preset = STREAMING_PRESETS[match.group];
    return preset ? preset.color : null;
  }

  function buildTvPoster(row, index, posterIndex) {
    var p = document.createElement('div');
    p.className = 'cw-tv-poster';
    p.style.setProperty('--ph', String((row.hue + posterIndex * 22) % 360));
    if (row.variant === 'chart') p.classList.add('cw-tv-poster-chart');
    if (row.variant === 'resume') p.classList.add('cw-tv-poster-resume');
    if (row.variant === 'favorites') p.classList.add('cw-tv-poster-fav');
    var shine = document.createElement('span');
    shine.className = 'cw-tv-poster-shine';
    p.appendChild(shine);
    if (row.variant === 'chart') {
      var rank = document.createElement('span');
      rank.className = 'cw-tv-poster-rank';
      rank.textContent = String(posterIndex + 1);
      p.appendChild(rank);
    }
    if (row.variant === 'favorites') {
      var star = document.createElement('span');
      star.className = 'cw-tv-poster-star';
      star.textContent = '★';
      p.appendChild(star);
    }
    if (row.variant === 'resume' && row.progress && row.progress[posterIndex] != null) {
      var track = document.createElement('span');
      track.className = 'cw-tv-poster-progress';
      var fill = document.createElement('span');
      fill.className = 'cw-tv-poster-progress-fill';
      fill.style.width = row.progress[posterIndex] + '%';
      track.appendChild(fill);
      p.appendChild(track);
    }
    var cap = document.createElement('span');
    cap.className = 'cw-tv-poster-cap';
    cap.textContent = mockTitleFor(row, index, posterIndex);
    p.appendChild(cap);
    return p;
  }

  function pulseRowCount() {
    const stat = document.getElementById('cw-review-stat');
    if (!stat) return;
    stat.classList.remove('cw-stat-pop');
    void stat.offsetWidth;
    stat.classList.add('cw-stat-pop');
  }

  function updateTvPreview() {
    const rows = collectExternalCatalogs();
    const enabled = rows.filter(r => r.enabled !== false);
    const previewRows = [];
    if (document.getElementById('show-catalog')?.checked) {
      ['recent','resume','nextup','favorites'].forEach(k => {
        const chk = document.getElementById('libchk-' + k);
        const meta = LIB_TV[k] || {};
        if (chk && chk.checked) {
          const libHue = { recent: 215, resume: 28, nextup: 165, favorites: 42 }[k] || PROVIDER_HUES.library;
          previewRows.push({
            title: LIB_NAMES[k] || k,
            kind: 'library',
            hue: libHue,
            accent: k === 'favorites' ? '#f5c842' : (k === 'resume' ? '#ff8c42' : '#3b9dff'),
            icon: meta.icon || '◆',
            hint: meta.hint || 'Your library',
            variant: meta.variant || 'library',
            progress: meta.progress,
            libKey: k,
          });
        }
      });
    }
    enabled.forEach(r => {
      const isChart = r.provider === 'addon';
      const accent = isChart ? chartAccentForCatalog(r) : null;
      previewRows.push({
        title: r.name || r.provider,
        kind: r.provider || 'addon',
        hue: PROVIDER_HUES[r.provider] != null ? PROVIDER_HUES[r.provider] : 265,
        accent: accent,
        icon: isChart ? '10' : '◆',
        hint: isChart ? 'Top 10 · refreshes automatically' : (PROVIDER_LABELS[r.provider] || 'Catalog'),
        variant: isChart ? 'chart' : 'catalog',
        pill: isChart ? 'Charts' : (PROVIDER_LABELS[r.provider] || null),
      });
    });
    const empty = document.getElementById('cw-tv-empty');
    const wrap = document.querySelector('.cw-tv-rows-wrap');
    const container = document.getElementById('cw-tv-rows');
    const live = document.getElementById('cw-tv-live');
    const status = document.getElementById('cw-tv-status');
    const statusN = document.getElementById('cw-tv-row-total');
    if (!container) return;
    if (!previewRows.length) {
      if (empty) empty.style.display = '';
      if (wrap) wrap.hidden = true;
      if (live) live.classList.remove('on');
      if (status) status.hidden = true;
      container.classList.remove('on');
      container.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (wrap) wrap.hidden = false;
    if (live) live.classList.add('on');
    if (status) { status.hidden = false; if (statusN) statusN.textContent = String(previewRows.length); }
    container.classList.add('on');
    container.innerHTML = '';
    previewRows.slice(0, 10).forEach((row, ri) => {
      const el = document.createElement('div');
      el.className = 'cw-tv-row cw-tv-row-' + (row.variant || 'catalog');
      el.style.animationDelay = (ri * 0.04) + 's';
      const head = document.createElement('div');
      head.className = 'cw-tv-row-head';
      const icon = document.createElement('span');
      icon.className = 'cw-tv-row-icon';
      icon.textContent = row.icon || '◆';
      const textWrap = document.createElement('div');
      textWrap.className = 'cw-tv-row-text';
      const h = document.createElement('div');
      h.className = 'cw-tv-row-title';
      h.textContent = row.title;
      const meta = document.createElement('div');
      meta.className = 'cw-tv-row-meta';
      meta.textContent = row.hint || '';
      textWrap.appendChild(h);
      if (row.hint) textWrap.appendChild(meta);
      head.appendChild(icon);
      head.appendChild(textWrap);
      if (row.accent) {
        el.style.setProperty('--row-accent', row.accent);
        icon.style.setProperty('--row-accent', row.accent);
      }
      if (row.kind === 'library') {
        const pill = document.createElement('span');
        pill.className = 'cw-tv-row-pill cw-tv-row-pill-library';
        pill.textContent = 'Library';
        head.appendChild(pill);
      } else if (row.pill) {
        const pill = document.createElement('span');
        pill.className = 'cw-tv-row-pill' + (row.variant === 'chart' ? ' cw-tv-row-pill-chart' : '');
        pill.textContent = row.pill;
        head.appendChild(pill);
      }
      const posters = document.createElement('div');
      posters.className = 'cw-tv-posters';
      for (let i = 0; i < 5; i++) posters.appendChild(buildTvPoster(row, ri, i));
      el.appendChild(head);
      el.appendChild(posters);
      container.appendChild(el);
    });
  }

  function updateReviewUI() {
    const rows = collectExternalCatalogs();
    const enabled = rows.filter(r => r.enabled !== false);
    let libCount = 0;
    if (document.getElementById('show-catalog')?.checked) {
      ['recent','resume','nextup','favorites'].forEach(k => {
        if (document.getElementById('libchk-' + k)?.checked) libCount++;
      });
    }
    const total = enabled.length + libCount;
    const nEl = document.getElementById('cw-row-count-n');
    const el = document.getElementById('cw-row-count');
    const legacy = document.getElementById('catalog-count');
    if (nEl) nEl.textContent = String(total);
    if (total !== _lastRowTotal) {
      _lastRowTotal = total;
      pulseRowCount();
    }
    const txt = total ? 'Drag rows below to change order on your TV' : 'Add rows in Discover or enable library tiles';
    if (el) el.textContent = txt;
    if (legacy) legacy.textContent = total + ' row' + (total === 1 ? '' : 's');
    updateTvPreview();
  }

  function bindWizardNav() {
    document.querySelectorAll('.cw-step-btn').forEach(btn => {
      btn.addEventListener('click', () => goToStep(btn.dataset.step));
    });
    document.getElementById('cw-nav-back')?.addEventListener('click', () => {
      const i = WIZARD_STEPS.indexOf(_currentStep);
      if (i > 0) goToStep(WIZARD_STEPS[i - 1]);
    });
    document.getElementById('cw-nav-next')?.addEventListener('click', () => {
      if (_currentStep === 'review') {
        if (window.autoSave) window.autoSave();
        if (window.scheduleAccountConfigSync) window.scheduleAccountConfigSync();
        if (window.generateLinks) window.generateLinks({ silent: true }).catch(() => {});
        const ind = document.getElementById('autosave-indicator');
        if (ind) { ind.textContent = 'Saved to Stremio'; ind.classList.add('visible'); }
        return;
      }
      const i = WIZARD_STEPS.indexOf(_currentStep);
      if (i < WIZARD_STEPS.length - 1) goToStep(WIZARD_STEPS[i + 1]);
    });
    document.getElementById('cw-expert-toggle')?.addEventListener('click', () => {
      const ex = document.getElementById('cw-expert');
      const btn = document.getElementById('cw-expert-toggle');
      const on = ex && !ex.classList.contains('on');
      if (ex) ex.classList.toggle('on', on);
      if (btn) btn.classList.toggle('on', on);
    });
    document.querySelectorAll('.cw-lib-tile, .cw-lib-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const inp = chip.querySelector('input');
        if (inp) {
          inp.checked = !inp.checked;
          chip.classList.toggle('on', inp.checked);
          updateReviewUI();
          if (window.autoSave) window.autoSave();
        }
      });
    });
    document.getElementById('cw-preset-close')?.addEventListener('click', closePresetSheet);
    document.getElementById('cw-preset-cancel')?.addEventListener('click', closePresetSheet);
    document.getElementById('cw-preset-backdrop')?.addEventListener('click', closePresetSheet);
    document.querySelectorAll('.cw-preset-quick-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { presetQuickSelect(btn.dataset.quick); });
    });
    const showCat = document.getElementById('show-catalog');
    if (showCat) showCat.addEventListener('change', () => {
      toggleCatalogOptions();
      updateReviewUI();
      if (window.autoSave) window.autoSave();
    });
  }

  function init() {
    try { initPresets(); } catch {}
    bindKeyCards();
    bindWizardNav();
    bindCategoryTabs();
    updateChartsHeroMeta();
    renderGallery();
    goToStep(parseStepFromHash());
    toggleCatalogOptions();
    syncLibChips();
    refreshKeyPills();
    updateReviewUI();
    updateProgress();
    if (window.Controls) window.Controls.syncAll();
    document.querySelectorAll('.cw-panel.on').forEach(p => p.classList.add('cw-panel-enter'));
  }

  function onPageShow(name) {
    if (name !== 'catalogs') return;
    goToStep(parseStepFromHash());
    toggleCatalogOptions();
    syncLibChips();
    refreshKeyPills();
    updateReviewUI();
    updateProgress();
  }

  // Globals for configure.js + inline handlers
  window.addExternalCatalog = addExternalCatalog;
  window.removeCatalog = removeCatalog;
  window.clearAllCatalogs = clearAllCatalogs;
  window.collectExternalCatalogs = collectExternalCatalogs;
  window.testCatalog = testCatalog;
  window.toggleCatalogOptions = toggleCatalogOptions;
  window.refreshKeyPills = refreshKeyPills;
  window.initPresets = initPresets;
  window.browseMdblistUser = browseMdblistUser;
  window.browseTraktUser = browseTraktUser;
  window.browseAddonCatalogs = browseAddonCatalogs;
  window.addImportedAddonCatalogs = addImportedAddonCatalogs;
  window.addMdblistBrowseSelection = addMdblistBrowseSelection;
  window.addTraktBrowseSelection = addTraktBrowseSelection;
  window.applyPreset = applyPreset;
  window.applyAllNetworks = applyAllNetworks;
  window.onCatalogProviderChange = onCatalogProviderChange;
  window.setTmdbMode = setTmdbMode;
  window.onTmdbChartChange = onTmdbChartChange;
  window.onCatalogUrlInput = onCatalogUrlInput;
  window.updateTmdbAutoName = updateTmdbAutoName;
  window.selectPreset = selectPreset;
  window.closePresetSheet = closePresetSheet;
  window.presetQuickSelect = presetQuickSelect;
  window.installTopStreamingAll = installTopStreamingAll;
  window.installTopStreamingMain = installTopStreamingMain;
  window.TOP_STREAMING = TOP_STREAMING;
  window.STREAMING_PRESETS = STREAMING_PRESETS;
  window.CatalogsWizard = { init, onPageShow, goToStep, renderGallery, updateReviewUI, updateTvPreview, syncLibChips, toggleCatalogOptions, updateProgress };

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('catalogs')) goToStep(parseStepFromHash());
  });
})();
