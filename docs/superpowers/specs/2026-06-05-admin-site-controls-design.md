# Admin Site Controls — Design

**Date:** 2026-06-05
**Status:** Approved (pending spec review)
**Branch:** `feat/admin-site-controls`
**Scope:** Two admin features — "view as normal user" preview, and global per-tab enable/disable — plus splitting the combined "API Keys & Manifest" tab into separate **Install** and **API Keys** pages.

## Goal

Give the admin two controls, both surfaced on the **System (admin)** page:
1. **View as normal user** — a visual preview that hides all admin UI (and any disabled
   tabs) so the admin sees exactly what a normal user sees, with an obvious banner +
   one-click exit. Admin powers (API access) are untouched.
2. **Disable tabs** — globally hide any user-facing tab from normal users (UI-only;
   underlying functionality is not changed). Reversible anytime.

No changes to underlying features (e.g. catalogs are still served to Stremio if
configured); this is purely website navigation/visibility.

## Current state (audit)

- Tabs are `.nav-item[data-page="..."]` in `public/configure.html`; pages are
  `.page#page-<name>`. Routing is hash-based (`#/<page>`), toggling `.on`.
- Admin tabs (`data-page="admin"` = "System", `data-page="users"`) carry `.admin-only`
  and are revealed by `public/js/admin.js:216` only when role === admin.
- `public/js/command-palette.js` already skips hidden nav items
  (`nav.offsetParent === null`).
- **No global site-settings store exists** — all config today is per-user
  (`user_config`). This feature needs a new global store.
- The current `data-page="install"` page (`#page-install`, titled "API Keys & Manifest")
  bundles two unrelated things: the catalog **API keys** (Trakt/TMDB/MDBList/RPDB +
  `#ak-save`) and the **manifest install** link (`#acct-link-wrap`: `#acct-url`,
  `#acct-copy`, `#acct-regen`, `#acct-install`). These get split (see §7).
- User-facing tabs (toggleable), after the split: `dashboard, servers, catalogs,
  streaming, appearance, install, apikeys, health, ping, log, settings, billing`.
  Admin tabs (`admin`, `users`) are NOT toggleable here — already admin-gated.

## Constraints

- Without `DATABASE_URL` the app degrades gracefully — `disabledTabs` must default to
  `[]` (nothing hidden), never error.
- Railway auto-deploys on push to `main`; do not push without explicit ask.
- `npm test` (current suite) must stay green; new logic gets tests.
- Vanilla JS/CSS; no new runtime dependencies.

## Design

### 1. Global site-settings store (new)
- **Migration `008_site_settings.sql`:**
  ```sql
  CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
  Generic key/value so future global flags reuse it. Disabled tabs live under
  `key = 'disabled_tabs'`, `value = ["catalogs", ...]`.
- **`lib/siteSettings.js`** (injectable db, testable):
  - `getDisabledTabs()` → array (`[]` if unset or no DB).
  - `setDisabledTabs(arr)` → validates each entry against the toggleable whitelist,
    upserts the row. Returns the saved array.
  - `TOGGLEABLE_TABS` constant exported (the whitelist above) for validation + reuse.

### 2. API
- `GET /api/site-config` — **public** (no auth; every visitor's frontend needs it).
  Returns `{ disabledTabs: [...] }`. Returns `{ disabledTabs: [] }` without DB.
- `POST /api/admin/site-config` — **admin-gated** (`requireAdmin` in `routes/admin.js`).
  Body `{ disabledTabs: [...] }`; server validates against `TOGGLEABLE_TABS` (rejects
  unknown/admin tabs with 400), saves, returns the saved list.

### 3. Frontend application — `public/js/site-controls.js` (new)
Single responsibility: fetch site-config and apply tab visibility + own the view-as
state. Loaded early (like `theme.js`).
- On load: `GET /api/site-config`, then `applyTabs()`.
- `applyTabs()` determines effective role: `asUser = (role !== 'admin') || viewAsUser`.
  - For each disabled `data-page`:
    - if `asUser`: hide its `.nav-item` (set `.tab-hidden`); if the current hash points
      at it, redirect to `#/dashboard`.
    - else (admin, normal view): show it with a `.tab-disabled-badge` ("disabled").
  - Non-disabled tabs always shown (subject to existing admin/billing gating).
