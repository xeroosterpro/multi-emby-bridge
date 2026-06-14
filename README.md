# Stream Hub (multi-emby-bridge)

Stremio addon that bridges multiple Emby and Jellyfin servers into one installable addon, with an optional hosted multi-user platform.

## Requirements

- Node.js 18+
- PostgreSQL (optional — required for accounts, encrypted keys, `/u/:token` manifests)

## Quick start

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, CONFIG_ENC_KEY, etc.
npm install
npm start
```

Open `http://localhost:7000/configure` to configure servers and copy your Stremio manifest URL.

## Environment

See [`.env.example`](.env.example) for all variables. Key settings:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection for accounts and encrypted config |
| `CONFIG_ENC_KEY` | AES-256-GCM master key (32 random bytes, base64) |
| `ALLOW_PUBLIC_REGISTER` | Set `0` for invite-only signups in production |
| `PAYPAL_*` | Optional subscription billing |

Generate `CONFIG_ENC_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Stremio install URLs

- **Hosted (recommended):** `/u/:token/manifest.json` — short revocable link backed by Postgres; server credentials stay encrypted server-side
- **Legacy:** `/:config/manifest.json` — base64-encoded config in URL (works without DB)

**Security note:** Legacy manifest URLs embed your full config (including Emby/Jellyfin API keys) in the URL path. Those URLs can appear in browser history, server access logs, and referrer headers. Use hosted `/u/:token` links for any shared or long-lived install.

Stremio addon routes (`/:config/*` and `/u/:token/*`) require open CORS and are intentionally public. Configure-backend `/api/*` endpoints require sign-in in production.

## Tests

```bash
npm test
```

Tests are plain Node scripts (no Jest/Mocha). Each file in `test/` can also be run individually.

CI runs on push/PR via GitHub Actions (`.github/workflows/test.yml`).

## Project layout

| Path | Role |
|------|------|
| [`server.js`](server.js) | Process entry: boot, shutdown, global error handlers |
| [`lib/createApp.js`](lib/createApp.js) | Express app factory (middleware + route wiring) |
| [`routes/stremio.js`](routes/stremio.js) | Stremio protocol: manifest, catalog, stream |
| [`routes/bridgeApi.js`](routes/bridgeApi.js) | Configure-backend `/api/*` routes |
| [`routes/manifestToken.js`](routes/manifestToken.js) | Hosted `/u/:token/*` manifest dispatch |
| [`lib/`](lib/) | Core logic (streams, search, auth, billing, dashboard) |
| [`public/js/configure/`](public/js/configure/) | Configure SPA modules (20 files; `configure.js` is the ~90-line orchestrator) |

## Deploy

Railway config is in [`railway.json`](railway.json). Health check: `GET /health`.