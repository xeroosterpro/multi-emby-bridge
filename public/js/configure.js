// ── State ─────────────────────────────────────────────────────────────────
let nextId = 0;
let nextCatId = 0;

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
  try { localStorage.setItem('meb-active-tab', tabId); } catch {}
}
function restoreActiveTab() {
  try {
    const t = localStorage.getItem('meb-active-tab');
    if (t && document.getElementById(t)) switchTab(t);
  } catch {}
}

// ── Steps indicator ──────────────────────────────────────────────────────
function updateSteps() {
  const hasServers = document.querySelectorAll('.server-block').length > 0;
  const s1 = document.getElementById('step-1');
  const s2 = document.getElementById('step-2');
  const s3 = document.getElementById('step-3');
  if (!s1) return;
  s1.className = hasServers ? 'step done' : 'step active';
  s2.className = hasServers ? 'step active' : 'step';
}

// ── Panel collapse ────────────────────────────────────────────────────────
function togglePanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('collapsed');
  try {
    const states = JSON.parse(localStorage.getItem('meb-panels') || '{}');
    states[id] = el.classList.contains('collapsed');
    localStorage.setItem('meb-panels', JSON.stringify(states));
  } catch {}
}

function restorePanelStates() {
  try {
    const states = JSON.parse(localStorage.getItem('meb-panels') || '{}');
    const defaults = { 'panel-profile': true, 'panel-settings': false, 'panel-ping': true, 'panel-log': true };
    const merged = { ...defaults, ...states };
    for (const [id, collapsed] of Object.entries(merged)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('collapsed', collapsed);
    }
  } catch {}
}
restorePanelStates();

// -- External Catalogs --------------------------------------------------------
const TRAKT_LIST_NAMES = {
  'trending': 'Trending', 'popular': 'Popular',
  'watched/weekly': 'Most Watched', 'anticipated': 'Anticipated',
};

