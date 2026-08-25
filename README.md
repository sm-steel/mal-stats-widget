# mal-stats-widget

A MyAnimeList stats SVG card, embeddable in a GitHub profile README via
`<img src>`. Built as a Vercel Python serverless function on top of the
**official** MAL API v2 — no OAuth login flow, just a Client ID.

Styled to match [`sm-steel/sm-steel`](https://github.com/sm-steel/sm-steel)'s
other profile-README card blocks exactly (see
[`sm-steel/ym-nowplaying-widget`](https://github.com/sm-steel/ym-nowplaying-widget)
for the sibling Yandex Music widget built the same way) — same 900px width,
same outer/card padding and radius, same Catppuccin light/dark palette hex
values, same Monaspace Neon font (embedded as a base64 `@font-face`).
Supports `?theme=dark|light`.

## How it works

MAL's official API v2 restricts `GET /users/{username}` to `@me` (the
authenticated user) — but `GET /users/{username}/animelist` works for **any
public username** with just an `X-MAL-Client-ID` header, no OAuth needed.
This fetches the full list (paginated, `fields=list_status,average_episode_duration`)
and computes stats locally:

- **Total / Completed / Watching** — counted from `list_status.status`
- **Mean Score** — averaged over entries with a nonzero `list_status.score`
- **Days Watched** — `sum(episodes_watched × average_episode_duration) / 86400`
  (MAL doesn't expose a precomputed total via Client-ID-only auth — that only
  appears on the OAuth-only `@me` statistics endpoint)

## Setup

### 1. Register a MAL API client

Go to https://myanimelist.net/apiconfig/create — App Type "other", any name;
if it demands a redirect URL, any placeholder works since this never does an
OAuth login. Copy the **Client ID** (no secret needed).

### 2. Set env vars on Vercel

```
vercel env add MAL_CLIENT_ID production
vercel env add MAL_USERNAME production
```

### 3. Deploy

Deploys run via GitHub Actions (`.github/workflows/deploy.yml`) on every push
to `main`, using `vercel pull` → `vercel build --prod` → `vercel deploy
--prebuilt --prod`. Needs three repo secrets — `VERCEL_TOKEN` (team-scoped,
from https://vercel.com/account/tokens — a *project*-scoped token isn't
enough, `vercel pull` needs org-level lookup first), `VERCEL_ORG_ID`, and
`VERCEL_PROJECT_ID` (both from `.vercel/project.json` after `vercel link`).

To deploy manually instead: `vercel deploy --prod`.

### 4. Embed in your README

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://<your-deployment>.vercel.app/api/mal?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://<your-deployment>.vercel.app/api/mal?theme=light" />
  <img alt="MyAnimeList stats" src="https://<your-deployment>.vercel.app/api/mal?theme=dark" width="100%" />
</picture>
```

## Local dev

MyAnimeList's main domain (and apparently its API too, intermittently) isn't
reachable from every network — if `api.myanimelist.net` requests hang or
reset, route through a proxy:

```
export HTTPS_PROXY=http://user:pass@proxy-host:port
uv sync
MAL_CLIENT_ID=... MAL_USERNAME=... uv run python -c "
import sys; sys.path.insert(0, 'api')
import mal
print(mal.fetch_stats_svg('dark'))
"
```

Vercel's own deploy/runtime network hasn't shown this issue — no proxy is
configured in the deployed function.
