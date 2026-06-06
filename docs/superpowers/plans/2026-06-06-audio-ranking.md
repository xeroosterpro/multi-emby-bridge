# Audio Ranking & Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users rank, disable (hide / send-to-bottom), and apply device presets to audio formats so Stremio stream results are ordered/filtered to their preference — default-off and additive.

**Architecture:** A new pure module `lib/audioRanking.js` owns the taxonomy, classifier, sort comparator, disable filter, and presets. `lib/streams.js` attaches a config-independent `_audioFormats` set during stream-building and delegates ordering/filtering to the module in `getAllStreams`. `server.js` threads 5 new config keys through and serves the taxonomy at `GET /api/audio-formats`. The configure page gains an Audio card driven by that endpoint.

**Tech Stack:** Node 18+, Express 4, vanilla browser JS (no new deps). Tests are plain `node test/*.test.js` scripts using local `assert`/`assertEqual` helpers.

**Spec:** `docs/superpowers/specs/2026-06-06-audio-ranking-design.md`

**Working branch:** `main` (per project owner instruction — auto-deploys to Railway; safe because defaults reproduce current behavior, guarded by a backward-compat test).

---

## File Structure

- **Create** `lib/audioRanking.js` — taxonomy (`AUDIO_FORMATS`, `DEFAULT_ORDER`), `classifyAudio`, `resRank`, token converters, `resolveOrder`, `buildAudioKeys`, `attachAudioKeys`, `compareSortOrder`, `audioComparator`, `filterDisabledHide`, `AUDIO_PRESETS`, `resolvePreset`. Pure, no I/O.
- **Create** `test/audioRanking.test.js` — unit tests for the module.
- **Modify** `lib/streams.js` — add `_audioFormats` in `mediaSourcesToStreams`; in `getAllStreams` attach keys, filter, sort via the module; strip new internal fields.
- **Modify** `test/streams.test.js` — assert `_audioFormats` is attached.
- **Modify** `server.js` — pass 5 new opts into `getAllStreams`; add `GET /api/audio-formats`.
- **Modify** `public/configure.html` — the Audio card markup.
- **Modify** `public/js/configure.js` — fetch taxonomy, render list + preset chips, drag-reorder, collect/populate/buildState.
- **Modify** `package.json` — add `test/audioRanking.test.js` to the `test` script.

---

## Task 1: Module skeleton — taxonomy, tokens, order, resRank

**Files:**
- Create: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/audioRanking.test.js`:

```js
// ─── Unit tests for lib/audioRanking.js ──────────────────────────────────────
// Run with: node test/audioRanking.test.js
const A = require('../lib/audioRanking');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else      { console.error(`  ✗ ${msg}`); failed++; }
}
function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✓ ${msg}`); passed++; }
  else    { console.error(`  ✗ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed++; }
}

console.log('\nTaxonomy & order:');
assertEqual(A.AUDIO_FORMATS.length, 11, '11 formats defined');
assertEqual(A.DEFAULT_ORDER, ['atmos','dtsx','truehd','dtshd_ma','lpcm','flac','ddplus','dts','dd','aac','other'], 'default order ids');
assert(A.AUDIO_FORMATS.every(f => f.id && f.token && f.label && f.chans), 'every row has id/token/label/chans');

console.log('\nToken converters:');
assertEqual(A.idsToTokens(['atmos','aac']), ['atm','aac'], 'idsToTokens');
assertEqual(A.tokensToIds(['atm','aac']), ['atmos','aac'], 'tokensToIds');
assertEqual(A.tokensToIds(['atm','BOGUS','aac']), ['atmos','aac'], 'tokensToIds drops unknown tokens');

console.log('\nresolveOrder:');
assertEqual(A.resolveOrder(undefined), A.DEFAULT_ORDER, 'undefined -> default order');
assertEqual(A.resolveOrder(['aac','atm']).slice(0,2), ['aac','atmos'], 'user order honored, then defaults appended');
assertEqual(A.resolveOrder(['aac','atm']).length, 11, 'resolveOrder always returns all 11 ids');
assertEqual(A.resolveOrder(['BOGUS']), A.DEFAULT_ORDER, 'all-garbage -> default order');

console.log('\nresRank:');
assertEqual(A.resRank('4K'), 0, '4K -> 0');
assertEqual(A.resRank('1080p'), 1, '1080p -> 1');
assertEqual(A.resRank('720p'), 2, '720p -> 2');
assertEqual(A.resRank(null), 3, 'null -> 3');
assertEqual(A.resRank('480p'), 3, 'other -> 3');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `Cannot find module '../lib/audioRanking'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/audioRanking.js`:

