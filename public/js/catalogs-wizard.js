// Catalogs wizard + external catalog management (extracted from configure.js)
(function () {
  'use strict';

  function esc(t) {
    return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  const escHtml = (typeof window !== 'undefined' && window.escHtml) ? window.escHtml : esc;

  const WIZARD_STEPS = ['connect', 'library', 'discover', 'review'];
  const PRESET_CATS = {
    netflix: 'streaming', prime: 'streaming', disney: 'streaming', hulu: 'streaming',
    max: 'streaming', apple: 'streaming', kids: 'family', popular: 'charts',
    genres: 'genres', discovery: 'charts', trakt: 'charts', tmdb: 'charts',
  };
  const GALLERY_KEYS = ['netflix','prime','disney','hulu','max','apple','kids','popular','genres','discovery','trakt','tmdb'];
  const QUICK_STARTS = {
    'movie-night': { presets: ['netflix', 'popular'], maxEach: 6 },
    family: { presets: ['kids'], maxEach: 99 },
    trending: { presets: ['discovery', 'trakt'], maxEach: 5 },
  };
  const NAV_HINTS = {
    connect: 'Keys optional — skip if you only need public lists',
    library: 'Toggle rows your family actually watches',
    discover: 'Try a quick-start layout or pick services',
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

// -- Streaming Presets --
const STREAMING_PRESETS = {
  netflix: { label: "Netflix", color: "#E50914", letter: "N", catalogs: [
    { name: "Netflix Movies",  provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "8",    tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Netflix Shows",   provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "8",    tmdbSortBy: "popularity.desc", mediaType: "series" },
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
    { name: "Prime Movies",    provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "119",  tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Prime Shows",     provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "119",  tmdbSortBy: "popularity.desc", mediaType: "series" },
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
    { name: "Disney+ Movies",  provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "337",  tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Disney+ Shows",   provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "337",  tmdbSortBy: "popularity.desc", mediaType: "series" },
    { name: "Marvel Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/marvel-cinematic-universe", mediaType: "movie"  },
    { name: "Star Wars Movies",        provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/star-wars",                 mediaType: "movie"  },
    { name: "Pixar Movies",            provider: "mdblist", listUrl: "https://mdblist.com/lists/linaspurinis/pixar-movies",              mediaType: "movie"  },
    { name: "Family Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/noveggies/family",                      mediaType: "movie"  },
    { name: "Action Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/action",                  mediaType: "movie"  },
    { name: "Sci-Fi Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/sci-fi",                  mediaType: "movie"  },
    { name: "Comedy Movies",           provider: "mdblist", listUrl: "https://mdblist.com/lists/garycrawfordgc/comedy",                  mediaType: "movie"  },
  ] },
  hulu: { label: "Hulu", color: "#1CE783", letter: "H", catalogs: [
    { name: "Hulu Movies",     provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "15",   tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Hulu Shows",      provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "15",   tmdbSortBy: "popularity.desc", mediaType: "series" },
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
    { name: "Max Movies",      provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "1899", tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Max Shows",       provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "1899", tmdbSortBy: "popularity.desc", mediaType: "series" },
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
    { name: "Apple TV+ Movies", provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "350", tmdbSortBy: "popularity.desc", mediaType: "movie"  },
    { name: "Apple TV+ Shows",  provider: "tmdb", tmdbMode: "discover", tmdbWatchProvider: "350",  tmdbSortBy: "popularity.desc", mediaType: "series" },
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
  streamingcatalogs: { label: "Streaming Catalogs", color: "#111111", letter: "S", catalogs: [
    { name: "Netflix",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "nfx", catalogType: "movie",  mediaType: "movie"  },
    { name: "Netflix",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "nfx", catalogType: "series", mediaType: "series" },
    { name: "HBO Max",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "hbm", catalogType: "movie",  mediaType: "movie"  },
    { name: "HBO Max",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "hbm", catalogType: "series", mediaType: "series" },
    { name: "Disney+",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "dnp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Disney+",     provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "dnp", catalogType: "series", mediaType: "series" },
    { name: "Prime Video", provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "amp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Prime Video", provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "amp", catalogType: "series", mediaType: "series" },
    { name: "Apple TV+",   provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "atp", catalogType: "movie",  mediaType: "movie"  },
    { name: "Apple TV+",   provider: "addon", sourceUrl: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club", catalogId: "atp", catalogType: "series", mediaType: "series" },
  ] },
  topstreaming: { label: "TOP Streaming", color: "#c0392b", letter: "T", importHint: true, catalogs: [] },
  tmdb: { label: "TMDB", color: "#01B4E4", letter: "T", catalogs: [
    { name: "Trending Movies",  provider: "tmdb", tmdbMode: "charts", tmdbChart: "trending-week", mediaType: "movie"  },
    { name: "Trending Shows",   provider: "tmdb", tmdbMode: "charts", tmdbChart: "trending-week", mediaType: "series" },
    { name: "Popular Movies",   provider: "tmdb", tmdbMode: "charts", tmdbChart: "popular",       mediaType: "movie"  },
    { name: "Popular Shows",    provider: "tmdb", tmdbMode: "charts", tmdbChart: "popular",       mediaType: "series" },
    { name: "Top Rated Movies", provider: "tmdb", tmdbMode: "charts", tmdbChart: "top-rated",     mediaType: "movie"  },
    { name: "Top Rated Shows",  provider: "tmdb", tmdbMode: "charts", tmdbChart: "top-rated",     mediaType: "series" },
    { name: "Now Playing",      provider: "tmdb", tmdbMode: "charts", tmdbChart: "now-playing",   mediaType: "movie"  },
    { name: "Upcoming Movies",  provider: "tmdb", tmdbMode: "charts", tmdbChart: "upcoming",      mediaType: "movie"  },
  ] },
};

function initPresets() { /* gallery built by renderGallery() */ }
function selectPreset(key) {
  if (STREAMING_PRESETS[key] && STREAMING_PRESETS[key].importHint) {
    _selectedPreset = null;
    const ex = document.getElementById('cw-expert');
    const btn = document.getElementById('cw-expert-toggle');
    if (ex) ex.classList.add('on');
    if (btn) btn.classList.add('on');
    const el = document.getElementById('addon-import-url');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  _selectedPreset = key;
  var p = STREAMING_PRESETS[key];
  document.querySelectorAll('.cw-svc-card').forEach(function(b) { b.classList.toggle('active', b.dataset.key === key); });
  var list = document.getElementById('cw-preset-list');
  var sheet = document.getElementById('cw-preset-sheet');
  var backdrop = document.getElementById('cw-preset-backdrop');
  var sub = document.getElementById('cw-preset-sub');
  if (!list || !sheet) return;
  if (sub) sub.textContent = p.catalogs.length + ' rows · uncheck any you don\'t want';
  list.innerHTML = '';
  p.catalogs.forEach(function(cat, idx) {
    var row = document.createElement('label'); row.className = 'cw-preset-row preset-preview-item';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
    cb.className = 'preset-cb'; cb.dataset.idx = idx;
    cb.addEventListener('change', function() { updatePresetCount(); });
    var badge = document.createElement('span'); badge.className = 'preset-preview-badge preset-badge-' + cat.provider;
    badge.textContent = cat.provider === 'mdblist' ? 'MDB' : cat.provider.toUpperCase();
    var nm = document.createElement('span'); nm.className = 'preset-preview-name'; nm.textContent = cat.name;
    var tp = document.createElement('span'); tp.className = 'preset-preview-type'; tp.textContent = cat.mediaType === 'series' ? 'Shows' : 'Movies';
    row.appendChild(cb); row.appendChild(badge); row.appendChild(nm); row.appendChild(tp); list.appendChild(row);
  });
  updatePresetCount();
  sheet.classList.add('on');
  if (backdrop) backdrop.hidden = false;
  document.getElementById('cw-preset-title').textContent = p.label + ' layout';
}

function closePresetSheet() {
  var sheet = document.getElementById('cw-preset-sheet');
  var backdrop = document.getElementById('cw-preset-backdrop');
  if (sheet) sheet.classList.remove('on');
  if (backdrop) backdrop.hidden = true;
  document.querySelectorAll('.cw-svc-card').forEach(function(b) { b.classList.remove('active'); });
  _selectedPreset = null;
}
function updatePresetCount() {
  if (!_selectedPreset) return;
  var p = STREAMING_PRESETS[_selectedPreset];
  var checked = document.querySelectorAll('.preset-cb:checked').length;
  var ab = document.getElementById('btn-apply-preset');
  if (!ab) return;
  ab.textContent = '+ Add ' + checked + ' row' + (checked === 1 ? '' : 's');
  ab.style.background = p.color;
  ab.disabled = checked === 0;
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

function applyQuickStart(key) {
  var qs = QUICK_STARTS[key];
  if (!qs) return;
  var mdbKey = (document.getElementById('mdblist-api-key') || {}).value || '';
  var added = 0;
  qs.presets.forEach(function(presetKey) {
    var p = STREAMING_PRESETS[presetKey];
    if (!p || !p.catalogs) return;
    var limit = qs.maxEach || p.catalogs.length;
    for (var i = 0; i < p.catalogs.length && i < limit; i++) {
      var cat = p.catalogs[i];
      var catObj = { provider: cat.provider, listType: cat.listType || '', listUrl: cat.listUrl || '',
        mediaType: cat.mediaType || 'movie', name: cat.name, apiKey: cat.provider === 'mdblist' ? mdbKey : '', enabled: true };
      if (cat.provider === 'tmdb') {
        catObj.tmdbMode = cat.tmdbMode || 'charts';
        catObj.tmdbChart = cat.tmdbChart || '';
        catObj.tmdbWatchProvider = cat.tmdbWatchProvider || '';
        catObj.tmdbSortBy = cat.tmdbSortBy || 'popularity.desc';
      }
      if (catalogRowExists(catObj)) continue;
      addExternalCatalog(catObj);
      added++;
    }
  });
  if (added) {
    var ind = document.getElementById('autosave-indicator');
    if (ind) { ind.textContent = 'Added ' + added + ' row' + (added === 1 ? '' : 's'); ind.classList.add('visible'); clearTimeout(ind._t); ind._t = setTimeout(function(){ ind.classList.remove('visible'); ind.textContent = 'Settings saved'; }, 2500); }
    if (window.autoSave) window.autoSave();
    if (window.CatalogsWizard) window.CatalogsWizard.updateReviewUI();
    goToStep('review');
  }
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
  const badges = { trakt: 'Trakt', mdblist: 'MDbList', imdb: 'IMDb', letterboxd: 'Letterboxd', tmdb: 'TMDB' };
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
      var uid;
      if (cat.provider === 'tmdb') {
        uid = 'tmdb:' + (cat.tmdbMode || '') + ':' + (cat.tmdbWatchProvider || '') + ':' + (cat.tmdbChart || '') + ':' + (cat.mediaType || '');
      } else {
        uid = cat.listUrl || ("trakt:" + (cat.listType || ""));
      }
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
  if (!cat.count && cat.enabled !== false && cat.provider !== 'addon') testCatalog(id);
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
      if (!p || p.importHint) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cw-svc-card';
      btn.dataset.key = k;
      btn.style.background = 'linear-gradient(145deg, ' + p.color + ', color-mix(in srgb, ' + p.color + ' 55%, #000))';
      btn.innerHTML = '<span class="cw-svc-count">' + p.catalogs.length + '</span>'
        + '<div class="cw-svc-letter">' + escHtml(p.letter) + '</div>'
        + '<div class="cw-svc-label">' + escHtml(p.label) + '</div>';
      btn.addEventListener('click', () => selectPreset(k));
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

  function bindQuickStart() {
    document.querySelectorAll('.cw-qs-card').forEach(card => {
      card.addEventListener('click', () => applyQuickStart(card.dataset.qs));
    });
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
  const PROVIDER_HUES = { library: 215, trakt: 0, tmdb: 195, mdblist: 248, imdb: 45, letterboxd: 130, addon: 280 };
  const PROVIDER_LABELS = { library: 'Library', trakt: 'Trakt', tmdb: 'TMDB', mdblist: 'MDB', imdb: 'IMDb', letterboxd: 'LB', addon: 'Addon' };
  let _lastRowTotal = -1;

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
        if (chk && chk.checked) {
          previewRows.push({ title: LIB_NAMES[k] || k, kind: 'library', hue: PROVIDER_HUES.library });
        }
      });
    }
    enabled.forEach(r => {
      previewRows.push({
        title: r.name || r.provider,
        kind: r.provider || 'addon',
        hue: PROVIDER_HUES[r.provider] != null ? PROVIDER_HUES[r.provider] : 280,
      });
    });
    const empty = document.getElementById('cw-tv-empty');
    const container = document.getElementById('cw-tv-rows');
    const live = document.getElementById('cw-tv-live');
    if (!container) return;
    if (!previewRows.length) {
      if (empty) empty.style.display = '';
      if (live) live.classList.remove('on');
      container.classList.remove('on');
      container.innerHTML = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (live) live.classList.add('on');
    container.classList.add('on');
    container.innerHTML = '';
    previewRows.slice(0, 8).forEach((row, ri) => {
      const el = document.createElement('div');
      el.className = 'cw-tv-row';
      el.style.animationDelay = (ri * 0.05) + 's';
      const head = document.createElement('div');
      head.className = 'cw-tv-row-head';
      const badge = document.createElement('span');
      badge.className = 'cw-tv-badge cw-tv-badge-' + (row.kind || 'addon');
      badge.textContent = PROVIDER_LABELS[row.kind] || String(row.kind || '').toUpperCase();
      const h = document.createElement('div');
      h.className = 'cw-tv-row-title';
      h.textContent = row.title;
      head.appendChild(badge);
      head.appendChild(h);
      const posters = document.createElement('div');
      posters.className = 'cw-tv-posters';
      for (let i = 0; i < 5; i++) {
        const p = document.createElement('div');
        p.className = 'cw-tv-poster';
        p.style.setProperty('--ph', String((row.hue + i * 18) % 360));
        posters.appendChild(p);
      }
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
    document.getElementById('cw-preset-backdrop')?.addEventListener('click', closePresetSheet);
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
    bindQuickStart();
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
  window.applyQuickStart = applyQuickStart;
  window.STREAMING_PRESETS = STREAMING_PRESETS;
  window.CatalogsWizard = { init, onPageShow, goToStep, renderGallery, updateReviewUI, updateTvPreview, syncLibChips, toggleCatalogOptions, updateProgress };

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('hashchange', () => {
    if ((location.hash || '').includes('catalogs')) goToStep(parseStepFromHash());
  });
})();