// -- Streaming Presets --
const STREAMING_PRESETS = {
  netflix: { label: "Netflix", color: "#E50914", letter: "N", catalogs: [
    { name: "Netflix Movies",          provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/netflix-movies",          mediaType: "movie"  },
    { name: "Netflix Shows",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/netflix-shows",           mediaType: "series" },
    { name: "Action Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/action",                  mediaType: "movie"  },
    { name: "Crime Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime",                   mediaType: "movie"  },
    { name: "Thriller Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",                mediaType: "movie"  },
    { name: "Drama Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",                   mediaType: "movie"  },
    { name: "Horror Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/horror",                  mediaType: "movie"  },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                  mediaType: "movie"  },
    { name: "Sci-Fi Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",                  mediaType: "movie"  },
    { name: "Drama Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",             mediaType: "series" },
    { name: "Crime Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime-shows",             mediaType: "series" },
    { name: "Comedy Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy-shows",            mediaType: "series" },
  ] },
  prime: { label: "Prime Video", color: "#00A8E1", letter: "P", catalogs: [
    { name: "Prime Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/amazon-prime-movies",     mediaType: "movie"  },
    { name: "Prime Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/amazon-prime-shows",      mediaType: "series" },
    { name: "Action Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/action",                  mediaType: "movie"  },
    { name: "Thriller Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",                mediaType: "movie"  },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                  mediaType: "movie"  },
    { name: "Sci-Fi Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",                  mediaType: "movie"  },
    { name: "Drama Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",                   mediaType: "movie"  },
    { name: "Drama Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",             mediaType: "series" },
    { name: "Crime Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime-shows",             mediaType: "series" },
    { name: "Comedy Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy-shows",            mediaType: "series" },
    { name: "Sci-Fi Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi-shows",            mediaType: "series" },
  ] },
  disney: { label: "Disney+", color: "#0063E5", letter: "D+", catalogs: [
    { name: "Disney+ Movies",          provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/disney-movies",           mediaType: "movie"  },
    { name: "Disney+ Shows",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/disney-shows",            mediaType: "series" },
    { name: "Marvel Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/marvel-cinematic-universe", mediaType: "movie"  },
    { name: "Star Wars Movies",        provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/star-wars",                 mediaType: "movie"  },
    { name: "Pixar Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/pixar-movies",              mediaType: "movie"  },
    { name: "Family Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/family",                      mediaType: "movie"  },
    { name: "Action Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/action",                  mediaType: "movie"  },
    { name: "Sci-Fi Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",                  mediaType: "movie"  },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                  mediaType: "movie"  },
  ] },
  hulu: { label: "Hulu", color: "#1CE783", letter: "H", catalogs: [
    { name: "Hulu Movies",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/hulu-movies",             mediaType: "movie"  },
    { name: "Hulu Shows",              provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/hulu-shows",              mediaType: "series" },
    { name: "Trending Movies",         provider: "trakt",   listType: "trending",                                                        mediaType: "movie"  },
    { name: "Trending Shows",          provider: "trakt",   listType: "trending",                                                        mediaType: "series" },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                  mediaType: "movie"  },
    { name: "Drama Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",                   mediaType: "movie"  },
    { name: "Horror Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/horror",                  mediaType: "movie"  },
    { name: "Thriller Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",                mediaType: "movie"  },
    { name: "Drama Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",             mediaType: "series" },
    { name: "Comedy Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy-shows",            mediaType: "series" },
    { name: "Sci-Fi Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi-shows",            mediaType: "series" },
  ] },
  max: { label: "Max", color: "#002BE7", letter: "M", catalogs: [
    { name: "HBO Shows",               provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/hbo-shows",               mediaType: "series" },
    { name: "Max Movies",              provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/hbo-movies",              mediaType: "movie"  },
    { name: "Trending Movies",         provider: "trakt",   listType: "trending",                                                        mediaType: "movie"  },
    { name: "Popular Movies",          provider: "trakt",   listType: "popular",                                                         mediaType: "movie"  },
    { name: "Drama Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",                   mediaType: "movie"  },
    { name: "Crime Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime",                   mediaType: "movie"  },
    { name: "Thriller Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",                mediaType: "movie"  },
    { name: "Horror Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/horror",                  mediaType: "movie"  },
    { name: "Sci-Fi Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",                  mediaType: "movie"  },
    { name: "Drama Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",             mediaType: "series" },
    { name: "Crime Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime-shows",             mediaType: "series" },
    { name: "Sci-Fi Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi-shows",            mediaType: "series" },
  ] },
  apple: { label: "Apple TV+", color: "#444444", letter: "\u25cf", catalogs: [
    { name: "Best New Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/new-movies",                mediaType: "movie"  },
    { name: "Best New Shows",          provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/best-new-shows",            mediaType: "series" },
    { name: "Trending Movies",         provider: "trakt",   listType: "trending",                                                        mediaType: "movie"  },
    { name: "Trending Shows",          provider: "trakt",   listType: "trending",                                                        mediaType: "series" },
    { name: "Most Anticipated Movies", provider: "trakt",   listType: "anticipated",                                                     mediaType: "movie"  },
    { name: "Most Anticipated Shows",  provider: "trakt",   listType: "anticipated",                                                     mediaType: "series" },
    { name: "Recommended Movies",      provider: "trakt",   listType: "recommended/weekly",                                             mediaType: "movie"  },
    { name: "Recommended Shows",       provider: "trakt",   listType: "recommended/weekly",                                             mediaType: "series" },
    { name: "Drama Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",                   mediaType: "movie"  },
    { name: "Thriller Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",                mediaType: "movie"  },
    { name: "Drama Shows",             provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",             mediaType: "series" },
  ] },
  trakt: { label: "Trakt Charts", color: "#ED2224", letter: "T", catalogs: [
    { name: "Trending Movies",         provider: "trakt", listType: "trending",           mediaType: "movie"  },
    { name: "Trending Shows",          provider: "trakt", listType: "trending",           mediaType: "series" },
    { name: "Popular Movies",          provider: "trakt", listType: "popular",            mediaType: "movie"  },
    { name: "Popular Shows",           provider: "trakt", listType: "popular",            mediaType: "series" },
    { name: "Box Office",              provider: "trakt", listType: "box-office",         mediaType: "movie"  },
    { name: "Most Watched Movies",     provider: "trakt", listType: "watched/weekly",     mediaType: "movie"  },
    { name: "Most Watched Shows",      provider: "trakt", listType: "watched/weekly",     mediaType: "series" },
    { name: "Most Anticipated Movies", provider: "trakt", listType: "anticipated",        mediaType: "movie"  },
    { name: "Most Anticipated Shows",  provider: "trakt", listType: "anticipated",        mediaType: "series" },
    { name: "Recommended Movies",      provider: "trakt", listType: "recommended/weekly", mediaType: "movie"  },
    { name: "Recommended Shows",       provider: "trakt", listType: "recommended/weekly", mediaType: "series" },
    { name: "Most Collected Movies",   provider: "trakt", listType: "collected/weekly",   mediaType: "movie"  },
    { name: "Most Collected Shows",    provider: "trakt", listType: "collected/weekly",   mediaType: "series" },
    { name: "Most Played Movies",      provider: "trakt", listType: "played/weekly",      mediaType: "movie"  },
    { name: "Most Played Shows",       provider: "trakt", listType: "played/weekly",      mediaType: "series" },
  ] },
  kids: { label: "Kids \u0026 Family", color: "#FF6B9D", letter: "\u2764", catalogs: [
    { name: "Family Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/family",                                     mediaType: "movie"  },
    { name: "Kids TV Shows",           provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/kids-tv-shows",                              mediaType: "series" },
    { name: "Disney+ Movies",          provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/disney-movies",                         mediaType: "movie"  },
    { name: "Disney+ Shows",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/disney-shows",                          mediaType: "series" },
    { name: "Pixar Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/pixar-movies",                            mediaType: "movie"  },
    { name: "Top Kids Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/top-watched-movies-of-the-week-for-kids", mediaType: "movie"  },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                                mediaType: "movie"  },
    { name: "Comedy Shows",            provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy-shows",                          mediaType: "series" },
  ] },
  genres: { label: "Genres", color: "#8B5CF6", letter: "\u266c", catalogs: [
    { name: "Action Movies",    provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/action",         mediaType: "movie"  },
    { name: "Comedy Movies",    provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",         mediaType: "movie"  },
    { name: "Drama Movies",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama",          mediaType: "movie"  },
    { name: "Horror Movies",    provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/horror",         mediaType: "movie"  },
    { name: "Thriller Movies",  provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller",       mediaType: "movie"  },
    { name: "Sci-Fi Movies",    provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",         mediaType: "movie"  },
    { name: "Crime Movies",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime",          mediaType: "movie"  },
    { name: "War Movies",       provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/war",            mediaType: "movie"  },
    { name: "History Movies",   provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/history",        mediaType: "movie"  },
    { name: "Romance Movies",   provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/romance",        mediaType: "movie"  },
    { name: "Western Movies",   provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/western",        mediaType: "movie"  },
    { name: "Drama Shows",      provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/drama-shows",    mediaType: "series" },
    { name: "Comedy Shows",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy-shows",   mediaType: "series" },
    { name: "Horror Shows",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/horror-shows",   mediaType: "series" },
    { name: "Sci-Fi Shows",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi-shows",   mediaType: "series" },
    { name: "Crime Shows",      provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/crime-shows",    mediaType: "series" },
    { name: "Thriller Shows",   provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/thriller-shows", mediaType: "series" },
  ] },
  discovery: { label: "Surprise Me", color: "#EC4899", letter: "\u2728", catalogs: [
    { name: "Trending Movies",         provider: "trakt",   listType: "trending",           mediaType: "movie"  },
    { name: "Trending Shows",          provider: "trakt",   listType: "trending",           mediaType: "series" },
    { name: "Most Anticipated Movies", provider: "trakt",   listType: "anticipated",        mediaType: "movie"  },
    { name: "Most Anticipated Shows",  provider: "trakt",   listType: "anticipated",        mediaType: "series" },
    { name: "Recommended Movies",      provider: "trakt",   listType: "recommended/weekly", mediaType: "movie"  },
    { name: "Recommended Shows",       provider: "trakt",   listType: "recommended/weekly", mediaType: "series" },
    { name: "Best New Movies",         provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/new-movies",                   mediaType: "movie"  },
    { name: "Best New Shows",          provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/best-new-shows",               mediaType: "series" },
    { name: "Latest Blu-Ray",          provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/latest-blu-ray-releases",    mediaType: "movie"  },
    { name: "Certified Fresh",         provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/certified-fresh",              mediaType: "movie"  },
    { name: "TMDb Trending",           provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/tmdb-trending-top-250",           mediaType: "movie"  },
    { name: "IMDb Top 250",            provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/imdb-toprated-250",               mediaType: "movie"  },
    { name: "Most Watched Movies",     provider: "trakt",   listType: "watched/weekly",     mediaType: "movie"  },
    { name: "Most Watched Shows",      provider: "trakt",   listType: "watched/weekly",     mediaType: "series" },
  ] },
  popular: { label: "Popular \u0026 Trending", color: "#F59E0B", letter: "\u2605", catalogs: [
    { name: "Trending Movies",     provider: "trakt",   listType: "trending",       mediaType: "movie"  },
    { name: "Trending Shows",      provider: "trakt",   listType: "trending",       mediaType: "series" },
    { name: "Popular Movies",      provider: "trakt",   listType: "popular",        mediaType: "movie"  },
    { name: "Popular Shows",       provider: "trakt",   listType: "popular",        mediaType: "series" },
    { name: "Box Office",          provider: "trakt",   listType: "box-office",     mediaType: "movie"  },
    { name: "Most Watched Movies", provider: "trakt",   listType: "watched/weekly", mediaType: "movie"  },
    { name: "Most Watched Shows",  provider: "trakt",   listType: "watched/weekly", mediaType: "series" },
    { name: "IMDb Top 250",        provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/imdb-toprated-250",     mediaType: "movie"  },
    { name: "Best New Movies",     provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/new-movies",          mediaType: "movie"  },
    { name: "Best New Shows",      provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/best-new-shows",      mediaType: "series" },
    { name: "Top Movies",          provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/top-movies",        mediaType: "movie"  },
    { name: "Latest TV Shows",     provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/latest-tv-shows",   mediaType: "series" },
  ] },
};

let _selectedPreset = null;
function initPresets() {
  var c2 = document.getElementById("preset-services"); if (!c2) return;
  Object.keys(STREAMING_PRESETS).forEach(function(k) {
    var p = STREAMING_PRESETS[k]; var btn = document.createElement("button");
    btn.className = "preset-service-btn"; btn.dataset.key = k; btn.style.background = p.color;
    var ls = document.createElement("span"); ls.className = "preset-btn-letter"; ls.textContent = p.letter;
    var lb = document.createElement("span"); lb.className = "preset-btn-label"; lb.textContent = p.label;
    btn.appendChild(ls); btn.appendChild(lb);
    btn.addEventListener("click", function() { selectPreset(k); });
    c2.appendChild(btn);
  });
  document.getElementById("preset-preview").style.display = "none";
}
function selectPreset(key) {
  _selectedPreset = key;
  var p = STREAMING_PRESETS[key];
  document.querySelectorAll(".preset-service-btn").forEach(function(b) { b.classList.toggle("active", b.dataset.key === key); });
  var list = document.getElementById("preset-preview-list"); list.innerHTML = "";
  p.catalogs.forEach(function(cat, idx) {
    var row = document.createElement("label"); row.className = "preset-preview-item";
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
    cb.className = "preset-cb"; cb.dataset.idx = idx;
    cb.addEventListener("change", function() { updatePresetCount(); });
    var badge = document.createElement("span"); badge.className = "preset-preview-badge preset-badge-" + cat.provider;
    badge.textContent = cat.provider === "mdblist" ? "MDB" : cat.provider.toUpperCase();
    var nm = document.createElement("span"); nm.className = "preset-preview-name"; nm.textContent = cat.name;
    var tp = document.createElement("span"); tp.className = "preset-preview-type"; tp.textContent = cat.mediaType === "series" ? "Shows" : "Movies";
    row.appendChild(cb); row.appendChild(badge); row.appendChild(nm); row.appendChild(tp); list.appendChild(row);
  });
  updatePresetCount();
  document.getElementById("preset-preview").style.display = "block";
}
function updatePresetCount() {
  if (!_selectedPreset) return;
  var p = STREAMING_PRESETS[_selectedPreset];
  var checked = document.querySelectorAll(".preset-cb:checked").length;
  var ab = document.getElementById("btn-apply-preset");
  ab.textContent = "+ Apply " + p.label + " (" + checked + "/" + p.catalogs.length + " rows)";
  ab.style.background = p.color;
  ab.disabled = checked === 0;
}
function catalogRowExists(cat) {
  var dominated = false;
  document.querySelectorAll('.catalog-row').forEach(function(row) {
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
    if (catalogRowExists(catObj)) { skipped++; return; }
    addExternalCatalog(catObj);
  });
  if (skipped > 0) { var ind = document.getElementById('autosave-indicator'); if (ind) { ind.textContent = skipped + ' duplicate(s) skipped'; ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); } }
  document.querySelectorAll(".preset-service-btn").forEach(function(b) { b.classList.remove("active"); });
  document.getElementById("preset-preview").style.display = "none";
  _selectedPreset = null; autoSave();
}

function onCatalogProviderChange() {
  const provider = document.getElementById('cat-provider').value;
  const traktFld = document.getElementById('cat-trakt-list');
  const urlFld   = document.getElementById('cat-list-url');
  const nameFld  = document.getElementById('cat-name');
  traktFld.style.display = provider === 'trakt' ? '' : 'none';
  urlFld.style.display   = (provider === 'mdblist' || provider === 'imdb' || provider === 'letterboxd') ? '' : 'none';
  const mt = document.getElementById('cat-media-type').value;
  const typeName = mt === 'series' ? 'Shows' : mt === 'both' ? 'Movies & Shows' : 'Movies';
  if (provider === 'trakt') { const lt = document.getElementById('cat-trakt-list').value; nameFld.value = 'Trakt ' + (TRAKT_LIST_NAMES[lt] || 'Trending') + ' ' + typeName; }
  else if (provider === 'mdblist')    { nameFld.value = 'MDbList ' + typeName; }
  else if (provider === 'imdb')       { nameFld.value = 'IMDb List'; }
  else if (provider === 'letterboxd') { nameFld.value = 'Letterboxd List'; }
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

function renderCatalogRow(cat, id) {
  const badges = { trakt: 'Trakt', mdblist: 'MDbList', imdb: 'IMDb', letterboxd: 'Letterboxd' };
  const typeBadge = cat.mediaType === 'both' ? 'Movies + Shows' : cat.mediaType === 'series' ? 'Shows' : 'Movies';
  const badge  = badges[cat.provider] || cat.provider;
  const detail = cat.listType
    ? (TRAKT_LIST_NAMES[cat.listType] || cat.listType)
    : (cat.listUrl ? cat.listUrl.replace(/^https?:\/\//, '').substring(0, 38) + (cat.listUrl.length > 42 ? '...' : '') : '');
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
  togInput.addEventListener('change', function() { div.classList.toggle('cat-disabled', !togInput.checked); autoSave(); });
  if (cat.enabled === false) div.classList.add('cat-disabled');
  const btn = mk('button', 'cat-remove-btn'); btn.title = 'Remove'; btn.textContent = '\u2715';
  btn.addEventListener('click', function() { removeCatalog(id); });
  [handle, provBadge, nameEl, detailEl, typeEl, countEl, testBtn, toggle, btn].forEach(function(el){ div.appendChild(el); });
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
  
  const rpdbKey = document.getElementById('rpdb-key')?.value?.trim() || null;
  const traktClientId = document.getElementById('trakt-client-id')?.value?.trim() || null;
  const catalogLang = document.getElementById('catalog-lang')?.value || null;
  
  try {
    const resp = await fetch('/api/catalog/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry, rpdbKey, traktClientId, catalogLang })
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
  var NETWORK_KEYS = ["netflix", "prime", "disney", "hulu", "max", "apple"];
  var seen = new Set();
  var catList = document.getElementById("catalog-list");
  if (catList) {
    catList.querySelectorAll("[data-list-url]").forEach(function(row) {
      seen.add(row.dataset.listUrl || "");
    });
  }
  NETWORK_KEYS.forEach(function(key) {
    var p = STREAMING_PRESETS[key]; if (!p) return;
    var added = 0;
    for (var ci = 0; ci < p.catalogs.length && added < 2; ci++) {
      var cat = p.catalogs[ci];
      var uid = cat.listUrl || ("trakt:" + (cat.listType || ""));
      if (seen.has(uid)) continue;
      seen.add(uid);
      addExternalCatalog(cat);
      added++;
    }
  });
}

function addExternalCatalog(cat) {
  if (!cat) {
    const provider  = document.getElementById('cat-provider').value;
    if (!provider) { alert('Select a provider first.'); return; }
    const listType  = provider === 'trakt' ? document.getElementById('cat-trakt-list').value : '';
    const listUrl   = provider !== 'trakt' ? (document.getElementById('cat-list-url').value || '').trim() : '';
    const mediaType = document.getElementById('cat-media-type').value;
    const name      = (document.getElementById('cat-name').value || '').trim() || (provider + ' catalog');
    if (provider !== 'trakt' && !listUrl) { alert('Paste the list URL first.'); return; }
    const apiKey = provider === 'mdblist' ? (document.getElementById('mdblist-api-key') ? document.getElementById('mdblist-api-key').value.trim() : '') : '';
    cat = { provider, listType, listUrl, mediaType, name, apiKey };
    document.getElementById('cat-provider').value  = '';
    document.getElementById('cat-list-url').value  = '';
    document.getElementById('cat-name').value      = '';
    document.getElementById('cat-trakt-list').style.display = 'none';
    document.getElementById('cat-list-url').style.display   = 'none';
  }
  if (cat.provider === 'mdblist' && !cat.apiKey) {
    const keyEl = document.getElementById('mdblist-api-key');
    cat.apiKey = keyEl ? keyEl.value.trim() : '';
  }
  const id  = nextCatId++;
  const row = renderCatalogRow(cat, id);
  document.getElementById('catalog-list').appendChild(row);
  initDragRow(row);
  autoSave();
  // Auto-test when manually added (not preset-loaded rows with already-known count)
  if (!cat.count && cat.enabled !== false) testCatalog(id);
}

function removeCatalog(id) {
  const el = document.getElementById('cat-row-' + id);
  if (el) el.remove();
  autoSave();
}

function clearAllCatalogs() {
  var list = document.getElementById('catalog-list');
  if (!list || !list.children.length) return;
  if (!confirm('Remove all ' + list.children.length + ' catalog rows?')) return;
  list.innerHTML = '';
  autoSave();
}

function collectExternalCatalogs() {
  const cats = [];
  document.querySelectorAll('.catalog-row').forEach(function(row) {
    var cb = row.querySelector('.cat-enabled-cb');
    cats.push({ provider: row.dataset.provider||'', listType: row.dataset.listType||'', listUrl: row.dataset.listUrl||'',
      mediaType: row.dataset.mediaType||'movie', name: row.dataset.name||'', apiKey: row.dataset.apiKey||'',
      enabled: cb ? cb.checked : true });
  });
  return cats;
}

let _dragSrc = null;
function initDragRow(row) {
  row.addEventListener('dragstart', function(e) { _dragSrc = row; e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
  row.addEventListener('dragend', function() { row.classList.remove('dragging'); document.querySelectorAll('.catalog-row').forEach(function(r){ r.classList.remove('drag-over'); }); autoSave(); });
  row.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (_dragSrc && _dragSrc !== row) { document.querySelectorAll('.catalog-row').forEach(function(r){ r.classList.remove('drag-over'); }); row.classList.add('drag-over'); } });
  row.addEventListener('drop', function(e) { e.preventDefault(); if (_dragSrc && _dragSrc !== row) { const list = document.getElementById('catalog-list'); const all = Array.from(list.querySelectorAll('.catalog-row')); if (all.indexOf(_dragSrc) < all.indexOf(row)) list.insertBefore(_dragSrc, row.nextSibling); else list.insertBefore(_dragSrc, row); } row.classList.remove('drag-over'); });
}



// == MDbList User Browser ==
async function browseMdblistUser() {
  var username = (document.getElementById('mdblist-browse-user') || {}).value.trim();
  var apiKey = (document.getElementById('mdblist-api-key') || {}).value.trim();
  var resultsEl = document.getElementById('mdblist-browse-results');
  if (!username) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter a username.</div>'; return; }
  if (!apiKey) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter your MDbList API key above first.</div>'; return; }
  resultsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">Loading lists...</div>';
  try {
    var resp = await fetch('https://api.mdblist.com/lists/user/' + encodeURIComponent(username) + '/?apikey=' + encodeURIComponent(apiKey));
    if (!resp.ok) throw new Error('API returned ' + resp.status);
    var lists = await resp.json();
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
  autoSave();
}

// == Trakt User Lists ==
async function browseTraktUser() {
  var input = (document.getElementById('trakt-browse-user') || {}).value.trim();
  var clientId = (document.getElementById('trakt-client-id') || {}).value.trim();
  var resultsEl = document.getElementById('trakt-browse-results');
  if (!clientId) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter your Trakt Client ID above first.</div>'; return; }
  var username = input.replace(/^https?:\/\/trakt\.tv\/users\//, '').replace(/\/.*$/, '').trim();
  if (!username) { resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem">Enter a Trakt username or profile URL.</div>'; return; }
  resultsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem">Loading lists...</div>';
  try {
    var resp = await fetch('https://api.trakt.tv/users/' + encodeURIComponent(username) + '/lists', {
      headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId }
    });
    if (!resp.ok) throw new Error('Trakt API returned ' + resp.status);
    var lists = await resp.json();
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
  autoSave();
}


function fmtBytes(b) {
  if (!b) return null;
  if (b >= 1e9) return `${(b/1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${(b/1e6).toFixed(0)}MB`;
  return `${Math.round(b/1e3)}KB`;
}

const LOG_PAGE_SIZE = 15;
let logData = [];
let logPage = 0;

function renderLogPage() {
  const wrap = document.getElementById('log-table-wrap');
  if (!wrap) return;
  if (!logData.length) {
    wrap.innerHTML = '<div class="log-empty">No requests logged yet. Start a stream in Stremio to see activity here.</div>';
    return;
  }

  const totalPages = Math.ceil(logData.length / LOG_PAGE_SIZE);
  if (logPage >= totalPages) logPage = totalPages - 1;
  const slice = logData.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);

  const rows = slice.map(e => {
    const t = new Date(e.ts).toLocaleTimeString();
    const d = new Date(e.ts).toLocaleDateString();
    const ep = e.type === 'series'
      ? ` S${String(e.season||0).padStart(2,'0')}E${String(e.episode||0).padStart(2,'0')}` : '';
    const title = e.contentName
      ? `<strong style="color:#c0b8ff">${escHtml(e.contentName)}</strong>${ep}`
      : `<span class="log-id">${e.imdbId}</span>${ep}`;
    const ms = e.ms < 1000 ? `${e.ms}ms` : `${(e.ms/1000).toFixed(1)}s`;

    let bestHtml = '—';
    if (e.bestServer) {
      const size = fmtBytes(e.bestServer.size);
      const mbps = e.bestServer.bitrate ? `${(e.bestServer.bitrate/1e6).toFixed(1)}Mbps` : null;
      const detail = [size, mbps].filter(Boolean).join(' · ');
      bestHtml = `<span style="color:#4caf7d;font-weight:700">${escHtml(e.bestServer.label)}</span>${detail ? `<br><span style="font-size:0.7rem;color:#4a6a55">${detail}</span>` : ''}`;
    }

    let serversHtml = '—';
    if (e.serverStatus?.length) {
      serversHtml = e.serverStatus.map(s => {
        if (s.status === 'found') {
          const size = fmtBytes(s.size);
          const mbps = s.bitrate ? `${(s.bitrate/1e6).toFixed(1)}Mbps` : null;
          const det = [size, mbps].filter(Boolean).join(' / ');
          return `<div style="margin-bottom:0.15rem"><span style="color:#4caf7d">&#10003;</span> <span style="color:#888">${escHtml(s.label)}</span>${det ? ` <span style="color:#444;font-size:0.7rem">${det}</span>` : ''}</div>`;
        }
        if (s.status === 'offline') return `<div><span style="color:#e05555">&#10007;</span> <span style="color:#555">${escHtml(s.label)}</span> <span style="color:#444;font-size:0.7rem">offline</span></div>`;
        if (s.status === 'not_found') return `<div><span style="color:#c06000">–</span> <span style="color:#555">${escHtml(s.label)}</span> <span style="color:#444;font-size:0.7rem">not in library</span></div>`;
        return `<div><span style="color:#444">?</span> <span style="color:#444">${escHtml(s.label)}</span></div>`;
      }).join('');
    }

    return `<tr>
      <td class="log-time">${d}<br>${t}</td>
      <td>${title}</td>
      <td class="log-ms">${ms}</td>
      <td>${bestHtml}</td>
      <td>${serversHtml}</td>
    </tr>`;
  }).join('');

  let pageButtons = '';
  const maxBtns = 7;
  let start = Math.max(0, logPage - Math.floor(maxBtns / 2));
  let end = Math.min(totalPages, start + maxBtns);
  if (end - start < maxBtns) start = Math.max(0, end - maxBtns);
  for (let i = start; i < end; i++) {
    pageButtons += `<button class="btn-page${i === logPage ? ' active' : ''}" onclick="goLogPage(${i})">${i + 1}</button>`;
  }

  wrap.innerHTML = `
    <table class="log-table">
      <thead><tr><th>Time</th><th>Content</th><th>Duration</th><th>Best File</th><th>Server Results</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="log-pagination">
      <span class="log-page-info">${logPage * LOG_PAGE_SIZE + 1}–${Math.min((logPage + 1) * LOG_PAGE_SIZE, logData.length)} of ${logData.length}</span>
      <div class="log-page-btns">
        <button class="btn-page" onclick="goLogPage(${logPage - 1})" ${logPage === 0 ? 'disabled' : ''}>‹</button>
        ${pageButtons}
        <button class="btn-page" onclick="goLogPage(${logPage + 1})" ${logPage >= totalPages - 1 ? 'disabled' : ''}>›</button>
      </div>
    </div>`;
}

function goLogPage(p) {
  const totalPages = Math.ceil(logData.length / LOG_PAGE_SIZE);
  logPage = Math.max(0, Math.min(p, totalPages - 1));
  renderLogPage();
}

async function refreshLog() {
  try {
    const data = await fetch('/api/request-log').then(r => r.json());
    const badge = document.getElementById('log-count-badge');
    if (badge) badge.textContent = data.length ? `${data.length} entries` : '';
    logData = data;
    renderLogPage();
  } catch {}
}

async function clearLog() {
  if (!confirm('Clear request history?')) return;
  await fetch('/api/clear-request-log', { method: 'POST' });
  logData = []; logPage = 0;
  refreshLog();
}

refreshLog();
let logInterval = setInterval(refreshLog, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(logInterval);
    logInterval = null;
  } else {
    refreshLog();
    logInterval = setInterval(refreshLog, 30000);
  }
});

// ── Auto-generate server name ─────────────────────────────────────────────
async function autoNameServer(id) {
  const block = document.getElementById(`server-${id}`);
  if (!block) return;
  const labelEl = block.querySelector('.f-label');
  const urlEl = block.querySelector('.f-url');
  const typeEl = block.querySelector('.f-type');
  if (!urlEl || !labelEl) return;
  const url = (urlEl.value || '').trim().replace(/\/+$/, '');
  if (!url || labelEl.value.trim()) return;
  try {
    const resp = await fetch('/api/test-connection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: typeEl?.value || 'emby', apiKey: '', userId: '' }),
    });
    const data = await resp.json();
    if (data.message) {
      const match = data.message.match(/Connected — (.+?)(?:\s+v[\d.]+)?$/);
      if (match && match[1]) {
        labelEl.value = match[1];
        if (block.classList.contains('collapsed')) updateSummary(id);
        autoSave();
      }
    }
  } catch {}
}

// ── Config encoding ───────────────────────────────────────────────────────
function encodeConfig(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Server block builder ──────────────────────────────────────────────────
function buildServerBlock(id) {
  const div = document.createElement('div');
  div.className = 'server-block';
  div.id = `server-${id}`;
  div.innerHTML = `
    <div class="server-block-header">
      <div class="server-header-left">
        <label class="toggle-switch" title="Enable / disable this server">
          <input type="checkbox" class="f-enabled" checked onchange="updateToggle(${id})" />
          <span class="toggle-slider"></span>
        </label>
        <span class="server-number">Server <span class="server-num-label"></span></span>
        <span class="server-status-dot" id="status-dot-${id}"></span>
        <button class="btn-collapse" onclick="toggleCollapse(${id})" title="Collapse / expand">&#9660;</button>
      </div>
      <div class="server-header-right">
        <button class="btn-reorder btn-up" onclick="moveServer(${id}, -1)" title="Move up">&#9650;</button>
        <button class="btn-reorder btn-down" onclick="moveServer(${id}, 1)" title="Move down">&#9660;</button>
        <button class="btn-remove" onclick="removeServer(${id})">Remove</button>
      </div>
    </div>
    <div class="server-summary">
      <span class="sum-name"></span><span class="sum-sep">·</span><span class="sum-type"></span><span class="sum-sep">·</span><span class="sum-url"></span>
    </div>
    <div class="server-body">
      <div class="field-row triple">
        <div class="field-group">
          <label>Display Name</label>
          <input type="text" class="f-label" placeholder="e.g. Eagle" />
        </div>
        <div class="field-group" style="max-width:5rem">
          <label>Emoji</label>
          <input type="text" class="f-emoji" placeholder="&#128421;" maxlength="4" style="text-align:center;font-size:1.05rem" />
        </div>
        <div class="field-group">
          <label>Server Type</label>
          <select class="f-type" onchange="updateBlockStyle(${id})">
            <option value="emby">Emby</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
        </div>
      </div>
      <div class="field-row full">
        <div class="field-group">
          <label>Server URL</label>
          <input type="url" class="f-url" placeholder="http://192.168.1.100:8096" onblur="autoNameServer(${id})" oninput="autoSave()" />
        </div>
      </div>
      <div class="field-row full">
        <div class="field-group">
          <label>Thumbnail URL <span class="field-hint">optional — shown next to streams</span></label>
          <input type="url" class="f-thumbnail" placeholder="https://i.imgur.com/yourlogo.png" />
        </div>
      </div>
      <div class="cred-section">
        <div class="cred-title">Sign in to auto-fetch credentials</div>
        <div class="cred-inputs">
          <div class="field-group">
            <label>Username</label>
            <input type="text" class="f-username" placeholder="admin" autocomplete="off" />
          </div>
          <div class="field-group">
            <label>Password</label>
            <input type="password" class="f-password" placeholder="••••••••" autocomplete="off" />
          </div>
        </div>
        <button class="btn-fetch" onclick="fetchCredentials(${id})">Fetch API Key &amp; User ID</button>
        <div class="cred-status" id="cred-status-${id}"></div>
      </div>
      <div class="divider">— or enter manually —</div>
      <div class="field-row">
        <div class="field-group">
          <label>API Key</label>
          <input type="text" class="f-apikey" placeholder="Auto-filled above" autocomplete="off" />
        </div>
        <div class="field-group">
          <label>User ID</label>
          <input type="text" class="f-userid" placeholder="Auto-filled above" autocomplete="off" />
        </div>
      </div>
      <div class="server-actions-row">
        <button class="btn-test" onclick="testConnection(${id})">Test Connection</button>
        <button class="btn-stats" onclick="loadLibraryStats(${id})">Library Stats</button>
      </div>
      <div class="test-status" id="test-status-${id}"></div>
      <div class="stats-display" id="stats-${id}"></div>
    </div>
  `;
  return div;
}

// ── Server collapse ───────────────────────────────────────────────────────
function updateSummary(id) {
  const block = document.getElementById(`server-${id}`);
  const name = block.querySelector('.f-label')?.value.trim() || 'Unnamed';
  const type = block.querySelector('.f-type')?.value || 'emby';
  const url = block.querySelector('.f-url')?.value.trim() || '';
  const urlShort = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  block.querySelector('.sum-name').textContent = name;
  block.querySelector('.sum-type').textContent = type === 'jellyfin' ? 'Jellyfin' : 'Emby';
  block.querySelector('.sum-url').textContent = urlShort;
}

function toggleCollapse(id) {
  const block = document.getElementById(`server-${id}`);
  const collapsed = block.classList.toggle('collapsed');
  block.querySelector('.btn-collapse').textContent = collapsed ? '\u25B6' : '\u25BC';
  if (collapsed) updateSummary(id);
  autoSave();
}

function collapseAll() {
  document.querySelectorAll('.server-block').forEach(block => {
    const id = parseInt(block.id.replace('server-', ''), 10);
    block.classList.add('collapsed');
    block.querySelector('.btn-collapse').textContent = '\u25B6';
    updateSummary(id);
  });
  autoSave();
}

function expandAll() {
  document.querySelectorAll('.server-block').forEach(block => {
    block.classList.remove('collapsed');
    block.querySelector('.btn-collapse').textContent = '\u25BC';
  });
  autoSave();
}

function updateBlockStyle(id) {
  const block = document.getElementById(`server-${id}`);
  const type = block.querySelector('.f-type').value;
  block.classList.remove('type-emby', 'type-jellyfin');
  block.classList.add(`type-${type}`);
  if (block.classList.contains('collapsed')) updateSummary(id);
}

function updateToggle(id) {
  const block = document.getElementById(`server-${id}`);
  block.classList.toggle('disabled', !block.querySelector('.f-enabled').checked);
}

function moveServer(id, dir) {
  const block = document.getElementById(`server-${id}`);
  const container = document.getElementById('servers-container');
  const blocks = [...container.querySelectorAll('.server-block')];
  const idx = blocks.indexOf(block);
  const target = blocks[idx + dir];
  if (!target) return;
  if (dir === -1) container.insertBefore(block, target);
  else container.insertBefore(target, block);
  renumberBlocks();
  autoSave();
}

function renumberBlocks() {
  const blocks = document.querySelectorAll('.server-block');
  blocks.forEach((b, i) => {
    b.querySelector('.server-num-label').textContent = i + 1;
    b.querySelector('.btn-up').disabled = i === 0;
    b.querySelector('.btn-down').disabled = i === blocks.length - 1;
  });
  document.getElementById('btn-add').disabled = blocks.length >= 10;
  document.querySelectorAll('.btn-remove').forEach(btn => {
    btn.style.display = blocks.length > 1 ? '' : 'none';
  });
  updateSteps();
}

function addServer(data = null) {
  const container = document.getElementById('servers-container');
  if (container.querySelectorAll('.server-block').length >= 10) return;
  const id = nextId++;
  const block = buildServerBlock(id);
  container.appendChild(block);
  if (data) {
    block.querySelector('.f-label').value = data.label || '';
    block.querySelector('.f-url').value = data.url || '';
    block.querySelector('.f-apikey').value = data.apiKey || '';
    block.querySelector('.f-userid').value = data.userId || '';
    block.querySelector('.f-username').value = data.username || '';
    block.querySelector('.f-password').value = data.password || '';
    block.querySelector('.f-thumbnail').value = data.thumbnail || '';
    if (block.querySelector('.f-emoji')) block.querySelector('.f-emoji').value = data.emoji || '';
    if (data.type) {
      block.querySelector('.f-type').value = data.type;
      updateBlockStyle(id);
    }
  }
  renumberBlocks();
}

function removeServer(id) {
  const el = document.getElementById(`server-${id}`);
  if (el) el.remove();
  renumberBlocks();
  autoSave();
}

// ── Collect config ────────────────────────────────────────────────────────
function collectConfig(silent = false) {
  const blocks = document.querySelectorAll('.server-block');
  if (blocks.length === 0) {
    if (!silent) showError('Add at least one server.');
    return null;
  }
  const servers = [];
  for (const block of blocks) {
    if (!block.querySelector('.f-enabled').checked) continue;
    const label = block.querySelector('.f-label').value.trim();
    const type = block.querySelector('.f-type').value;
    const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
    const apiKey = block.querySelector('.f-apikey').value.trim();
    const userId = block.querySelector('.f-userid').value.trim();
    const username = block.querySelector('.f-username').value.trim();
    const password = block.querySelector('.f-password').value;
    if (!label || !url || !apiKey || !userId) {
      if (!silent) showError('All fields (Name, URL, API Key, User ID) must be filled for every enabled server.');
      return null;
    }
    const thumbnail = block.querySelector('.f-thumbnail')?.value.trim() || '';
    const emoji = block.querySelector('.f-emoji')?.value.trim() || '';
    const entry = { label, type, url, apiKey, userId };
    if (thumbnail) entry.thumbnail = thumbnail;
    if (emoji) entry.emoji = emoji;
    if (username && password) { entry.username = username; entry.password = password; }
    servers.push(entry);
  }
  if (servers.length === 0) {
    if (!silent) showError('At least one server must be enabled.');
    return null;
  }
  return { servers };
}

function populateFromConfig(config) {
  document.getElementById('servers-container').innerHTML = '';
  nextId = 0;
  for (const server of (config.servers || [])) addServer(server);
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function safeJson(resp) {
  try { return await resp.json(); }
  catch { return { error: `Server returned non-JSON (HTTP ${resp.status}).` }; }
}
function showError(msg) { const e = document.getElementById('global-error'); e.textContent = msg; e.style.display = 'block'; }
function hideError() { document.getElementById('global-error').style.display = 'none'; }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Profile ───────────────────────────────────────────────────────────────
function setProfileButtons(disabled) {
  document.querySelectorAll('.btn-profile').forEach(b => b.disabled = disabled);
}

async function saveProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter a profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter a password to protect your profile.'; statusEl.className = 'profile-status error'; return; }
  const config = collectConfig();
  if (!config) return;
  setProfileButtons(true);
  statusEl.textContent = 'Saving...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, config }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    statusEl.textContent = `Done — ${data.message}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

async function loadProfile() {
  const username = document.getElementById('p-username').value.trim();
  const password = document.getElementById('p-password').value;
  const statusEl = document.getElementById('profile-status');
  if (!username) { statusEl.textContent = 'Enter your profile name first.'; statusEl.className = 'profile-status error'; return; }
  if (!password) { statusEl.textContent = 'Enter your password.'; statusEl.className = 'profile-status error'; return; }
  setProfileButtons(true);
  statusEl.textContent = 'Loading...'; statusEl.className = 'profile-status info';
  try {
    const resp = await fetch('/api/profile/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    populateFromConfig(data.config);
    const ago = data.updatedAt ? ` (saved ${new Date(data.updatedAt).toLocaleDateString()})` : '';
    statusEl.textContent = `Profile loaded${ago}`; statusEl.className = 'profile-status success';
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'profile-status error';
  } finally { setProfileButtons(false); }
}

// ── Import / Export ───────────────────────────────────────────────────────
function exportConfig() {
  const state = collectFormState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'multi-emby-bridge-config.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const state = JSON.parse(e.target.result);
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      location.reload();
    } catch { alert('Invalid config file.'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ── Credential fetch ──────────────────────────────────────────────────────
async function fetchCredentials(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const username = block.querySelector('.f-username').value.trim();
  const password = block.querySelector('.f-password').value;
  const statusEl = document.getElementById(`cred-status-${id}`);
  const btn = block.querySelector('.btn-fetch');
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'cred-status error'; return; }
  if (!username) { statusEl.textContent = 'Enter your username.'; statusEl.className = 'cred-status error'; return; }
  btn.disabled = true; btn.textContent = 'Fetching...';
  statusEl.textContent = ''; statusEl.className = 'cred-status';
  try {
    const resp = await fetch('/api/fetch-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, username, password }) });
    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    block.querySelector('.f-apikey').value = data.apiKey;
    block.querySelector('.f-userid').value = data.userId;
    statusEl.textContent = 'Credentials fetched!'; statusEl.className = 'cred-status success';
    autoSave();
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'cred-status error';
  } finally { btn.disabled = false; btn.textContent = 'Fetch API Key & User ID'; }
}

// ── Test connection ───────────────────────────────────────────────────────
async function testConnection(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statusEl = document.getElementById(`test-status-${id}`);
  const btn = block.querySelector('.btn-test');
  const dot = document.getElementById(`status-dot-${id}`);
  if (!url) { statusEl.textContent = 'Enter the Server URL first.'; statusEl.className = 'test-status error'; return; }
  if (!apiKey || !userId) { statusEl.textContent = 'Enter API Key and User ID first.'; statusEl.className = 'test-status error'; return; }
  btn.disabled = true; btn.textContent = 'Testing...';
  statusEl.textContent = ''; statusEl.className = 'test-status';
  try {
    const resp = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, type, apiKey, userId }) });
    const data = await safeJson(resp);
    if (data.ok) {
      statusEl.textContent = data.message; statusEl.className = 'test-status success';
      if (dot) dot.className = 'server-status-dot online';
    } else {
      statusEl.textContent = data.error; statusEl.className = 'test-status error';
      if (dot) dot.className = 'server-status-dot offline';
    }
  } catch (err) {
    statusEl.textContent = err.message; statusEl.className = 'test-status error';
    if (dot) dot.className = 'server-status-dot offline';
  } finally { btn.disabled = false; btn.textContent = 'Test Connection'; }
}

// ── Library stats ─────────────────────────────────────────────────────────
async function loadLibraryStats(id) {
  const block = document.getElementById(`server-${id}`);
  const url = block.querySelector('.f-url').value.trim().replace(/\/+$/, '');
  const type = block.querySelector('.f-type').value;
  const apiKey = block.querySelector('.f-apikey').value.trim();
  const userId = block.querySelector('.f-userid').value.trim();
  const statsEl = document.getElementById(`stats-${id}`);
  const btn = block.querySelector('.btn-stats');
  if (!url) { statsEl.textContent = 'Enter Server URL first.'; statsEl.className = 'stats-display error'; return; }
  if (!apiKey || !userId) { statsEl.textContent = 'Enter API Key + User ID first.'; statsEl.className = 'stats-display error'; return; }
  btn.disabled = true; btn.textContent = 'Loading...';
  statsEl.textContent = ''; statsEl.className = 'stats-display';
  try {
    const resp = await fetch('/api/library-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, type, apiKey, userId }) });
    const data = await safeJson(resp);
    if (data.error) { statsEl.textContent = data.error; statsEl.className = 'stats-display error'; }
    else {
      statsEl.className = 'stats-display';
      statsEl.innerHTML = `
        <span class="stats-badge"><span>Movies:</span><span>${data.movies.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Shows:</span><span>${data.shows.toLocaleString()}</span></span>
        <span class="stats-badge"><span>Episodes:</span><span>${data.episodes.toLocaleString()}</span></span>`;
    }
  } catch (err) {
    statsEl.textContent = err.message; statsEl.className = 'stats-display error';
  } finally { btn.disabled = false; btn.textContent = 'Library Stats'; }
}

// ── Label preview — trimmed to 5 presets ─────────────────────────────────
function updateLabelPreview() {
  const preset = document.getElementById('label-preset').value;
  const previewEl = document.getElementById('label-preview');
  const previews = {
    standard: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nTrueHD 7.1\nMKV · 85.2Mbps · 58.32 GB' },
    compact:  { name: 'Server · 4K · DV · HEVC 10bit', desc: 'TrueHD 7.1 · 85.2Mbps · 58.32 GB' },
    detailed: { name: 'Server · 4K · DV', desc: 'HEVC 10bit · REMUX\nENG TrueHD 7.1 · FRE DD+ 5.1\nSubs: EN · FR · ES\n3840x2160 · 85.2Mbps · 58.32 GB' },
    cinema:   { name: 'Server · 4K · DV · REMUX', desc: 'HEVC 10bit\nTrueHD 7.1\nSubs: EN · FR · ES\n58.32 GB' },
    minimal:  { name: 'Server · 4K', desc: '58.32 GB' },
    custom:   { name: 'Server Â· custom fields', desc: 'fields selected in Custom section below' },
  };
  const p = previews[preset] || previews.standard;
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const descHtml = esc(p.desc).split('\n')
    .map(l => `<div style="color:var(--text-muted);font-size:0.72rem;line-height:1.55">${l}</div>`)
    .join('');
  previewEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.1rem 0">
      <div style="flex-shrink:0;width:26px;height:26px;background:var(--bg-elevated);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text-muted);margin-top:0.1rem">&#9654;</div>
      <div style="min-width:0">
        <div style="color:#d0c8ff;font-weight:600;font-size:0.8rem;line-height:1.4;margin-bottom:0.1rem">${esc(p.name)}</div>
        ${descHtml}
      </div>
    </div>`;
  autoSave();
}

function toggleCustomPreset() {
  var preset = document.getElementById("label-preset").value;
  var panel = document.getElementById("custom-preset-panel");
  if (panel) panel.style.display = preset === "custom" ? "block" : "none";
}

// ── Summary preview — trimmed to 4 styles ────────────────────────────────
function toggleSummaryStyle() {
  const show = document.getElementById('show-summary').checked;
  const opts = document.getElementById('summary-options');
  if (opts) opts.style.display = show ? 'flex' : 'none';
  if (show) updateSummaryPreview();
  autoSave();
}

function toggleCatalogOptions() {
  const show = document.getElementById('show-catalog')?.checked ?? true;
  const opts = document.getElementById('catalog-options');
  if (opts) opts.style.display = show ? 'flex' : 'none';
}

const PREVIEW_SERVERS = [
  { label: 'ARCTV', emoji: '', type: 'emby', status: 'found', count: 5, resLabels: ['4K','1080p'], resCounts: {'4K':2,'1080p':3}, pingMs: 12 },
  { label: 'STREAMER', emoji: '', type: 'emby', status: 'found', count: 2, resLabels: ['1080p'], resCounts: {'1080p':2}, pingMs: 28 },
  { label: 'BACKUP', emoji: '', type: 'jellyfin', status: 'not_found', count: 0, resLabels: [], resCounts: {}, pingMs: null },
];

function updateSummaryPreview() {
  const el = document.getElementById('summary-preview');
  if (!el) return;
  const style = document.getElementById('summary-style')?.value || 'compact';
  const servers = PREVIEW_SERVERS;
  const found = servers.filter(s => s.status === 'found');
  const total = found.reduce((n, s) => n + s.count, 0);
  const trunc = (str, n) => str.length > n ? str.slice(0, n - 1) + '...' : str;
  const eLabel = (s, maxLen) => {
    const prefix = s.emoji ? s.emoji + ' ' : '';
    return prefix + trunc(s.label, maxLen - prefix.length);
  };

  let name, lines;
  if (style === 'detailed') {
    name = `${total} streams · ${found.length} found`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} — ${s.count}${res}`; } return `- ${l} — none`; });
  } else if (style === 'minimal') {
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?` (${s.resLabels[0]})`:''; return `${l}: ${s.count}${res}`; } return `${l}: —`; });
  } else if (style === 'bar') {
    name = `Results · ${total} streams`;
    const maxC = Math.max(...found.map(s=>s.count),1);
    lines = servers.map(s => { const l = eLabel(s,10); if (s.status==='found') { const f=Math.max(1,Math.round((s.count/maxC)*4)); return `${l} ${'█'.repeat(f)}${'░'.repeat(4-f)} ${s.count}`; } return `${l} ░░░░ x`; });
  } else {
    // compact (default)
    name = `${total} streams · ${found.length} servers`;
    lines = servers.map(s => { const l = eLabel(s,14); if (s.status==='found') { const res=s.resLabels.length?' · '+s.resLabels.join('·'):''; return `+ ${l} · ${s.count}${res}`; } return `- ${l}`; });
  }

  const linesHtml = lines.map(l =>
    `<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;white-space:pre;font-family:monospace">${escHtml(l)}</div>`
  ).join('');

  el.innerHTML = `
    <div style="font-size:0.62rem;color:var(--text-muted);letter-spacing:0.07em;text-transform:uppercase;margin-bottom:0.45rem;font-weight:600">Preview</div>
    <div style="display:flex;gap:0;align-items:stretch;background:var(--bg-base);border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border)">
      <div style="flex:0 0 38%;padding:0.5rem 0.6rem;border-right:1px solid var(--border);display:flex;align-items:center">
        <div style="font-size:0.76rem;font-weight:700;color:#d0c8ff;line-height:1.4">${escHtml(name)}</div>
      </div>
      <div style="flex:1;padding:0.45rem 0.6rem;display:flex;flex-direction:column;justify-content:center">${linesHtml}</div>
    </div>`;
}

// ── Performance mode ──────────────────────────────────────────────────────
function onModeChange() {
  const mode = document.querySelector('input[name="perf-mode"]:checked').value;
  document.getElementById('timeout-row').classList.toggle('visible', mode === 'timeout');
}

function onShowPingChange() {
  const enabled = document.getElementById('show-ping').checked;
  const pd = document.getElementById('ping-detail');
  const item = document.getElementById('ping-detail-item');
  if (pd) {
    pd.disabled = !enabled;
    if (!enabled) pd.checked = false;
  }
  if (item) item.style.opacity = enabled ? '1' : '0.4';
  autoSave();
}

// ── Generate links ────────────────────────────────────────────────────────
function generateLinks() {
  hideError();
  const config = collectConfig();
  if (!config) return;

  const mode = document.querySelector('input[name="perf-mode"]:checked').value;
  const sortOrder = document.getElementById('sort-order').value;
  const excludeRes = [...document.querySelectorAll('.res-cb:checked')].map(cb => cb.value);
  const recommend = document.getElementById('show-recommend').checked;
  const showPing = document.getElementById('show-ping').checked;
  const pingDetail = document.getElementById('ping-detail').checked;
  const audioLang = document.getElementById('audio-lang').value;
  const prefCodec = document.getElementById('pref-codec').value;
  const codecMode = document.getElementById('codec-mode').value;
  const maxBitrate = document.getElementById('max-bitrate').value;
  const autoSelect = document.getElementById('auto-select').checked;
  const labelPreset = document.getElementById('label-preset').value;
  const showSummary = document.getElementById('show-summary').checked;
  const summaryStyle = document.getElementById('summary-style').value;
  const qualityBadge = document.getElementById('quality-badge').value;
  const flagEmoji = document.getElementById('flag-emoji').value;
  const bitrateBar = document.getElementById('bitrate-bar').value;
  const subsStyle = document.getElementById('subs-style').value;
  const showCatalog = document.getElementById('show-catalog').checked;
  const catalogContent = document.getElementById('catalog-content').value;
  const rpdbKey         = document.getElementById('rpdb-key').value.trim();
  const traktClientId   = document.getElementById('trakt-client-id')?.value.trim() || '';
  const mdblistApiKey   = document.getElementById('mdblist-api-key')?.value.trim() || '';
  const externalCatalogs = collectExternalCatalogs();
  const { protocol, host } = window.location;
  const section = document.getElementById('result-section');

  const s3 = document.getElementById('step-3');
  if (s3) { s3.className = 'step active'; }
  const s2 = document.getElementById('step-2');
  if (s2) s2.className = 'step done';

  if (mode === 'split') {
    const rows = config.servers.map(server => {
      const sc = { servers: [server] };
      if (sortOrder !== 'size') sc.sortOrder = sortOrder;
      if (excludeRes.length > 0) sc.excludeRes = excludeRes;
      if (recommend) sc.recommend = true;
      if (showPing) sc.ping = true;
      if (pingDetail) sc.pingDetail = true;
      if (audioLang !== 'any') sc.audioLang = audioLang;
      if (maxBitrate) sc.maxBitrate = parseInt(maxBitrate, 10);
      if (prefCodec !== 'any') { sc.prefCodec = prefCodec; sc.codecMode = codecMode; }
      if (labelPreset !== 'standard') sc.labelPreset = labelPreset;
      if (autoSelect) sc.autoSelect = true;
      if (showSummary) { sc.showSummary = true; if (summaryStyle !== 'compact') sc.summaryStyle = summaryStyle; }
      if (qualityBadge) sc.qualityBadge = qualityBadge;
      if (flagEmoji) sc.flagEmoji = flagEmoji;
      if (bitrateBar) sc.bitrateBar = bitrateBar;
      if (subsStyle !== 'full') sc.subsStyle = subsStyle;
      if (!showCatalog) sc.showCatalog = false;
      if (catalogContent !== 'recent') sc.catalogContent = catalogContent;
      if (rpdbKey) sc.rpdbKey = rpdbKey;
      if (traktClientId) sc.traktClientId = traktClientId;
      if (externalCatalogs.length) { sc.externalCatalogs = externalCatalogs; if (mdblistApiKey) sc.mdblistApiKey = mdblistApiKey; }
      var _clVal = document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "";
      if (_clVal) sc.catalogLang = _clVal;
      const _ndVal = document.getElementById("no-dupes")?.checked;
      if (_ndVal) sc.noDupes = true;
      if (labelPreset === "custom") {
        sc.customNameFields = Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;});
        sc.customDescFields = Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;});
      }
      const encoded = encodeConfig(sc);
      return { label: server.label, manifestUrl: `${protocol}//${host}/${encoded}/manifest.json`, deepLink: `stremio://${host}/${encoded}/manifest.json` };
    });

    let html = '<h2>Ready to install — Split Mode</h2>';
    html += '<p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 1rem;line-height:1.5">Each server is a separate addon. Stremio loads results independently.</p>';
    rows.forEach((row, i) => {
      if (i > 0) html += '<hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">';
      html += `<div>
        <div style="font-size:0.7rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.4rem">${escHtml(row.label)}</div>
        <div class="url-row"><input type="text" readonly value="${escHtml(row.manifestUrl)}" /><button class="btn-copy" data-url="${escHtml(row.manifestUrl)}" onclick="copySpecific(this)">Copy</button></div>
        <a class="btn-install" href="${escHtml(row.deepLink)}">Install "${escHtml(row.label)}" in Stremio</a>
      </div>`;
    });
    section.innerHTML = html;
  } else {
    if (mode === 'timeout') config.timeout = parseInt(document.getElementById('timeout-value').value, 10);
    if (sortOrder !== 'size') config.sortOrder = sortOrder;
    if (excludeRes.length > 0) config.excludeRes = excludeRes;
    if (recommend) config.recommend = true;
    if (showPing) config.ping = true;
    if (pingDetail) config.pingDetail = true;
    if (audioLang !== 'any') config.audioLang = audioLang;
    if (maxBitrate) config.maxBitrate = parseInt(maxBitrate, 10);
    if (prefCodec !== 'any') { config.prefCodec = prefCodec; config.codecMode = codecMode; }
    if (labelPreset !== 'standard') config.labelPreset = labelPreset;
    if (autoSelect) config.autoSelect = true;
    if (showSummary) { config.showSummary = true; if (summaryStyle !== 'compact') config.summaryStyle = summaryStyle; }
    if (qualityBadge) config.qualityBadge = qualityBadge;
    if (flagEmoji) config.flagEmoji = flagEmoji;
    if (bitrateBar) config.bitrateBar = bitrateBar;
    if (subsStyle !== 'full') config.subsStyle = subsStyle;
    if (!showCatalog) config.showCatalog = false;
    if (catalogContent !== 'recent') config.catalogContent = catalogContent;
    if (rpdbKey) config.rpdbKey = rpdbKey;
    if (traktClientId) config.traktClientId = traktClientId;
    if (externalCatalogs.length) { config.externalCatalogs = externalCatalogs; if (mdblistApiKey) config.mdblistApiKey = mdblistApiKey; }
    var _clVal = document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "";
    if (_clVal) config.catalogLang = _clVal;
    const _ndVal2 = document.getElementById("no-dupes")?.checked;
    if (_ndVal2) config.noDupes = true;
    if (labelPreset === "custom") {
      config.customNameFields = Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;});
      config.customDescFields = Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;});
    }

    const encoded = encodeConfig(config);
    const manifestUrl = `${protocol}//${host}/${encoded}/manifest.json`;
    const deepLink = `stremio://${host}/${encoded}/manifest.json`;

    section.innerHTML = `
      <h2>Ready to install${mode === 'timeout' ? ' — Fast Timeout' : ''}</h2>
      <div class="url-row"><input type="text" readonly value="${escHtml(manifestUrl)}" /><button class="btn-copy" data-url="${escHtml(manifestUrl)}" onclick="copySpecific(this)">Copy</button></div>
      <a class="btn-install" href="${escHtml(deepLink)}">Install in Stremio</a>
      <p class="install-note">Opens Stremio and installs the addon automatically.<br/>Or copy the URL and paste it into Stremio → Add Addon.</p>`;
  }

  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    if (mode !== 'split') {
      const encoded = encodeConfig(config);
      localStorage.setItem('meb-last-config', encoded);
    }
  } catch {}

  try {
    const healthServers = (config.servers || []).map(s => ({ url: s.url, label: s.label, type: s.type || 'emby' }));
    fetch('/api/health/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ servers: healthServers }) }).catch(() => {});
  } catch {}
}

// ── Copy ──────────────────────────────────────────────────────────────────
function copySpecific(btn) {
  const url = btn.dataset.url;
  function onSuccess() {
    btn.textContent = 'Copied!'; btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(onSuccess).catch(() => { fallbackCopy(url); onSuccess(); });
  } else { fallbackCopy(url); onSuccess(); }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
}

// ── Ping Test ─────────────────────────────────────────────────────────────
async function browserPing(url) {
  const t0 = Date.now();
  try {
    await fetch(`${url}/System/Ping`, { mode: 'no-cors', cache: 'no-store' });
    return Date.now() - t0;
  } catch { return null; }
}

async function runPingTest() {
  const resultsEl = document.getElementById('ping-results');
  const config = collectConfig(true);
  if (!config) {
    resultsEl.innerHTML = '<div style="color:var(--text-secondary);font-size:0.78rem;padding:0.2rem 0">Add and fill in at least one server first.</div>';
    return;
  }
  const origin = document.getElementById('ping-origin').value;
  const servers = config.servers;
  resultsEl.innerHTML = servers.map(s =>
    `<div class="ping-row"><span class="ping-label">${escHtml(s.label)}</span><span class="ping-value" style="color:var(--text-muted)">testing...</span></div>`
  ).join('');

  if (origin === 'browser') {
    await Promise.all(servers.map(async (s, i) => {
      const ms = await browserPing(s.url);
      const valEl = resultsEl.querySelectorAll('.ping-row')[i]?.querySelector('.ping-value');
      if (!valEl) return;
      if (ms === null) { valEl.textContent = 'timeout'; valEl.className = 'ping-value timeout'; }
      else { const cls = ms < 100 ? 'fast' : ms < 300 ? 'ok' : 'slow'; valEl.textContent = `${ms} ms`; valEl.className = `ping-value ${cls}`; }
    }));
  } else {
    try {
      const resp = await fetch('/api/ping-servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers: servers.map(s => ({ url: s.url, label: s.label })) }),
      });
      const data = await resp.json();
      data.results.forEach((r, i) => {
        const valEl = resultsEl.querySelectorAll('.ping-row')[i]?.querySelector('.ping-value');
        if (!valEl) return;
        if (r.ms === null) { valEl.textContent = 'timeout'; valEl.className = 'ping-value timeout'; }
        else { const cls = r.ms < 100 ? 'fast' : r.ms < 300 ? 'ok' : 'slow'; valEl.textContent = `${r.ms} ms`; valEl.className = `ping-value ${cls}`; }
      });
    } catch {
      resultsEl.innerHTML = '<div style="color:var(--error);font-size:0.78rem;padding:0.2rem 0">Could not reach addon server.</div>';
    }
  }
}

// ── Auto-save ─────────────────────────────────────────────────────────────
const LS_KEY = 'meb_config_v1';
let saveTimer = null;

function collectFormState() {
  const mode = document.querySelector('input[name="perf-mode"]:checked')?.value || 'normal';
  const state = {
    mode,
    timeoutValue: document.getElementById('timeout-value')?.value,
    sortOrder: document.getElementById('sort-order')?.value,
    excludeRes: [...document.querySelectorAll('.res-cb')].map(cb => cb.checked),
    recommend: document.getElementById('show-recommend')?.checked,
    showPing: document.getElementById('show-ping')?.checked,
    pingDetail: document.getElementById('ping-detail')?.checked,
    audioLang: document.getElementById('audio-lang')?.value,
    prefCodec: document.getElementById('pref-codec')?.value,
    codecMode: document.getElementById('codec-mode')?.value,
    maxBitrate: document.getElementById('max-bitrate')?.value,
    autoSelect: document.getElementById('auto-select')?.checked,
    labelPreset: document.getElementById('label-preset')?.value,
    pingOrigin: document.getElementById('ping-origin')?.value,
    showSummary: document.getElementById('show-summary')?.checked,
    summaryStyle: document.getElementById('summary-style')?.value,
    qualityBadge: document.getElementById('quality-badge')?.value || '',
    flagEmoji: document.getElementById('flag-emoji')?.value || '',
    bitrateBar: document.getElementById('bitrate-bar')?.value || '',
    subsStyle: document.getElementById('subs-style')?.value || 'full',
    showCatalog: document.getElementById('show-catalog')?.checked ?? true,
    catalogContent: document.getElementById('catalog-content')?.value || 'recent',
    rpdbKey: document.getElementById('rpdb-key')?.value.trim() || '',
    traktClientId:    document.getElementById('trakt-client-id')?.value.trim() || '',
    mdblistApiKey:    document.getElementById('mdblist-api-key')?.value.trim() || '',
    externalCatalogs: collectExternalCatalogs(),
    catalogLang: document.getElementById("catalog-lang") ? document.getElementById("catalog-lang").value : "",
    noDupes: document.getElementById("no-dupes")?.checked ?? false,
    customNameFields: Array.from(document.querySelectorAll(".cn-field:checked")).map(function(cb){return cb.value;}),
    customDescFields: Array.from(document.querySelectorAll(".cd-field:checked")).map(function(cb){return cb.value;}),
    servers: [],
  };
  document.querySelectorAll('.server-block').forEach(block => {
    state.servers.push({
      label: block.querySelector('.f-label')?.value || '',
      type: block.querySelector('.f-type')?.value || 'emby',
      url: block.querySelector('.f-url')?.value || '',
      apiKey: block.querySelector('.f-apikey')?.value || '',
      userId: block.querySelector('.f-userid')?.value || '',
      username: block.querySelector('.f-username')?.value || '',
      password: block.querySelector('.f-password')?.value || '',
      thumbnail: block.querySelector('.f-thumbnail')?.value || '',
      emoji: block.querySelector('.f-emoji')?.value || '',
      enabled: block.querySelector('.f-enabled')?.checked ?? true,
      collapsed: block.classList.contains('collapsed'),
    });
  });
  return state;
}

function saveToLocalStorage() {
  try {
    const newState = collectFormState();
    // Preserve traktClientId/mdblistApiKey if input is currently empty but we have a saved value
    const existing = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (!newState.traktClientId && existing.traktClientId) newState.traktClientId = existing.traktClientId;
    if (!newState.mdblistApiKey && existing.mdblistApiKey) newState.mdblistApiKey = existing.mdblistApiKey;
    localStorage.setItem(LS_KEY, JSON.stringify(newState));
  } catch {}
  const ind = document.getElementById('autosave-indicator');
  if (ind) { ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(() => ind.classList.remove('visible'), 1800); }
}

function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToLocalStorage, 600);
}

function restoreFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    // Fallback: recover traktClientId/mdblistApiKey/externalCatalogs from last generated config if missing
    try {
      const lastRaw = localStorage.getItem('meb-last-config');
      if (lastRaw) {
        const last = JSON.parse(atob(lastRaw.replace(/-/g,'+').replace(/_/g,'/')));
        if (!state.traktClientId && last.traktClientId) state.traktClientId = last.traktClientId;
        if (!state.mdblistApiKey && last.mdblistApiKey) state.mdblistApiKey = last.mdblistApiKey;
        if ((!state.externalCatalogs || !state.externalCatalogs.length) && last.externalCatalogs && last.externalCatalogs.length)
          state.externalCatalogs = last.externalCatalogs;
      }
    } catch(e) {}

    if (state.servers && state.servers.length > 0) {
      document.getElementById('servers-container').innerHTML = '';
      nextId = 0;
      state.servers.forEach(s => {
        const id = nextId;
        addServer(s);
        const block = document.getElementById(`server-${id}`);
        if (!block) return;
        if (s.enabled === false) {
          block.querySelector('.f-enabled').checked = false;
          block.classList.add('disabled');
        }
        if (s.collapsed) {
          block.classList.add('collapsed');
          block.querySelector('.btn-collapse').textContent = '\u25B6';
          updateSummary(id);
        }
      });
    }

    if (state.mode) {
      const radio = document.querySelector(`input[name="perf-mode"][value="${state.mode}"]`);
      if (radio) { radio.checked = true; onModeChange(); }
    }

    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.checked = v; };
    setVal('timeout-value', state.timeoutValue);
    setVal('sort-order', state.sortOrder);
    setVal('audio-lang', state.audioLang);
    setVal('pref-codec', state.prefCodec);
    setVal('codec-mode', state.codecMode);
    setVal('max-bitrate', state.maxBitrate);
    setVal('label-preset', state.labelPreset);
    setVal('ping-origin', state.pingOrigin);
    setChk('show-recommend', state.recommend);
    setChk('show-ping', state.showPing);
    setChk('ping-detail', state.pingDetail);
    setChk('auto-select', state.autoSelect);
    setChk('show-summary', state.showSummary);
    setVal('summary-style', state.summaryStyle);
    if (state.showSummary) {
      const opts = document.getElementById('summary-options');
      if (opts) opts.style.display = 'flex';
      updateSummaryPreview();
    }
    setVal('quality-badge', state.qualityBadge);
    setVal('flag-emoji', state.flagEmoji);
    setVal('bitrate-bar', state.bitrateBar);
    setVal('subs-style', state.subsStyle);
    if (state.showCatalog === false) {
      setChk('show-catalog', false);
      toggleCatalogOptions();
    }
    setVal('catalog-content', state.catalogContent);
    setVal('rpdb-key', state.rpdbKey);
    if (state.traktClientId) setVal('trakt-client-id', state.traktClientId);
    if (state.mdblistApiKey) setVal('mdblist-api-key', state.mdblistApiKey);
    if (Array.isArray(state.externalCatalogs) && state.externalCatalogs.length) {
      const catList = document.getElementById('catalog-list');
      if (catList) { catList.innerHTML = ''; nextCatId = 0; state.externalCatalogs.forEach(function(cat){ addExternalCatalog(cat); }); }
    }

    if (state.catalogLang) setVal("catalog-lang", state.catalogLang);
    if (state.noDupes) { const cb = document.getElementById("no-dupes"); if (cb) cb.checked = true; }
    if (Array.isArray(state.customNameFields) && state.customNameFields.length) {
      document.querySelectorAll(".cn-field").forEach(function(cb){ cb.checked = state.customNameFields.indexOf(cb.value) >= 0; });
    }
    if (Array.isArray(state.customDescFields) && state.customDescFields.length) {
      document.querySelectorAll(".cd-field").forEach(function(cb){ cb.checked = state.customDescFields.indexOf(cb.value) >= 0; });
    }
    toggleCustomPreset();
    if (Array.isArray(state.excludeRes)) {
      document.querySelectorAll('.res-cb').forEach((cb, i) => {
        if (i < state.excludeRes.length) cb.checked = state.excludeRes[i];
      });
    }

    return true;
  } catch { return false; }
}

// ── Init ──────────────────────────────────────────────────────────────────
if (!restoreFromLocalStorage()) addServer();
initPresets();
updateLabelPreview();
toggleCustomPreset();
restorePanelStates();
restoreActiveTab();
onShowPingChange();
toggleCatalogOptions();
updateSteps();
document.addEventListener('input', autoSave);
document.addEventListener('change', autoSave);