- Re-run `applyTabs()` whenever settings are saved or view-as is toggled (no reload).
- Interop: runs after `admin.js` reveals `.admin-only`; view-as additionally re-hides
  `.admin-only`.

### 4. View-as-user (visual preview only)
- State: `localStorage.viewAsUser` ('1' / absent); mirrored as `html.view-as-user`.
- When on: `applyTabs()` treats admin as a user (hides admin tabs + disabled tabs); a
  fixed top **banner** renders ("👁 Viewing as a normal user — **Exit preview**").
  Exit clears the flag, removes the class, re-applies, removes the banner.
- Admin API access is unchanged — purely a client-side view. Cannot lock out.
- Also invocable from the command palette ("Toggle view as normal user").

### 5. Admin controls UI (System/admin page)
A new **"Site controls"** card (admin page markup + `admin.js` wiring):
- **View as normal user** switch (reflects `viewAsUser`).
- A list of **per-tab switches** for `TOGGLEABLE_TABS`, each labeled with the tab name,
  reflecting current `disabledTabs` (off = disabled). Toggling POSTs the full array to
  `/api/admin/site-config`, then calls `applyTabs()` live + toasts.
- Loaded when the admin page is shown (alongside the existing metrics).

### 6. Edge cases / safety
- No DB → `disabledTabs: []`, everything visible; toggles still render but saving is a
  no-op-safe 503 (UI shows "accounts unavailable") — consistent with other admin writes.
- Server validates tab names (whitelist) — can't disable admin tabs or inject pages.
- If a disabled page is deep-linked, `applyTabs()` redirects users to Dashboard.
- View-as banner guarantees the admin always knows + can exit.

### 7. Split "API Keys & Manifest" into Install + API Keys
The current `#page-install` (nav label "API Keys") conflates two concerns. Split into:
- **Install** page — `data-page="install"`, `#page-install`, title "Install". Holds the
  manifest install block (`#acct-link-wrap`: `#acct-url`, `#acct-copy`, `#acct-regen`,
  `#acct-install`, plus the QR if present) and the `#result-section`. This is the
  "add to Stremio" page.
- **API Keys** page — `data-page="apikeys"`, `#page-apikeys`, title "API Keys". Holds the
  catalog key fields (`#trakt-client-id`, `#tmdb-api-key`, `#mdblist-api-key`,
  `#rpdb-key`) + `#ak-save` + the encryption hint. Sits under "Configuration".
- **Nav:** Install gets its own item; API Keys keeps its item (relabeled from the old
  combined one). Existing IDs (`#acct-*`, `#ak-*`, `#trakt-client-id`, etc.) are
  preserved so `configure.js` wiring keeps working — only their parent `.page`/nav
  changes. Any internal links/redirects to `#/install` that meant the keys page are
  repointed appropriately.
- Both new pages are in `TOGGLEABLE_TABS` (replacing the single `install`).

## Testing & verification
- **Unit:** `test/siteSettings.test.js` (added to `npm test`): get/set round-trip via a
  fake db; `[]` fallback with no db; `setDisabledTabs` rejects entries outside
  `TOGGLEABLE_TABS`; admin tabs (`admin`,`users`) rejected.
- **Browser (MCP):** disable Catalogs → for a normal user it's gone + deep-link
  redirects; for admin it shows with a "disabled" badge; in view-as it's hidden and the
  banner shows; exit restores. Re-enable → reappears live without reload.
- `npm test` — all suites green.

## Non-goals (YAGNI)
No per-user tab overrides, no disabling of underlying features/routes (UI-only), no
true role-downgrade for view-as, no scheduling, no new dependencies.
