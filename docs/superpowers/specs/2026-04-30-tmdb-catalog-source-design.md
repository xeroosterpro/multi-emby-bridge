# TMDB Catalog Source — Design Spec
Date: 2026-04-30

## Summary

Add TMDB (The Movie Database) as a first-class catalog provider in multi-emby-bridge, alongside the existing Trakt, MDBList, IMDb RSS, and Letterboxd providers. Supports two sub-modes: Charts (dedicated TMDB chart endpoints) and Discover (query builder with genre, rating, year, sort). Also adds a new TMDB preset bundle requiring only a TMDB API key.

---

## Backend — lib/catalogs.js

### New function: fetchTmdbCatalog(entry, tmdbApiKey)

Called from fetchExternalCatalog() when entry.provider === 'tmdb'.

Entry object shape:
  provider: 'tmdb'
  mediaType: 'movie' | 'series'
  tmdbMode: 'charts' | 'discover'
  
  Charts mode:
    tmdbChart: 'trending-day' | 'trending-week' | 'now-playing' | 'upcoming' | 'top-rated' | 'popular'
  
  Discover mode:
    tmdbGenre: string         (TMDB genre ID e.g. '28' for Action)
    tmdbMinRating: number     (0-10, e.g. 7)
    tmdbYearFrom: number      (e.g. 2010)
    tmdbYearTo: number        (e.g. 2024)
    tmdbSortBy: string        ('popularity.desc' | 'vote_average.desc' | 'primary_release_date.desc' | 'revenue.desc' | 'vote_count.desc')

### TMDB Endpoints Used

Charts mode:
  trending-day   -> /trending/{movie|tv}/day
  trending-week  -> /trending/{movie|tv}/week
  now-playing    -> /movie/now_playing  (movie only)
  upcoming       -> /movie/upcoming     (movie only)
  top-rated      -> /movie/top_rated or /tv/top_rated
  popular        -> /movie/popular or /tv/popular

Discover mode:
  /discover/movie or /discover/tv
  Params: with_genres, vote_average.gte, primary_release_date.gte/lte (movies) or first_air_date.gte/lte (TV), sort_by

### IMDb ID Resolution

TMDB list/discover endpoints return TMDB IDs, not IMDb IDs. Strategy:
1. Fetch up to 5 pages (20 items/page = 100 items max) from chart or discover endpoint.
2. Batch-resolve IMDb IDs via /movie/{id}/external_ids or /tv/{id}/external_ids in groups of 20 using Promise.all.
3. Drop items with no imdb_id.
4. Feed through existing buildMetas() — RPDB poster support works automatically.

TMDB rate limit is 50 req/s; batches of 20 are well within this.
First load for a unique row ~2-3s; subsequent loads within 10-min TTL are instant.

### Genre ID Map (hardcoded, TMDB IDs are stable)

Movies: Action=28, Adventure=12, Animation=16, Comedy=35, Crime=80, Documentary=99,
        Drama=18, Fantasy=14, History=36, Horror=27, Music=10402, Mystery=9648,
        Romance=10749, Science Fiction=878, Thriller=53, War=10752, Western=37

TV:     Action & Adventure=10759, Animation=16, Comedy=35, Crime=80, Documentary=99,
        Drama=18, Fantasy=10765, Kids=10762, Mystery=9648, Reality=10764, Western=37

### Error Handling

- No TMDB API key -> return [], log 'TMDB API key is required.'
- TMDB 401 -> log 'Invalid TMDB API key'
- now-playing or upcoming with mediaType=series -> return [] silently
- Network timeout -> same 10s timedFetch as all other providers

---

## Frontend — configure.js + configure.html

### Provider Dropdown
Add <option value="tmdb">TMDB</option> to the provider select.

### onCatalogProviderChange
When tmdb selected:
  - Hide Trakt list field and URL field
  - Show #cat-tmdb-fields block

### TMDB Block UI

  [Mode toggle: Charts | Discover]

  -- Charts mode --
  [Chart: Trending Daily | Trending Weekly | Now Playing | Upcoming | Top Rated | Popular]

  -- Discover mode --
  [Genre dropdown]  [Min Rating: ___]
  [Year From: ____] [Year To: ____]
  [Sort By: Popularity | Rating | Release Date | Revenue | Vote Count]

Behaviors:
  - Mode toggle switches visible sub-fields
  - Selecting "Now Playing" or "Upcoming" locks Media Type to "Movies" and shows note
  - Auto-name regenerates when mode/chart/fields change and name is still auto-named

### Auto-generated Row Name

Charts:  "TMDB {ChartLabel} {Movies|Shows}"       e.g. "TMDB Trending (Weekly) Movies"
Discover: "TMDB {Genre} {Movies|Shows} {rating}+" e.g. "TMDB Action Movies 7+"

### API Keys Section
New field: TMDB API Key (themoviedb.org -> Settings -> API, free)
Stored in config as tmdbApiKey, passed to fetchExternalCatalog.

---

## New Preset: TMDB

Button color: #01B4E4, letter: T

Rows:
  Trending Movies  | Charts | trending-week | movie
  Trending Shows   | Charts | trending-week | series
  Popular Movies   | Charts | popular       | movie
  Popular Shows    | Charts | popular       | series
  Top Rated Movies | Charts | top-rated     | movie
  Top Rated Shows  | Charts | top-rated     | series
  Now Playing      | Charts | now-playing   | movie
  Upcoming Movies  | Charts | upcoming      | movie

Requires only a TMDB API key. Existing presets are left unchanged.

---

## Scope

In scope:
  - fetchTmdbCatalog in lib/catalogs.js
  - TMDB provider + UI fields in configure form
  - TMDB API key field in API Keys section
  - TMDB preset
  - Auto-generated row names for TMDB rows

Out of scope:
  - Watch provider filtering (Netflix/Prime availability via TMDB)
  - Keyword include/exclude filters
  - Runtime range filter
  - Modifying existing presets to use TMDB instead of MDBList
