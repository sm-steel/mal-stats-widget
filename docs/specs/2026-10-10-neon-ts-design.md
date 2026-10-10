# MAL stats widget — TypeScript + neon design (2026-10-10)

Sub-project 3 of the profile neon restyle (see `sm-steel/neon-kit` `docs/specs/2026-10-10-neon-kit-design.md`). The pattern follows `sm-steel/ym-nowplaying-widget`'s TypeScript port.

## Context

`/api/mal` renders an anime stats card from MyAnimeList. It is written in Python and uses the old rounded card style. This rewrite ports it to **TypeScript**, renders it with **`@sm-steel/neon-kit` ^1.1.0**, and keeps the content, the endpoint and the env vars. The user approved:
- **6** recently watched entries in a **2-column × 3-row** grid;
- titles word-wrapped to **at most 3 lines with "…"**;
- the watched date on the line directly below the title.

## Data (unchanged from the Python version)

- **Auth:** MAL API v2 with header `X-MAL-Client-ID: ${MAL_CLIENT_ID}`. No OAuth: `/users/{name}/animelist` works for any public user.
- **Request:** `GET https://api.myanimelist.net/v2/users/${MAL_USERNAME}/animelist?fields=list_status,average_episode_duration&limit=1000`, following `paging.next`.
  - At most **10 pages**.
  - A `next` URL that doesn't start with `https://api.myanimelist.net/v2/` is refused, and the request fails with `bad response`.
  - **Timeouts:** 6s per page and 18s overall.
- **Entry shape:** `{ node: { id, title, main_picture?: { medium, large }, average_episode_duration? }, list_status: { status, score, num_episodes_watched, updated_at } }`.
- **Stats:**
  - `total` = number of entries.
  - `completed` and `watching` = counts by `list_status.status`.
  - `meanScore` = mean of non-zero `score` values, 0 when there are none.
  - `daysWatched` = Σ(`num_episodes_watched` × `average_episode_duration`) / 86400. A missing duration or episode count counts as 0.
- **Display formats:** integers as-is; mean score and days watched with **1 decimal** (`8.4`, `86.7`).
- **Recent:** entries whose status ≠ `plan_to_watch`, sorted by `list_status.updated_at` descending, first **6**.
- **Posters:**
  - `main_picture.medium` is rewritten to the CDN's resized path by inserting `r/116x180/` after `https://cdn.myanimelist.net/`. That gives a 116×180 thumbnail of about 7.6 KB; the plain path is about 57 KB.
  - A URL that doesn't match that host is used as-is.
  - Posters are fetched in parallel with a 4s timeout each and embedded as data URIs.
  - Content types are whitelisted to `image/jpeg|png|webp`. The CDN's non-standard `image/jpg` is normalized to `image/jpeg`.
  - Anything that fails becomes a placeholder.
- **Relative time** (kept from the Python version), from `updated_at` against now:

  | age | label |
  |---|---|
  | < 1 h | `today` |
  | < 1 day | `Nh ago` |
  | 1 day | `yesterday` |
  | < 7 days | `Nd ago` |
  | < 30 days | `Nw ago` |
  | < 365 days | `Nmo ago` |
  | otherwise | `Ny ago` |

  An unparseable date gives an empty string.

## Rendering

- **Card:** neon-kit `card()` with `title: "Anime Stats"`, `font: { variant: "text", weights: [400, 700] }`, `seed: "mal"`, `label: "MyAnimeList anime stats"`.
  - Content width is 868, so the outer width is 900.
  - Mocha for `?theme=dark` (the default and any unknown value), Latte for `?theme=light`.
- **Stat tiles:**
  - 5 tiles, 10px gap, each (868−40)/5 wide and 64 tall, with `rx=2`, no fill and a 1px `border` stroke.
  - The value is 26px bold in the accent colour, centred at y=32. The label is 13px in the `text` colour at y=52.
  - Labels: `Total`, `Completed`, `Watching`, `Mean Score`, `Days Watched`.