```js
// ─── Audio format taxonomy, classification, ranking & presets ────────────────
// Pure module (no I/O). Single source of truth for audio formats, shared by the
// stream sorter (lib/streams.js) and the configure UI (via GET /api/audio-formats).

// Canonical ordered list — default priority, top = highest.
const AUDIO_FORMATS = [
  { id: 'atmos',    token: 'atm', label: 'Dolby Atmos',   cat: 'object',   chans: '7.1 + height (object)' },
  { id: 'dtsx',     token: 'dtx', label: 'DTS:X',         cat: 'object',   chans: '7.1 + height (object)' },
  { id: 'truehd',   token: 'thd', label: 'Dolby TrueHD',  cat: 'lossless', chans: 'up to 7.1' },
  { id: 'dtshd_ma', token: 'dma', label: 'DTS-HD MA',     cat: 'lossless', chans: 'up to 7.1' },
  { id: 'lpcm',     token: 'pcm', label: 'LPCM',          cat: 'lossless', chans: '2.0 – 7.1' },
  { id: 'flac',     token: 'flc', label: 'FLAC',          cat: 'lossless', chans: '2.0 – 7.1' },
  { id: 'ddplus',   token: 'ddp', label: 'Dolby Digital+',cat: 'lossy',    chans: 'up to 7.1' },
  { id: 'dts',      token: 'dts', label: 'DTS',           cat: 'lossy',    chans: '5.1' },
  { id: 'dd',       token: 'dd',  label: 'Dolby Digital', cat: 'lossy',    chans: '5.1' },
  { id: 'aac',      token: 'aac', label: 'AAC',           cat: 'lossy',    chans: '2.0 / 5.1' },
  { id: 'other',    token: 'oth', label: 'Other',         cat: 'other',    chans: 'varies' },
];

const DEFAULT_ORDER = AUDIO_FORMATS.map(f => f.id);
const ID_BY_TOKEN = Object.fromEntries(AUDIO_FORMATS.map(f => [f.token, f.id]));
const TOKEN_BY_ID = Object.fromEntries(AUDIO_FORMATS.map(f => [f.id, f.token]));

function idsToTokens(ids) {
  return (ids || []).map(id => TOKEN_BY_ID[id]).filter(Boolean);
}
function tokensToIds(tokens) {
  return (tokens || []).map(t => ID_BY_TOKEN[t]).filter(Boolean);
}

// Always returns all 11 ids: the user's valid order first, then any missing ids
// in default order. Garbage/empty -> DEFAULT_ORDER.
function resolveOrder(audioOrderTokens) {
  const fromUser = tokensToIds(audioOrderTokens);
  if (fromUser.length === 0) return DEFAULT_ORDER.slice();
  const seen = new Set(fromUser);
  return [...fromUser, ...DEFAULT_ORDER.filter(id => !seen.has(id))];
}

function resRank(resLabel) {
  if (resLabel === '4K') return 0;
  if (resLabel === '1080p') return 1;
  if (resLabel === '720p') return 2;
  return 3;
}

module.exports = {
  AUDIO_FORMATS, DEFAULT_ORDER,
  idsToTokens, tokensToIds, resolveOrder, resRank,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — all assertions, `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): taxonomy, token converters, resolveOrder, resRank"
```

---

## Task 2: `classifyAudio` — codec/profile → format id

**Files:**
- Modify: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/audioRanking.test.js`, BEFORE the final summary `console.log`:

```js
console.log('\nclassifyAudio:');
assertEqual(A.classifyAudio('truehd', 'Atmos'), 'atmos', 'TrueHD+Atmos -> atmos');
assertEqual(A.classifyAudio('truehd', ''), 'truehd', 'TrueHD plain -> truehd');
assertEqual(A.classifyAudio('eac3', 'Dolby Atmos'), 'atmos', 'EAC3+Atmos -> atmos');
assertEqual(A.classifyAudio('eac3', ''), 'ddplus', 'EAC3 plain -> ddplus');
assertEqual(A.classifyAudio('dca', 'DTS:X'), 'dtsx', 'DTS profile DTS:X -> dtsx');
assertEqual(A.classifyAudio('dts', 'DTS-HD MA'), 'dtshd_ma', 'DTS profile MA -> dtshd_ma');
assertEqual(A.classifyAudio('dtshd', ''), 'dtshd_ma', 'dtshd codec -> dtshd_ma');
assertEqual(A.classifyAudio('dts', ''), 'dts', 'DTS plain -> dts');
assertEqual(A.classifyAudio('pcm_s24le', ''), 'lpcm', 'pcm -> lpcm');
assertEqual(A.classifyAudio('flac', ''), 'flac', 'flac -> flac');
assertEqual(A.classifyAudio('ac3', ''), 'dd', 'ac3 -> dd');
assertEqual(A.classifyAudio('aac', ''), 'aac', 'aac -> aac');
assertEqual(A.classifyAudio('opus', ''), 'other', 'opus -> other');
assertEqual(A.classifyAudio('', ''), 'other', 'empty -> other');
assertEqual(A.classifyAudio(null, null), 'other', 'null -> other (no throw)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `A.classifyAudio is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/audioRanking.js`, add the function above `module.exports`:

```js
// Map a single audio track's codec + profile to a canonical format id.
// Inputs may be null/undefined; output is always one of the 11 ids.
function classifyAudio(codec, profile) {
  const c = (codec || '').toLowerCase();
  const p = (profile || '').toLowerCase();
  const isAtmos = p.includes('atmos');

  if (c.includes('truehd')) return isAtmos ? 'atmos' : 'truehd';
  if (c.includes('eac3') || c.includes('e-ac-3')) return isAtmos ? 'atmos' : 'ddplus';
  if (c.includes('dts') || c === 'dca') {
    if (p.includes('dts:x') || p.includes('dtsx') || p.includes('dts-x')) return 'dtsx';
    if (c.includes('ma') || c === 'dtshd' || p.includes('ma') || p.includes('master')) return 'dtshd_ma';
    return 'dts';
  }
  if (c.includes('pcm')) return 'lpcm';
  if (c.includes('flac')) return 'flac';
  if (c === 'ac3' || c.includes('ac-3')) return 'dd';
  if (c.includes('aac')) return 'aac';
  return 'other';
}
```

Add `classifyAudio` to the `module.exports` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): classifyAudio codec/profile -> format id"
```

---

## Task 3: `buildAudioKeys` + `attachAudioKeys` — per-file best track & disabled class

**Files:**
- Modify: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/audioRanking.test.js` before the summary:

```js
console.log('\nbuildAudioKeys:');
const order = A.DEFAULT_ORDER; // atmos best ... other worst
// File with TrueHD + AC3: best track = truehd (idx 2)
let k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, order, new Set());
assertEqual(k.bestFormat, 'truehd', 'best of [truehd,dd] = truehd');
assertEqual(k.audioIdx, 2, 'truehd idx = 2');
assertEqual(k.isDisabledClass, false, 'not disabled when nothing disabled');
// Disable truehd -> the TrueHD+AC3 file is disabled-class (best track disabled)
k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, order, new Set(['truehd']));
assertEqual(k.isDisabledClass, true, 'disabled-class when best track disabled');
// Custom order: AC3 ranked above TrueHD -> best becomes dd, not disabled
const ddFirst = A.resolveOrder(['dd','thd']);
k = A.buildAudioKeys({ _audioFormats: ['truehd','dd'] }, ddFirst, new Set(['truehd']));
assertEqual(k.bestFormat, 'dd', 'best follows user order (dd first)');
assertEqual(k.isDisabledClass, false, 'not disabled — best track (dd) is enabled');
// No audio formats at all
k = A.buildAudioKeys({ _audioFormats: [] }, order, new Set());
assertEqual(k.bestFormat, null, 'no formats -> bestFormat null');
assertEqual(k.audioIdx, 99, 'no formats -> audioIdx 99 (sorts last)');

