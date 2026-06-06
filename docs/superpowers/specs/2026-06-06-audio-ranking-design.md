# Audio Ranking & Filtering — Design

**Date:** 2026-06-06
**Status:** Approved (pending written-spec review)
**Area:** Stream result ordering & filtering (`lib/streams.js`, new `lib/audioRanking.js`, `server.js`, configure UI)

## 1. Summary

Give users control over how audio formats affect stream results in Stremio, via a new
**Audio** card on the configure page's Streaming tab. Three independent capabilities:

1. **Ranking** (master on/off) — reorder results so preferred audio formats appear first,
   using a user-defined priority order across 11 canonical formats.
2. **Disabling** — per-format toggles that either **hide** matching files or **send them to
   the bottom** of results. Works **independently of the ranking toggle**.
3. **Device presets** — multi-select device profiles that auto-populate the order + disabled
   set based on typical decode/passthrough support (intersection across selected devices).

**Non-negotiable constraint:** the addon's existing behavior must be preserved exactly when
the feature is left at defaults. The feature is **default-off and additive**. It changes
*only the order and membership of stream results* — never how streams are built, fetched,
authenticated, or played.

## 2. Background — current behavior

Relevant existing code:

- `lib/streams.js` `mediaSourcesToStreams()` builds a stream object per Emby/Jellyfin
  `MediaSource`. It already derives an audio codec name and a hardcoded `_audioRank`
  (Atmos/TrueHD = 0 … AAC = 6 … other = 7), with channel count as a within-format tiebreaker
  (`audioRank = audioRank * 10 - channels`). The **first** audio stream drives this today.
- `lib/streams.js` `getAllStreams()` filters (excluded resolutions, max bitrate, codec "Only")
  and sorts. The sort comparator order today is: preferred audio **language** → preferred
  **codec** (prefer mode) → `sortOrder` branch (`size` | `audio` | `bitrate`). Legacy
  `sortOrder === 'audio'` uses `_audioRank`.
- Config is a free-form JSON blob persisted by `lib/userConfig.js` and **also base64-encoded
  into the Stremio manifest URL** (`encodeConfig` in `public/js/configure.js`). Only
  non-default keys are stored, to keep URLs short.
- `server.js` (~line 720) maps the stored config into the `opts` object passed to
  `getAllStreams()`.
- The configure UI (`public/configure.html` + `public/js/configure.js`) uses a "styled control
  mirrors a hidden-canonical input" pattern; `collectConfig`/save-builders read the DOM,
  `populateFromConfig` restores it, and a live-preview `buildState` mirrors settings.

## 3. Format taxonomy (single source of truth)

Defined once in `lib/audioRanking.js` as `AUDIO_FORMATS`, an ordered array (default priority,
top = highest). Each row:

```js
{ id, token, label, cat, chans }
```

| # | id | token | label | category | channel hint |
|---|----|-------|-------|----------|--------------|
| 1 | `atmos` | `atm` | Dolby Atmos | object | 7.1 + height (object) |
| 2 | `dtsx` | `dtx` | DTS:X | object | 7.1 + height (object) |
| 3 | `truehd` | `thd` | Dolby TrueHD | lossless | up to 7.1 |
| 4 | `dtshd_ma` | `dma` | DTS-HD MA | lossless | up to 7.1 |
| 5 | `lpcm` | `pcm` | LPCM | lossless | 2.0 – 7.1 |
| 6 | `flac` | `flc` | FLAC | lossless | 2.0 – 7.1 |
| 7 | `ddplus` | `ddp` | Dolby Digital+ | lossy | up to 7.1 |
| 8 | `dts` | `dts` | DTS | lossy | 5.1 |
| 9 | `dd` | `dd` | Dolby Digital | lossy | 5.1 |
| 10 | `aac` | `aac` | AAC | lossy | 2.0 / 5.1 |
| 11 | `other` | `oth` | Other | — | varies |

Categories (`object` / `lossless` / `lossy`) are **visual section labels only** in the default
order; the priority list is a single flat list and any row may be dragged anywhere.

