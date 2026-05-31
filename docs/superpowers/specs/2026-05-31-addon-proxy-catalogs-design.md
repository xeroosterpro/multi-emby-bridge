# Addon-Proxy Catalogs + Library Rows — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorming)

## Goal

Two related catalog enhancements:

1. **Addon-proxy provider** — let the user import and re-serve catalogs from *any* Stremio
   addon by URL. Concretely: bring in the exact catalogs from **TOP Streaming** (13 streaming
   Top-10 rows, user-configured) and **Streaming Catalogs** (10 trending-by-service rows) as
   the user's own home-screen rows, with the real daily data, because the data is fetched live
   from those addons' own catalog endpoints.
2. **Library rows incl. Next Up** — turn the single "My Library" catalog into multiple
   selectable rows (Recently Added, Continue Watching, Next Up, Favorites), adding a new
   Emby/Jellyfin **Next Up** row.

**Constraints:** No change to the install-link/manifest *format* contract beyond adding new
catalog entries; existing saved configs keep working (back-compat for the single `myemby`
catalog and existing external-catalog providers).

---

## Feature 1 — Addon-proxy provider

### Data model

A new external-catalog entry shape, stored in `cfg.externalCatalogs` alongside the existing
trakt/mdblist/tmdb/imdb/letterboxd entries:

```js
{ provider: 'addon', sourceUrl: 'https://top-streaming.stream/<id>',
  catalogId: 'netflix-movies-united-states', catalogType: 'movie',
  name: '🔴 Netflix - Top 10 United States', mediaType: 'movie' }
```

- `sourceUrl` = the source addon's base (manifest URL with `/manifest.json` stripped, no
  trailing slash).
- `catalogType` / `catalogId` = the source catalog's `type` and `id` from its manifest.
- `mediaType` = `catalogType` (each addon catalog is exactly one type — never `both`).

### Manifest

The existing `extCats` builder (`server.js` ~457) already emits one row per entry:
`{ type, id: 'extcat-' + i, name }`. An `addon` entry has `mediaType` of `movie` or `series`,
so it produces a single-type row — no builder change needed.

### Fetch path

`fetchExternalCatalog(entry, rpdbKey, traktClientId, catalogLang, tmdbApiKey)` in
`lib/catalogs.js` gets a new branch:

```js
} else if (entry.provider === 'addon') {
  return await fetchAddonCatalog(entry, rpdbKey);
}
```

New `fetchAddonCatalog(entry, rpdbKey)`:
- Build `url = entry.sourceUrl.replace(/\/$/, '') + '/catalog/' + entry.catalogType + '/' +
  encodeURIComponent(entry.catalogId) + '.json'`.
- `timedFetch(url)` (reuse the module's fetch+cache helper; cache key
  `addon:<sourceUrl>:<catalogType>:<catalogId>`, same 10-min TTL as other providers).
- Parse `metas` (Stremio standard). For each meta keep `{ id, type, name }` where `id` is the
  meta's `id` (already `tt…`), `type` = `entry.catalogType`. Poster: if `rpdbKey` is set and
  `id` starts with `tt`, override with the RPDB poster URL (same pattern as other providers);
  else keep the source `meta.poster`. Carry `description`/`releaseInfo` through when present.
- Filter to items whose `id` starts with `tt` (so stream resolution works) and dedupe by id.
- On fetch/parse error: throw (the catalog route already catches and returns an empty/჻error
  catalog, same as other providers).

Notes:
- No language filter for `addon` provider (proxied metas lack reliable language data); the
  `catalogLang` arg is ignored for this provider. Document this.
- Pagination: Top-10 rows are tiny; pass through a single page. If the catalog route receives a
  `skip` extra it is ignored for addon catalogs (acceptable — these lists are short).

### Importer endpoint

New `POST /api/addon-catalogs` (mirrors `/api/catalog/validate` style, behind `apiLimiter`):
- Body `{ manifestUrl }`. Normalize: if it doesn't end in `/manifest.json`, treat as base and
  append. Derive `baseUrl` = manifestUrl without the trailing `/manifest.json`.
- Fetch the manifest (timeout ~8s). Return
  `{ name, version, baseUrl, catalogs: manifest.catalogs.map(c => ({ type:c.type, id:c.id, name:c.name })) }`.
- On error return `{ error }` with a 4xx/502 like the other endpoints.

### Importer UI (Catalogs tab)

A new block "📥 Import from a Stremio addon" in `#page-catalogs` (mirrors the MDbList/Trakt
browse blocks):
- Input `#addon-import-url` (placeholder: paste a manifest URL) + a "Browse" button calling
  `browseAddonCatalogs()`.
- Results `#addon-import-results`: the fetched catalog list rendered as checkbox rows (name +
  type pill), a "select all" affordance, and an "Add selected" button.
- "Add selected" creates an `addon`-provider entry per checked catalog via the existing
  `addExternalCatalog(cat)` path (so it lands in `#catalog-list`, persists, and flows into
  `collectExternalCatalogs()` / the generated config unchanged).

### Presets

In `STREAMING_PRESETS` (configure.js):
- **`streamingcatalogs`** — a real one-click preset (static URL). Its catalogs are baked from
  the known manifest (`https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club`):
  ids `nfx,hbm,dnp,amp,atp`, each `movie` + `series`, names Netflix / HBO Max / Disney+ /
  Prime Video / Apple TV+. Each preset catalog is
  `{ name, provider:'addon', sourceUrl:'…baby-beamup.club', catalogId, catalogType, mediaType }`.