console.log('\nattachAudioKeys:');
const streams = [
  { _audioFormats: ['atmos'], _resLabel: '1080p' },
  { _audioFormats: ['aac'],   _resLabel: '4K' },
];
A.attachAudioKeys(streams, { audioOrder: undefined, audioDisabled: ['aac'], audioDisableAction: 'bottom' });
assertEqual(streams[0]._audioIdx, 0, 'atmos stream idx 0');
assertEqual(streams[1]._isDisabledClass, true, 'aac stream disabled-class');
assertEqual(streams[1]._demoted, 1, 'aac stream demoted (action=bottom)');
assertEqual(streams[0]._demoted, 0, 'atmos stream not demoted');
assertEqual(streams[1]._resRank, 0, 'resRank attached (4K=0)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `A.buildAudioKeys is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/audioRanking.js`, add above `module.exports`:

```js
// Compute per-file audio sort keys given the effective order + disabled set.
// "Best track" = the file's format with the lowest (best) index in `order`.
function buildAudioKeys(stream, order, disabledSet) {
  const formats = stream._audioFormats || [];
  if (formats.length === 0) {
    return { bestFormat: null, audioIdx: 99, isDisabledClass: false };
  }
  let bestFormat = formats[0];
  let bestIdx = order.indexOf(bestFormat);
  if (bestIdx < 0) bestIdx = order.length;
  for (const f of formats) {
    let idx = order.indexOf(f);
    if (idx < 0) idx = order.length;
    if (idx < bestIdx) { bestIdx = idx; bestFormat = f; }
  }
  return {
    bestFormat,
    audioIdx: bestIdx,
    isDisabledClass: disabledSet.has(bestFormat),
  };
}

// Mutate each stream with _audioIdx, _isDisabledClass, _demoted, _resRank.
function attachAudioKeys(streams, opts) {
  const order = resolveOrder(opts.audioOrder);
  const disabledSet = new Set(tokensToIds(opts.audioDisabled));
  const demote = opts.audioDisableAction === 'bottom';
  for (const s of streams) {
    const k = buildAudioKeys(s, order, disabledSet);
    s._audioIdx = k.audioIdx;
    s._isDisabledClass = k.isDisabledClass;
    s._demoted = (k.isDisabledClass && demote) ? 1 : 0;
    s._resRank = resRank(s._resLabel);
  }
  return streams;
}
```

Add `buildAudioKeys` and `attachAudioKeys` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): buildAudioKeys + attachAudioKeys (best-track, disabled-class)"
```

---

## Task 4: `compareSortOrder` + `audioComparator` — the sort tiers

**Files:**
- Modify: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/audioRanking.test.js` before the summary:

```js
console.log('\ncompareSortOrder (mirrors legacy sort):');
const big = { _sizeBytes: 100, _bitrate: 10, _audioRank: 50 };
const small = { _sizeBytes: 10, _bitrate: 99, _audioRank: 5 };
assert(A.compareSortOrder(big, small, 'size') < 0, 'size: bigger first');
assert(A.compareSortOrder(small, big, 'bitrate') < 0, 'bitrate: higher first');
assert(A.compareSortOrder(small, big, 'audio') < 0, 'audio: lower _audioRank first');

console.log('\naudioComparator — backward compat (ranking OFF):');
function attach(s, opts) { A.attachAudioKeys(s, opts); return s; }
let arr = attach([
  { _audioFormats:['aac'],  _resLabel:'1080p', _sizeBytes:10, _bitrate:5, _audioRank:60 },
  { _audioFormats:['atmos'],_resLabel:'1080p', _sizeBytes:99, _bitrate:5, _audioRank:0 },
], { audioDisabled: [] });
arr.sort(A.audioComparator({ sortOrder: 'size', audioRank: false }));
assertEqual(arr[0]._sizeBytes, 99, 'ranking off + sort=size -> biggest first (unchanged)');

console.log('\naudioComparator — audioFirst:');
arr = attach([
  { _audioFormats:['aac'],  _resLabel:'4K',    _sizeBytes:99, _audioRank:60 },
  { _audioFormats:['atmos'],_resLabel:'1080p', _sizeBytes:10, _audioRank:0 },
], { audioDisabled: [] });
arr.sort(A.audioComparator({ sortOrder: 'size', audioRank: true, audioRankMode: 'audioFirst' }));
assertEqual(arr[0]._audioFormats[0], 'atmos', 'audioFirst: atmos beats higher-res aac');

console.log('\naudioComparator — resFirst:');
arr = attach([
  { _audioFormats:['aac'],  _resLabel:'4K',    _sizeBytes:10, _audioRank:60 },
  { _audioFormats:['atmos'],_resLabel:'1080p', _sizeBytes:99, _audioRank:0 },
], { audioDisabled: [] });
arr.sort(A.audioComparator({ sortOrder: 'size', audioRank: true, audioRankMode: 'resFirst' }));
assertEqual(arr[0]._resLabel, '4K', 'resFirst: 4K beats 1080p Atmos');

console.log('\naudioComparator — tier 0 demotion (independent of ranking toggle):');
arr = attach([
  { _audioFormats:['aac'],  _resLabel:'4K', _sizeBytes:99, _audioRank:60 },
  { _audioFormats:['atmos'],_resLabel:'4K', _sizeBytes:10, _audioRank:0 },
], { audioDisabled: ['aac'], audioDisableAction: 'bottom' });
arr.sort(A.audioComparator({ sortOrder: 'size', audioRank: false }));
assertEqual(arr[0]._audioFormats[0], 'atmos', 'demoted aac sinks below atmos even with ranking off');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `A.compareSortOrder is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/audioRanking.js`, add above `module.exports`:

```js
// Replicates lib/streams.js legacy sortOrder behavior exactly.
function compareSortOrder(a, b, sortOrder) {
  if (sortOrder === 'audio') {
    const d = (a._audioRank || 99) - (b._audioRank || 99);
    return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
  }
  if (sortOrder === 'bitrate') {
    const d = (b._bitrate || 0) - (a._bitrate || 0);
    return d !== 0 ? d : (b._sizeBytes || 0) - (a._sizeBytes || 0);
  }
  const sizeDiff = (b._sizeBytes || 0) - (a._sizeBytes || 0);
  if (sizeDiff !== 0) return sizeDiff;
  const audioDiff = (a._audioRank || 99) - (b._audioRank || 99);
  if (audioDiff !== 0) return audioDiff;
  return (b._bitrate || 0) - (a._bitrate || 0);
}