- **Sub-header:** `// RECENTLY WATCHED` at baseline y=94. It uses the HUD style (10px, letter-spacing 1.2, `//` in the accent colour, text in the `text` colour) with no cursor.
- **Grid:**
  - Top at y=108, 2 columns 422 wide with a 24px gap; rows 84 tall with a 12px gap.
  - The poster is 60×84 with `rx=2` and a 1px border, clipped with id `mal-p<i>`.
  - The title sits at x+74: 13px, `text` colour, `wrapLines(title, charsPerLine(348, 13), 3)`, first baseline +13, line height 16.
  - The date sits at the same x, 11px, `subtext` colour, baseline `13 + lines*16`.
- **Height:** 108 + rows×84 + (rows−1)×12. With 0 recent entries, the sub-header and grid are omitted and the content height is 64.
- **Escaping:** all text goes through `esc()`.

## Endpoint

- `api/mal.ts` exports `GET(request)`, with a testable `handle(request, deps)`.
- **Success:** 200, `image/svg+xml; charset=utf-8`, `Cache-Control: public, max-age=0, s-maxage=1800, stale-while-revalidate=3600`.
- **Failure:** 200, the same card with `// SIGNAL LOST · <reason>`, `Cache-Control: no-store`. Reasons are `no client id`, `no username`, `mal <status>`, `timeout` or `bad response`, and only these fixed strings ever reach the card.
- **`vercel.json`:** `framework: null`, `outputDirectory: "public"` (containing only `robots.txt` with `Disallow: /`), and `functions["api/mal.ts"].maxDuration: 25`.

## Repo changes

- **Remove:** `api/mal.py`, `api/fonts/`, `pyproject.toml`, `uv.lock`, `.python-version`, and the local `.venv`, `.ropeproject`, `.ruff_cache` and `api/__pycache__`.
- **Add:**
  - `package.json` with `@sm-steel/neon-kit` ^1.1.0 as the only runtime dependency.
  - `mise.toml` (Node 24.21.0), `tsconfig.json`, `biome.json`, `vitest.config.ts` (include `test/**`), and `tsx` for the local preview.
- **`.gitignore`:** add `node_modules/`, `preview/out/`, `y0_*` and `token*.txt`.
- **Deploy workflow:** switch `setup-uv` to `jdx/mise-action@v5` + `npm ci` + `npm test`, and update checkout to v7. The Vercel steps and secrets stay.
- **README:** update for TypeScript, the env vars, the 30-minute caching and the preview command (`npm run preview -- --env-file <file>`).

## Testing

All tests run offline, with fixtures and a fake `fetch`:
- **Pagination:** follows `next`, caps at 10 pages, refuses off-API `next`, and maps 4xx/5xx, malformed bodies and timeouts to reasons.
- **Stats:** counts, mean of scored entries only (0 when none), days watched with missing durations, and 1-decimal formatting.
- **Recent:** excludes plan-to-watch, sorts newest first, takes at most 6, and handles missing `updated_at`.
- **Relative time:** every bucket boundary, plus an unparseable date.
- **Posters:** the resize rewrite, a foreign host used as-is, `image/jpg` normalized, a non-image or 404 becomes a placeholder, and a missing `main_picture` makes no request.
- **Render:**
  - 5 tiles with formatted values;
  - 6 grid cells;
  - a long title cut to 3 lines with "…";
  - the date on the line after the last title line;
  - escaping and Cyrillic;
  - fewer than 6 entries shrinks the grid, and 0 entries omits it;
  - the fallback card.
- **Handler:** headers on success and failure, the theme switch, and no client ID or raw error text in the card.
- **Gates:**
  - a local `vercel build`, then invoking the built function;
  - a **preview gate** with the user's real list. The client ID comes from `vercel env pull` if it's not marked sensitive; otherwise the user writes it to a file in their own terminal;
  - a fresh review;
  - deploy only with the user's go-ahead, then a check of the live endpoint (status and headers only) and the profile in both themes.