- **`topstreaming`** — a preset button that, because the URL contains a per-user id, focuses the
  importer input and shows a hint ("paste your TOP Streaming manifest URL, then Add all"). It
  does not bake catalogs (can't know the user's id). This keeps it one click to the right place.

The preset apply flow already turns preset catalog objects into rows via `applyPreset`; an
`addon` preset catalog object carries the extra `sourceUrl/catalogId/catalogType` fields, which
`addExternalCatalog` must persist (extend it to copy those fields when `provider==='addon'`).

---

## Feature 2 — Library rows (Recently Added / Continue Watching / Next Up / Favorites)

### Data model

Replace the single `cfg.catalogContent` string with `cfg.libraryRows` — an array of enabled
row keys, e.g. `['recent','resume','nextup','favorites']`. Back-compat: if `libraryRows` is
absent but `catalogContent` exists, treat it as `[catalogContent]`; if neither and
`showCatalog !== false`, default to `['recent']`.

Row keys → display names: `recent`→"Recently Added", `resume`→"Continue Watching",
`nextup`→"Next Up", `favorites`→"Favorites".

### Manifest

Emit one catalog per enabled library row per type, with stable ids `myemby-<key>`:

```js
(cfg.libraryRows || deriveLegacy(cfg)).forEach(key => {
  ['movie','series'].forEach(type => {
    catalogs.push({ type, id: 'myemby-' + key, name: ROW_NAMES[key],
      extra: [{ name: 'search', isRequired: cfg.showCatalog === false }] });
  });
});
```

Keep the legacy `myemby` id handled in the catalog routes for old installs (maps to
`cfg.catalogContent`). Note: `nextup` is meaningful for `series` type; for `movie` type it
returns empty (Next Up is episodes). The manifest may still emit a movie `myemby-nextup` for
uniformity, but it resolves to an empty list — OR (preferred) only emit `nextup` for `series`.
**Decision:** emit `myemby-nextup` for `series` only.

### Catalog routes

In both catalog route handlers (`server.js` ~497–556), when `req.params.id` starts with
`myemby-`, parse the key (`id.slice('myemby-'.length)`) and call
`getRecentlyAdded(servers, type, 8000, rpdbKey, key, catalogLang)`. The legacy `myemby` id keeps
using `cfg.catalogContent || 'recent'`.

### Next Up fetch

Extend `getRecentlyAdded` (lib/search.js) to handle `catalogContent === 'nextup'`:
- Only meaningful for `type === 'series'`; for `movie` return `[]`.
- Per server: `GET ‹url›/Shows/NextUp?UserId=‹userId›&Limit=24&Fields=ProviderIds,SeriesId,
  SeriesName` (auth via existing `apiFetch`). Items are episodes with `SeriesId`/`SeriesName`.
- Collect unique `SeriesId`s, then one lookup per server:
  `GET ‹url›/Users/‹userId›/Items?Ids=‹id1,id2,…›&Fields=ProviderIds&IncludeItemTypes=Series`
  to get each series' `ProviderIds.Imdb`.
- Map to series metas `{ id: seriesImdb, type:'series', name: SeriesName, poster: RPDB(seriesImdb) }`,
  dedupe by imdb, preserve NextUp ordering, slice to 20.
- Reuse the existing poster/RPDB and dedupe patterns already in `getRecentlyAdded`.

### Library UI (Catalogs tab, "My Library" block)

Replace the single `#catalog-content` select with a multi-select control (switches or a
`.chips` group via the compact toolkit) for the four rows, each toggling membership in
`cfg.libraryRows`. Keep `#show-catalog` (the master on/off). The hidden canonical for each row
is a checkbox the toolkit binds to; `collectConfig` builds `libraryRows` from the checked ones.
Preserve a hidden legacy `#catalog-content` only if needed for back-compat read; new saves write
`libraryRows`.

---

## Files touched

- `lib/catalogs.js` — `fetchAddonCatalog` + `addon` branch in `fetchExternalCatalog`.
- `lib/search.js` — `nextup` branch in `getRecentlyAdded` (+ series-imdb resolution helper).
- `server.js` — `POST /api/addon-catalogs`; manifest emits `myemby-<key>` rows + addon extcats
  (already handled by extCats); catalog routes parse `myemby-<key>`; keep legacy `myemby`.
- `public/js/configure.js` — `browseAddonCatalogs()`, addon entries in `addExternalCatalog`,
  `streamingcatalogs`/`topstreaming` presets, library multi-row collect/restore.
- `public/configure.html` — importer block + library multi-row control in `#page-catalogs`.
- `public/css/configure.css` — minor styling for the importer results / library rows (reuse
  toolkit classes where possible).

## Out of scope

- No FlixPatrol/JustWatch scraper (the proxy makes it unnecessary).
- No pagination/search passthrough for addon catalogs (lists are short).
- No change to stream resolution, health, or non-catalog features.

## Risks

- **Source-addon availability:** addon catalogs break if the source addon is offline or rotates
  its per-user id. Same dependency the user already has by installing those addons; the fetch
  path fails gracefully (empty/error catalog) like other providers.
- **Next Up imdb mapping:** series without an IMDb ProviderId in Emby are dropped (can't resolve
  to a `tt` id). Acceptable; matches how the other library rows already require `tt` ids.