// Full comparator. Requires attachAudioKeys() to have run on every stream.
// Tier order: 0 demoted -> 1 language -> 2 preferred codec -> 3 ranking mode -> 4 legacy sort.
// Language (tier 1) and codec (tier 2) preserve the existing getAllStreams behavior.
function audioComparator(opts) {
  const { sortOrder, audioLang, prefCodec, codecMode, audioRank, audioRankMode } = opts;
  return (a, b) => {
    // Tier 0 — demoted (disabled-class with action=bottom) always sinks.
    if (a._demoted !== b._demoted) return a._demoted - b._demoted;

    // Tier 1 — preferred audio language (existing behavior).
    if (audioLang && audioLang !== 'any') {
      const aL = (a._audioLang || '').startsWith(audioLang) ? 0 : 1;
      const bL = (b._audioLang || '').startsWith(audioLang) ? 0 : 1;
      if (aL !== bL) return aL - bL;
    }

    // Tier 2 — preferred codec, prefer mode (existing behavior).
    if (prefCodec && prefCodec !== 'any' && codecMode !== 'only') {
      const aC = a._codec === prefCodec ? 0 : 1;
      const bC = b._codec === prefCodec ? 0 : 1;
      if (aC !== bC) return aC - bC;
    }

    // Tier 3 — audio ranking (only when master toggle on).
    if (audioRank) {
      if (audioRankMode === 'resFirst') {
        if (a._resRank !== b._resRank) return a._resRank - b._resRank;
        if (a._audioIdx !== b._audioIdx) return a._audioIdx - b._audioIdx;
        return (b._sizeBytes || 0) - (a._sizeBytes || 0);
      }
      if (audioRankMode === 'tiebreak') {
        const s = compareSortOrder(a, b, sortOrder);
        if (s !== 0) return s;
        return a._audioIdx - b._audioIdx;
      }
      // audioFirst (default)
      if (a._audioIdx !== b._audioIdx) return a._audioIdx - b._audioIdx;
      return compareSortOrder(a, b, sortOrder);
    }

    // Tier 4 — legacy default sort (unchanged).
    return compareSortOrder(a, b, sortOrder);
  };
}
```

Add `compareSortOrder` and `audioComparator` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): compareSortOrder + tiered audioComparator"
```

---

## Task 5: `filterDisabledHide` — hide mode + zero-result fallback

**Files:**
- Modify: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/audioRanking.test.js` before the summary:

```js
console.log('\nfilterDisabledHide:');
function mk(fmts) { return { _audioFormats: fmts }; }
// hide action removes disabled-class files
let input = A.attachAudioKeys([mk(['atmos']), mk(['aac'])], { audioDisabled:['aac'], audioDisableAction:'hide' });
let r = A.filterDisabledHide(input, { audioDisabled:['aac'], audioDisableAction:'hide' });
assertEqual(r.streams.length, 1, 'hide: aac file removed');
assertEqual(r.streams[0]._audioFormats[0], 'atmos', 'hide: atmos file kept');
assertEqual(r.hiddenFallback, false, 'no fallback when results remain');
// zero-result fallback: all files disabled -> restore originals
input = A.attachAudioKeys([mk(['aac']), mk(['dd'])], { audioDisabled:['aac','dd'], audioDisableAction:'hide' });
r = A.filterDisabledHide(input, { audioDisabled:['aac','dd'], audioDisableAction:'hide' });
assertEqual(r.streams.length, 2, 'fallback: all-disabled -> originals restored');
assertEqual(r.hiddenFallback, true, 'fallback flag set');
// action=bottom -> no removal
input = A.attachAudioKeys([mk(['atmos']), mk(['aac'])], { audioDisabled:['aac'], audioDisableAction:'bottom' });
r = A.filterDisabledHide(input, { audioDisabled:['aac'], audioDisableAction:'bottom' });
assertEqual(r.streams.length, 2, 'bottom: nothing removed');
// no disabled set -> passthrough
input = A.attachAudioKeys([mk(['atmos'])], { audioDisabled:[] });
r = A.filterDisabledHide(input, { audioDisabled:[] });
assertEqual(r.streams.length, 1, 'empty disabled set: passthrough');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `A.filterDisabledHide is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/audioRanking.js`, add above `module.exports`:

```js
// Hide-mode filter. Requires attachAudioKeys() to have run. Returns the filtered
// list, or — if hiding would empty the list — the original list with hiddenFallback.
function filterDisabledHide(streams, opts) {
  const disabled = tokensToIds(opts.audioDisabled);
  if (disabled.length === 0 || opts.audioDisableAction === 'bottom') {
    return { streams, hiddenFallback: false };
  }
  const kept = streams.filter(s => !s._isDisabledClass);
  if (kept.length === 0 && streams.length > 0) {
    return { streams, hiddenFallback: true };
  }
  return { streams: kept, hiddenFallback: false };
}
```

Add `filterDisabledHide` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): filterDisabledHide with zero-result fallback"
```

---

## Task 6: `AUDIO_PRESETS` + `resolvePreset` — device profiles & multi-select intersection

**Files:**
- Modify: `lib/audioRanking.js`
- Test: `test/audioRanking.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/audioRanking.test.js` before the summary:

```js
console.log('\nAUDIO_PRESETS:');
assert(A.AUDIO_PRESETS.some(p => p.id === 'shield'), 'shield preset exists');
assert(A.AUDIO_PRESETS.some(p => p.id === 'sonos'), 'sonos preset exists');
assert(A.AUDIO_PRESETS.some(p => p.id === 'firestick'), 'firestick preset exists');
assertEqual(A.AUDIO_PRESETS.length, 8, '8 device presets defined');