### 3.1 `classifyAudio(codec, profile) -> id`

Table-driven, derived from the existing detection and extended for DTS:X / LPCM / FLAC.
`codec`/`profile` are lower-cased first.

- `truehd` present → profile has `atmos` ? `atmos` : `truehd`
- `eac3` / `e-ac-3` present → profile has `atmos` ? `atmos` : `ddplus`
- `dts` present → profile has `dts:x`/`dtsx`/`dts-x` ? `dtsx`
  : (codec/profile has `ma`/`master`, or codec is `dtshd`) ? `dtshd_ma`
  : `dts`
- `pcm`/`lpcm` → `lpcm`
- `flac` → `flac`
- `ac3` → `dd`
- `aac` → `aac`
- else → `other`

**Detection caveat (must validate during implementation):** DTS:X, LPCM, and FLAC depend on
what the user's Emby/Jellyfin servers actually report in `Codec`/`Profile`. Real values will be
inspected against live servers; any format that isn't distinctly exposed falls back to its
nearest parent (e.g. DTS:X → DTS-HD MA, undetected lossless → its codec row). The classifier is
written so unknown inputs degrade to `other`, never throw.

## 4. Engine design (`lib/audioRanking.js`)

The module owns the entire audio concern. Exports:

```
AUDIO_FORMATS                                  // the taxonomy table above
DEFAULT_ORDER                                  // ['atmos','dtsx',...,'other'] (ids)
AUDIO_PRESETS                                  // device profiles (§7)
classifyAudio(codec, profile) -> id
resRank(resLabel) -> 0|1|2|3                   // 4K=0,1080p=1,720p=2, else 3
tokensToIds(tokens) / idsToTokens(ids)         // URL-compact <-> internal
resolveOrder(audioOrder) -> id[]               // user order if valid, else DEFAULT_ORDER, always all 11
buildAudioKeys(stream, order, disabledSet) -> { audioIdx, isDisabledClass, bestFormat }
applyAudioRanking(streams, opts) -> { streams, hiddenFallback }
resolvePreset(deviceIds[]) -> { order, disabled, action }   // intersection logic (§7)
```

### 4.1 Classification (config-independent)

In `mediaSourcesToStreams()`, add one field per stream — no other build changes:

```js
_audioFormats: [...new Set(audioStreams.map(s => classifyAudio(s.Codec, s.Profile)))]
```

`_audioRank` (legacy) is left intact for backward compatibility with `sortOrder === 'audio'`.

### 4.2 Per-stream keys (config-aware)

In `getAllStreams()`, after the existing resolution/bitrate/codec filters, compute via
`buildAudioKeys(stream, order, disabledSet)` where `order = resolveOrder(opts.audioOrder)`:

- **`bestFormat`** = the format in `_audioFormats` with the lowest index in `order`
  (the "best track" — always defined; uses the effective order even when ranking is off).
- **`audioIdx`** = `order.indexOf(bestFormat)`.
- **`isDisabledClass`** = `disabledSet.has(bestFormat)`.
- **`_demoted`** = `isDisabledClass && action === 'bottom' ? 1 : 0`.

Rationale for "best track": a file is represented by its headline audio everywhere, for both
ranking and disable, giving one consistent rule (no separate multi-track control). A *kept*
(non-disabled) file is therefore always sorted by an *enabled* track.

### 4.3 Filtering (hide)

If `action === 'hide'` and `disabledSet` is non-empty, drop streams where `isDisabledClass`.
**Hide-to-zero safety net:** if this empties a title's real-stream list, restore the pre-filter
list and set `hiddenFallback = true` (mirrors the existing codec-"Only" fallback). A title is
never left empty by this feature. The UI surfaces a small hint that this fallback can occur.

### 4.4 Comparator tiers

Inserted into the existing `getAllStreams` sort. First non-zero result wins:

| Tier | Comparison | Active when |
|------|-----------|-------------|
| 0 | `a._demoted - b._demoted` (disabled-class → bottom) | disabled set non-empty **and** action = `bottom`; **independent of master toggle** |
| 1 | language match (existing `audioLang`) | `audioLang` set |
| 2 | preferred codec, prefer mode (existing) | `prefCodec` set, mode ≠ only |
| 3a | `audioIdx` ↑, then existing `sortOrder` (size/bitrate) | ranking ON, `audioRankMode = audioFirst` |
| 3b | `resRank` ↑, then `audioIdx` ↑, then size ↓ | ranking ON, `audioRankMode = resFirst` |
| 3c | existing `sortOrder` primary, then `audioIdx` ↑ | ranking ON, `audioRankMode = tiebreak` |
| 4 | existing default sort (size → legacy `_audioRank` → bitrate) | ranking OFF / fallthrough |

**Key property:** with all-defaults (`audioRank=false`, no disabled, action=`hide`), tier 0 is
all-zero and tiers 3a–c are skipped → the comparator reduces to today's exact behavior. Tier 0
sitting above the ranking tier is what makes **disable work with ranking off**.

## 5. Config schema

New keys on the config blob, **stored only when non-default** (URL compactness preserved):

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `audioRank` | bool | `false` | master ranking toggle |
| `audioOrder` | string[] (tokens) | omitted (= `DEFAULT_ORDER`) | only stored if reordered; e.g. `["atm","dtx","thd",…]` |
| `audioDisabled` | string[] (tokens) | `[]` | disabled formats |
| `audioRankMode` | `audioFirst`\|`resFirst`\|`tiebreak` | `audioFirst` | stored only if ranking on and non-default |
| `audioDisableAction` | `hide`\|`bottom` | `hide` | |

Stored as short **tokens**, converted to ids server-side via `tokensToIds`. Round-trips through
`encodeConfig`, `userConfig.getForServe/getEditable`, and the split-mode per-server builder with
no schema migration (free-form JSON blob). Unknown/garbage tokens are ignored by `resolveOrder`
(falls back to default), so malformed URLs never break stream serving.

## 6. Backend wiring

- **`lib/audioRanking.js`** — new module (§3, §4, §7). Pure, no I/O, fully unit-testable.
- **`lib/streams.js`** — `require` the module; add `_audioFormats` in `mediaSourcesToStreams`;
  in `getAllStreams` compute audio keys, apply the hide filter, and extend the comparator per
  §4.4. Add the new `_`-prefixed fields to the existing final `.map()` strip so they never leak
  to Stremio.
- **`server.js`** — pass `audioRank`, `audioOrder`, `audioDisabled`, `audioRankMode`,
  `audioDisableAction` into the `getAllStreams(...)` opts (alongside the existing keys ~line
  720). Add `GET /api/audio-formats` returning `AUDIO_FORMATS` + `AUDIO_PRESETS` (JSON) so the
  configure UI's list, channel hints, and preset matrix come from the same source as the
  classifier and can never drift.

No changes to auth, search, manifest, catalogs, billing, or playback.

## 7. Device presets

`AUDIO_PRESETS` — each device maps to a **supported-format set**; the disabled set for a single
device is `all formats − supported`. Starter matrix (best-effort decode/passthrough support,
documented in-UI as "based on typical support — adjust to your gear"):

| Preset id | Disables (not reliably supported) |
|-----------|-----------------------------------|
| `appletv` — Apple TV 4K | — |
| `shield` — Nvidia Shield | — |
| `chromecast` — Chromecast w/ Google TV | TrueHD, DTS-HD MA, DTS:X, LPCM |
| `soundbar` — Generic eARC soundbar | LPCM |
| `sonos` — Sonos (Arc/Beam) | DTS:X, DTS-HD MA, LPCM |
| `firestick` — Firestick 4K / Max | TrueHD, DTS-HD MA, DTS:X, LPCM |
| `browser` — Web browser | Atmos, DTS:X, TrueHD, DTS-HD MA, LPCM, DTS, DD+ |
| `phone` — Phone / tablet | Atmos, DTS:X, TrueHD, DTS-HD MA, LPCM |

### 7.1 Multi-select intersection

The preset control is a **multi-select** (device chips). `resolvePreset(deviceIds[])`:

- **0 selected** → no change (Custom).
- **1 selected** → that device's disabled set; default action `hide`.
- **2+ selected** → **intersection of support**: a format is disabled if **any** selected
  device cannot play it (lowest common denominator). To avoid gutting the library across
  disparate devices, multi-select **defaults the action to `bottom`** (send to bottom, nothing
  lost). 
- In all cases the resulting **order** places enabled formats first (by default quality order),
  disabled formats sink to the end, and `audioRank` is flipped on.

Selecting preset(s) **populates** the list/toggles; the user can freely tweak afterward. Presets
are a convenience layer that writes the same `order` + `disabled` + `action` fields the manual
controls produce — **zero engine change**.

## 8. Frontend — the Audio card

New card in the Streaming page (`public/configure.html`), below "Prefer audio language",
following existing field / `hidden-canonical` conventions:

- **Header:** master toggle "🔊 Audio ranking" (off by default) + **Device preset** multi-select
  (device chips). A small note: "Presets reflect typical decode support — adjust to your gear."
- **Priority list:** 11 draggable rows under 3 visual category labels (Object-Based / Lossless /
  Lossy). Each row: drag handle ⠿, format label, muted channel hint, and a disable toggle.
  Implemented as **vanilla pointer-based drag-reorder** (no new dependency — matches the repo's
  dep-light approach). Reorder animation is gated behind `prefers-reduced-motion`.
- **Two dropdowns:** "Priority mode" (Audio first / Resolution first / Tiebreaker) and
  "When disabled" (Hide file / Send to bottom).
- The list is **always editable**; the master toggle only gates whether *reordering* affects
  results. Disable toggles act regardless — an inline hint explains this, and mentions the
  hide-to-zero fallback.

`public/js/configure.js`:

- `collectConfig` / both save-builders (normal + split, ~lines 1845–1965): read `audioRank`,
  `audioOrder` (current DOM order of rows), `audioDisabled` (toggled rows), `audioRankMode`,
  `audioDisableAction`; emit only non-defaults.
- `populateFromConfig` (~1488): restore master toggle, row order, disabled toggles, dropdowns.
- Live-preview `buildState` (~2090): include the new fields so the preview reflects them.
- On load, fetch `/api/audio-formats` to render rows + preset chips (single source of truth).

## 9. Testing & verification

- **New `test/audioRanking.test.js`:**
  - `classifyAudio` mapping table — every codec/profile incl. Atmos-on-TrueHD vs Atmos-on-DD+,
    DTS:X, DTS-HD MA vs plain DTS, LPCM, FLAC, empty/unknown → `other`.
  - `buildAudioKeys` — multi-track best-track selection; disabled-class detection;
    order-dependent best (e.g. AC3 ranked above TrueHD).
  - Comparator across all 3 modes (audioFirst / resFirst / tiebreak).
  - Hide vs send-to-bottom; hide-to-zero fallback.
  - `resolvePreset` single + multi-select intersection; action defaulting.
- **Extend `test/streams.test.js`:** assert `_audioFormats` is attached; `getAllStreams`
  ordering matches expectations with audio opts; **and an all-defaults guard asserting output
  order is unchanged from current behavior** (backward-compat).
- Add `test/audioRanking.test.js` to the `npm test` chain in `package.json`.
- Manual verification: run locally, confirm the card saves/round-trips through the manifest URL,
  and spot-check ordering against a real library before pushing to `main`.

## 10. Backward compatibility & rollout

- Default-off; all new config keys additive and stored only when non-default.
- Existing manifest URLs and saved configs continue to work untouched (no migration).
- Malformed audio config degrades gracefully (default order, never throws).
- Deploying live on `main` (auto-deploy to Railway) is acceptable: with defaults, results are
  byte-for-byte identical to current behavior, guarded by the all-defaults test.

## 11. Out of scope

- Changing how audio is *transcoded* or *played* (this only orders/filters results).
- Per-server audio settings (uses the existing global config; split-mode inherits per server).
- Auro-3D as a distinct row (folded into `other` — not reliably exposed by Emby/Jellyfin).