console.log('\nresolvePreset:');
// none selected -> no change
let p = A.resolvePreset([]);
assertEqual(p, null, 'no devices -> null (Custom, no change)');
// single device: shield supports everything
p = A.resolvePreset(['shield']);
assertEqual(p.disabled, [], 'shield disables nothing');
assertEqual(p.action, 'hide', 'single-select default action = hide');
// single device: firestick disables lossless/object
p = A.resolvePreset(['firestick']);
assert(p.disabled.includes('thd') && p.disabled.includes('dtx'), 'firestick disables truehd + dtsx (tokens)');
// multi-select: intersection (union of each device disabled set) + action=bottom
p = A.resolvePreset(['shield','browser']);
assert(p.disabled.includes('atm'), 'multi: browser unsupported (atmos) disabled even though shield supports it');
assertEqual(p.action, 'bottom', 'multi-select default action = bottom');
// order: enabled formats first, disabled sink to end, all 11 present (tokens)
p = A.resolvePreset(['firestick']);
assertEqual(p.order.length, 11, 'preset order has all 11 tokens');
const disabledSet = new Set(p.disabled);
const firstDisabledPos = p.order.findIndex(t => disabledSet.has(t));
const lastEnabledPos = p.order.map(t => disabledSet.has(t)).lastIndexOf(false);
assert(firstDisabledPos > lastEnabledPos, 'enabled formats ordered before disabled ones');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audioRanking.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'some')` (AUDIO_PRESETS undefined).

- [ ] **Step 3: Write minimal implementation**

In `lib/audioRanking.js`, add above `module.exports`. Each preset lists the format **ids it supports**; the disabled set is `all − supported`.

```js
const ALL_IDS = DEFAULT_ORDER; // reference for "supports everything"

// supports = format ids the device can reliably decode/passthrough.
const AUDIO_PRESETS = [
  { id: 'appletv',    label: 'Apple TV 4K',            supports: ALL_IDS.slice() },
  { id: 'shield',     label: 'Nvidia Shield',          supports: ALL_IDS.slice() },
  { id: 'chromecast', label: 'Chromecast w/ Google TV',supports: ['atmos','ddplus','dts','dd','aac','flac','other'] },
  { id: 'soundbar',   label: 'Generic eARC soundbar',  supports: ['atmos','dtsx','truehd','dtshd_ma','flac','ddplus','dts','dd','aac','other'] },
  { id: 'sonos',      label: 'Sonos (Arc/Beam)',       supports: ['atmos','truehd','flac','ddplus','dts','dd','aac','other'] },
  { id: 'firestick',  label: 'Firestick 4K / Max',     supports: ['atmos','ddplus','dts','dd','aac','flac','other'] },
  { id: 'browser',    label: 'Web browser',            supports: ['flac','dd','aac','other'] },
  { id: 'phone',      label: 'Phone / tablet',         supports: ['ddplus','dts','dd','aac','flac','other'] },
];

// Resolve selected device(s) to { order, disabled, action } in URL tokens.
// Multi-select: a format is disabled if ANY selected device lacks it. Multi
// defaults to action 'bottom' so disparate devices don't gut the library.
function resolvePreset(deviceIds) {
  const ids = (deviceIds || []).filter(d => AUDIO_PRESETS.some(p => p.id === d));
  if (ids.length === 0) return null;
  const presets = ids.map(d => AUDIO_PRESETS.find(p => p.id === d));
  const supportedByAll = DEFAULT_ORDER.filter(fmt => presets.every(p => p.supports.includes(fmt)));
  const supportedSet = new Set(supportedByAll);
  const disabledIds = DEFAULT_ORDER.filter(fmt => !supportedSet.has(fmt));
  // Order: enabled (default order) first, then disabled (default order).
  const orderIds = [...supportedByAll, ...disabledIds];
  return {
    order: idsToTokens(orderIds),
    disabled: idsToTokens(disabledIds),
    action: ids.length > 1 ? 'bottom' : 'hide',
  };
}
```

Note: firestick's `supports` omits TrueHD, DTS-HD MA, DTS:X, and LPCM, so those become its disabled set — matching the spec.

Add `AUDIO_PRESETS` and `resolvePreset` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audioRanking.test.js`
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add lib/audioRanking.js test/audioRanking.test.js
git commit -m "feat(audio): device presets + multi-select intersection"
```

---

## Task 7: Wire the engine into `lib/streams.js`

**Files:**
- Modify: `lib/streams.js` (require module; `_audioFormats` in `mediaSourcesToStreams`; `getAllStreams` attach/filter/sort; strip fields)
- Test: `test/streams.test.js`

- [ ] **Step 1: Write the failing test**

In `test/streams.test.js`, find the fixture block and add a new assertion section. After the existing `mediaSourcesToStreams` assertions (search for the last `assert(` in the file, add before any final summary). Add:

```js
// ── _audioFormats attached from MediaStreams ──
const multiAudioSource = makeSource({
  MediaStreams: [
    { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 2160 },
    { Type: 'Audio', Codec: 'truehd', Channels: 8, Profile: 'Atmos', Language: 'eng' },
    { Type: 'Audio', Codec: 'ac3', Channels: 6, Language: 'eng' },
  ],
});
const af = mediaSourcesToStreams(server, 'itemX', [multiAudioSource], 'standard');
assertEqual(af[0]._audioFormats.sort().join(','), 'atmos,dd', '_audioFormats lists all tracks classified');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/streams.test.js`
Expected: FAIL — `_audioFormats` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `lib/streams.js`:

(a) At the top, add the require (after the existing requires near line 4):

```js
const audioRanking = require('./audioRanking');
```

(b) In `mediaSourcesToStreams`, locate the `streams.push({ ... })` object (around line 236) and add one field alongside the other `_`-fields:

```js
      _audioFormats: [...new Set(audioStreams.map(s => audioRanking.classifyAudio(s.Codec, s.Profile)))],
```

(c) In `getAllStreams`, destructure the 5 new opts. Find the line that starts `const { sortOrder, excludeRes, ... } = opts;` (line 318) and add the new keys to the destructure:

```js
  const { sortOrder, excludeRes, recommend, ping, audioLang, maxBitrate, prefCodec, codecMode, labelPreset, pingDetail, autoSelect, qualityBadge, flagEmoji, bitrateBar, subsStyle, customNameFields, customDescFields,
    audioRank, audioOrder, audioDisabled, audioRankMode, audioDisableAction } = opts;
```

(d) In `getAllStreams`, AFTER the existing `maxBitrate` filter and `prefCodec`/`codecMode === 'only'` filter (i.e. right before the `// Sort` comment near line 374), insert key attachment + hide filter:

```js
  // Audio ranking/filtering keys (default-off; reproduces legacy behavior when unset)
  audioRanking.attachAudioKeys(realStreams, { audioOrder, audioDisabled, audioDisableAction });
  const _hideResult = audioRanking.filterDisabledHide(realStreams, { audioDisabled, audioDisableAction });
  realStreams = _hideResult.streams;
```

(e) Replace the entire existing `realStreams.sort((a, b) => { ... });` block (lines ~375-399) with a single delegating call:

```js
  realStreams.sort(audioRanking.audioComparator({
    sortOrder, audioLang, prefCodec, codecMode, audioRank, audioRankMode,
  }));
```

(f) In the final field-strip `.map(...)` near line 459, add the new internal fields to the destructured-and-dropped list so they never reach Stremio:

```js
  const finalStreams = [...realStreams, ...noResStreams]
    .map(({ _sizeBytes, _bitrate, _audioRank, _mediaSourceId, _noResults, _noResultsType, _resLabel, _pingMs, _codec, _audioLang, _serverLabel, _itemName, _audioFormats, _audioIdx, _isDisabledClass, _demoted, _resRank, ...stream }) => stream);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/streams.test.js`
Expected: PASS — including the new `_audioFormats` assertion and all pre-existing assertions (the comparator delegation is behavior-preserving for defaults).

- [ ] **Step 5: Commit**

```bash
git add lib/streams.js test/streams.test.js
git commit -m "feat(audio): wire audioRanking engine into getAllStreams"
```

---

## Task 8: Thread config into `server.js` + serve taxonomy endpoint

**Files:**
- Modify: `server.js` (opts at ~line 720; new route)

- [ ] **Step 1: Add the 5 opts to the getAllStreams call**

In `server.js`, in the `getAllStreams(servers, type, imdbId, season, episode, { ... })` call (~line 720-738), add after `customDescFields: cfg.customDescFields || [],`:

```js
      audioRank:          cfg.audioRank === true,
      audioOrder:         cfg.audioOrder || undefined,
      audioDisabled:      cfg.audioDisabled || [],
      audioRankMode:      cfg.audioRankMode || 'audioFirst',
      audioDisableAction: cfg.audioDisableAction || 'hide',
```

- [ ] **Step 2: Add the taxonomy endpoint**

Near the other small API/static routes in `server.js`, add (place it with the other `app.get` route declarations):

```js
// Audio taxonomy + device presets — single source of truth for the configure UI.
const audioRanking = require('./lib/audioRanking');
app.get('/api/audio-formats', (req, res) => {
  res.json({ formats: audioRanking.AUDIO_FORMATS, presets: audioRanking.AUDIO_PRESETS });
});
```

(If `server.js` already requires `./lib/audioRanking` elsewhere, reuse that and drop the duplicate `require`.)

- [ ] **Step 3: Verify the endpoint and that nothing broke**

Run (PowerShell):
```powershell
$env:DATABASE_URL=$env:DATABASE_URL; node -e "const a=require('./lib/audioRanking'); console.log(a.AUDIO_FORMATS.length, a.AUDIO_PRESETS.length)"
```
Expected: `11 8`.

Then start the server locally and curl the route:
```bash
node server.js &
sleep 2
curl -s http://localhost:${PORT:-7000}/api/audio-formats | head -c 200
```
Expected: JSON beginning `{"formats":[{"id":"atmos"...`. Stop the server afterward.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(audio): pass audio config to getAllStreams + serve /api/audio-formats"
```

---

## Task 9: Audio card markup in `configure.html`

**Files:**
- Modify: `public/configure.html` (insert card after the "Prefer audio language" field, before "Prefer codec")

- [ ] **Step 1: Insert the Audio card**

In `public/configure.html`, AFTER the closing `</div>` of the "🌐 Prefer audio language" field (line ~401) and BEFORE the "🎬 Prefer codec" field (line ~403), insert:

```html
          <div class="field">
            <div class="field-label">🔊 Audio ranking</div>
            <div class="seg" data-target="#audio-rank" style="max-width:220px;margin-bottom:8px">
              <button data-val="off">Off</button><button data-val="on">On</button>
            </div>
            <select id="audio-rank" class="hidden-canonical">
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>

            <div class="audio-presets" style="margin-bottom:8px">
              <div class="field-label" style="font-size:0.72rem">Device presets (multi-select)</div>
              <div id="audio-preset-chips" class="chips"></div>
              <div class="sw-sub">Presets reflect typical decode support — adjust to your gear.</div>
            </div>

            <ol id="audio-rank-list" class="audio-rank-list"></ol>
            <div class="sw-sub" id="audio-rank-hint">Drag to set priority. Disable toggles work even with ranking off. If hiding would leave no results for a title, all are shown instead.</div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <div>
                <div class="field-label" style="font-size:0.72rem">Priority mode</div>
                <select id="audio-rank-mode" class="pick">
                  <option value="audioFirst">Audio first</option>
                  <option value="resFirst">Resolution first</option>
                  <option value="tiebreak">Tiebreaker only</option>
                </select>
              </div>
              <div>
                <div class="field-label" style="font-size:0.72rem">When disabled</div>
                <select id="audio-disable-action" class="pick">
                  <option value="hide">Hide file</option>
                  <option value="bottom">Send to bottom</option>
                </select>
              </div>
            </div>
          </div>
```

- [ ] **Step 2: Add minimal styles**

In `public/css/configure.css`, append:

```css
/* Audio ranking card */
.audio-rank-list { list-style: none; margin: 0; padding: 0; }
.audio-rank-list .arl-cat { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 8px 0 2px; }
.audio-rank-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--card, #1a1a1f); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 4px; cursor: grab; }
.audio-rank-row.dragging { opacity: 0.5; }
.audio-rank-row .arl-handle { color: var(--text-muted); cursor: grab; user-select: none; }
.audio-rank-row .arl-label { font-weight: 600; }
.audio-rank-row .arl-chans { font-size: 0.7rem; color: var(--text-muted); margin-left: auto; }
.audio-rank-row.disabled-fmt { opacity: 0.55; }
#audio-preset-chips .chip.active { background: var(--accent); color: #fff; }
```

(`prefers-reduced-motion` is respected: there are no transitions on `.audio-rank-row`, so reordering does not animate.)

- [ ] **Step 3: Verify markup loads**

Open the configure page locally in a browser; confirm the "🔊 Audio ranking" card renders with the Off/On segment, an empty preset-chips row, an empty `<ol>`, and the two dropdowns. (The list/chips populate in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add public/configure.html public/css/configure.css
git commit -m "feat(audio): Audio ranking card markup + styles"
```

---

## Task 10: Wire the card in `configure.js` (render, drag, collect, populate, preview)

**Files:**
- Modify: `public/js/configure.js`

- [ ] **Step 1: Add the render + drag module**

Append to `public/js/configure.js` (top-level, after existing helpers):

```js
// ─── Audio ranking card ──────────────────────────────────────────────────────
let AUDIO_FORMATS = [];
let AUDIO_PRESETS = [];
const AUDIO_CAT_LABEL = { object: 'Object-Based', lossless: 'Lossless', lossy: 'Lossy', other: 'Other' };

async function initAudioCard() {
  try {
    const r = await fetch('/api/audio-formats');
    const data = await r.json();
    AUDIO_FORMATS = data.formats || [];
    AUDIO_PRESETS = data.presets || [];
  } catch { AUDIO_FORMATS = []; AUDIO_PRESETS = []; }
  renderAudioPresetChips();
  renderAudioRankList(AUDIO_FORMATS.map(f => f.token), []); // default order, none disabled
}

function tokenMeta(token) { return AUDIO_FORMATS.find(f => f.token === token) || null; }

function renderAudioRankList(orderTokens, disabledTokens) {
  const ol = document.getElementById('audio-rank-list');
  if (!ol) return;
  const disabled = new Set(disabledTokens || []);
  ol.innerHTML = '';
  let lastCat = null;
  orderTokens.forEach(token => {
    const meta = tokenMeta(token);
    if (!meta) return;
    if (meta.cat !== lastCat) {
      const cat = document.createElement('li');
      cat.className = 'arl-cat';
      cat.textContent = AUDIO_CAT_LABEL[meta.cat] || '';
      ol.appendChild(cat);
      lastCat = meta.cat;
    }
    const li = document.createElement('li');
    li.className = 'audio-rank-row' + (disabled.has(token) ? ' disabled-fmt' : '');
    li.draggable = true;
    li.dataset.token = token;
    li.innerHTML =
      `<span class="arl-handle">⠿</span>` +
      `<span class="arl-label">${meta.label}</span>` +
      `<span class="arl-chans">${meta.chans}</span>` +
      `<label class="sw" style="margin-left:8px"><input type="checkbox" class="arl-disable" ${disabled.has(token) ? 'checked' : ''}/> disable</label>`;
    ol.appendChild(li);
  });
  wireAudioDrag(ol);
  ol.querySelectorAll('.arl-disable').forEach(cb => cb.addEventListener('change', e => {
    e.target.closest('.audio-rank-row').classList.toggle('disabled-fmt', e.target.checked);
  }));
}

function wireAudioDrag(ol) {
  let dragEl = null;
  ol.querySelectorAll('.audio-rank-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragEl = null; });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      const rect = row.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      ol.insertBefore(dragEl, after ? row.nextSibling : row);
    });
  });
}

function renderAudioPresetChips() {
  const wrap = document.getElementById('audio-preset-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  AUDIO_PRESETS.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.preset = p.id;
    chip.textContent = p.label;
    chip.addEventListener('click', () => { chip.classList.toggle('active'); applyAudioPresets(); });
    wrap.appendChild(chip);
  });
}

function selectedPresetIds() {
  return [...document.querySelectorAll('#audio-preset-chips .chip.active')].map(c => c.dataset.preset);
}

// Mirror of server resolvePreset (lib/audioRanking.js) for instant UI feedback.
function applyAudioPresets() {
  const ids = selectedPresetIds();
  if (ids.length === 0) return;
  const chosen = ids.map(id => AUDIO_PRESETS.find(p => p.id === id)).filter(Boolean);
  const allIds = AUDIO_FORMATS.map(f => f.id);
  const supportedAll = allIds.filter(fmt => chosen.every(p => p.supports.includes(fmt)));
  const disabledIds = allIds.filter(fmt => !supportedAll.includes(fmt));
  const orderIds = [...supportedAll, ...disabledIds];
  const toToken = id => (AUDIO_FORMATS.find(f => f.id === id) || {}).token;
  renderAudioRankList(orderIds.map(toToken), disabledIds.map(toToken));
  setSeg('#audio-rank', 'on');
  document.getElementById('audio-disable-action').value = ids.length > 1 ? 'bottom' : 'hide';
}
```

Note: `setSeg` is the existing helper that sets a segmented control + its hidden canonical input. If the codebase's helper has a different name, use that name (search `configure.js` for how `#sort-order` segments are set programmatically and reuse it).

- [ ] **Step 2: Call `initAudioCard()` on load**

Find where the page initializes (search for `populateFromConfig` invocation or a `DOMContentLoaded`/init function). Add a call to `initAudioCard();` there, then — after it resolves — apply any saved config (Task 10 Step 4 handles the restore). Simplest: make the init `await initAudioCard();` then `populateFromConfig(savedConfig)`.

- [ ] **Step 3: Collect into config (both save builders)**

In `configure.js`, in the save logic (~lines 1862-1965), add these reads near the other `const sortOrder = ...` reads:

```js
  const audioRank = document.getElementById('audio-rank').value === 'on';
  const audioOrder = [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token);
  const audioDisabled = [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')]
    .map(cb => cb.closest('.audio-rank-row').dataset.token);
  const audioRankMode = document.getElementById('audio-rank-mode').value;
  const audioDisableAction = document.getElementById('audio-disable-action').value;
  const audioOrderChanged = audioOrder.join(',') !== AUDIO_FORMATS.map(f => f.token).join(',');
```

Then in BOTH the split-mode `sc` builder (~1899-1931) and the normal-mode `config` builder (~1949-1964), add (use `sc` in the split block, `config` in the normal block):

```js
      if (audioRank) sc.audioRank = true;
      if (audioRank && audioRankMode !== 'audioFirst') sc.audioRankMode = audioRankMode;
      if (audioOrderChanged) sc.audioOrder = audioOrder;
      if (audioDisabled.length) sc.audioDisabled = audioDisabled;
      if (audioDisabled.length && audioDisableAction !== 'hide') sc.audioDisableAction = audioDisableAction;
```

(Normal block: replace `sc.` with `config.`.)

- [ ] **Step 4: Restore in `populateFromConfig`**

In `populateFromConfig` (~line 1488), add:

```js
  setSeg('#audio-rank', config.audioRank ? 'on' : 'off');
  document.getElementById('audio-rank-mode').value = config.audioRankMode || 'audioFirst';
  document.getElementById('audio-disable-action').value = config.audioDisableAction || 'hide';
  const _order = (config.audioOrder && config.audioOrder.length) ? config.audioOrder : AUDIO_FORMATS.map(f => f.token);
  renderAudioRankList(_order, config.audioDisabled || []);
```

(Ensure this runs AFTER `initAudioCard()` has populated `AUDIO_FORMATS`; see Step 2.)

- [ ] **Step 5: Add to live-preview `buildState`**

In the `buildState` object (~line 2090), add:

```js
    audioRank: document.getElementById('audio-rank')?.value === 'on',
    audioOrder: [...document.querySelectorAll('#audio-rank-list .audio-rank-row')].map(r => r.dataset.token),
    audioDisabled: [...document.querySelectorAll('#audio-rank-list .arl-disable:checked')].map(cb => cb.closest('.audio-rank-row').dataset.token),
    audioRankMode: document.getElementById('audio-rank-mode')?.value,
    audioDisableAction: document.getElementById('audio-disable-action')?.value,
```

- [ ] **Step 6: Manual verification**

Start the server locally, open the configure page:
1. The Audio card lists all 11 formats under 3 category headers, each with channel hint + disable checkbox.
2. Drag a row — order changes and persists in the list.
3. Click "Firestick 4K / Max" preset chip — TrueHD/DTS-HD MA/DTS:X/LPCM rows get the disabled style, ranking flips On, action = Hide.
4. Click a second preset (e.g. "Web browser") — more rows disable, action switches to Send to bottom.
5. Generate the manifest URL, decode the config portion (`atob` the base64 segment) and confirm `audioRank`, `audioOrder`, `audioDisabled` appear only when non-default.
6. Reload with that URL/config and confirm `populateFromConfig` restores the list order, disabled toggles, and dropdowns.

- [ ] **Step 7: Commit**

```bash
git add public/js/configure.js
git commit -m "feat(audio): render/drag/collect/populate audio ranking card"
```

---

## Task 11: Register test in `npm test` + full-suite verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the new test to the chain**

In `package.json`, in the `"test"` script, add `&& node test/audioRanking.test.js` (place it right after `node test/streams.test.js`):

```json
    "test": "node test/utils.test.js && node test/streams.test.js && node test/audioRanking.test.js && node test/crypto.test.js && node test/manifest.test.js && node test/accounts.test.js && node test/metrics.test.js && node test/db.test.js && node test/users.test.js && node test/sessions.test.js && node test/userConfig.test.js && node test/manifestStore.test.js && node test/billing.test.js && node test/payments.test.js && node test/serverHistory.test.js && node test/adminStats.test.js && node test/liveSessions.test.js && node test/requestLog.test.js && node test/siteSettings.test.js"
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: every test file reports `0 failed`, including `test/audioRanking.test.js` and `test/streams.test.js`.

- [ ] **Step 3: Backward-compat smoke check**

Run:
```bash
node -e "
const {getAllStreams}=require('./lib/streams');
// no audio opts -> behaves as before; just confirm module loads + sorts without throwing
console.log('loads ok');
"
```
Expected: `loads ok` (confirms wiring doesn't crash on the default path).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(audio): add audioRanking.test.js to npm test chain"
```

---

## Task 12: Final review & deploy

- [ ] **Step 1: Re-read the spec's acceptance points** — confirm each is implemented:
  - Ranking master toggle (Task 8/10), per-format disable independent of toggle (Task 4 tier 0 + Task 5), hide vs bottom (Task 5/4), priority mode dropdown (Task 4), multi-select presets w/ intersection (Task 6/10), shared taxonomy endpoint (Task 8), backward-compat (Task 4/7 tests).
- [ ] **Step 2: Manual end-to-end** — install the generated manifest in Stremio (or hit a stream endpoint) for a title with mixed audio; confirm ordering matches the chosen mode and disabled formats hide/sink as configured.
- [ ] **Step 3: Push to `main`** (auto-deploys to Railway):

```bash
git push origin main
```

- [ ] **Step 4: Post-deploy check** — load the production configure page, confirm `/api/audio-formats` responds and the card works; verify an existing (pre-feature) manifest URL still returns streams unchanged.

---

## Notes for the implementer

- **DTS:X / LPCM / FLAC detection** depends on real Emby/Jellyfin `Codec`/`Profile` strings. In Task 7, before committing, inspect a `PlaybackInfo` response from a live server (the addon logs MediaSources, or add a temporary `console.log(mediaStreams.map(s=>({c:s.Codec,p:s.Profile})))`) and confirm the classifier matches reality. Adjust `classifyAudio` substring checks if a server reports e.g. `dts` codec with profile `DTS:X MA` differently. Remove any temporary logging before commit.
- **`setSeg` helper name:** Step 1/4 of Task 10 assume a helper that drives the segmented controls. Confirm the actual name in `configure.js` (search how `#sort-order` / `#pref-codec` segments are set) and use it consistently.
- **Don't** refactor unrelated code. Keep every change additive and behind the new config keys.
```