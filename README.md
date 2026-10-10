# mal-stats-widget

MyAnimeList anime stats (totals, mean score, days watched and your 6 most recently watched titles) as an animated neon SVG card for your GitHub profile. Built with [@sm-steel/neon-kit](https://github.com/sm-steel/neon-kit) and served from a Vercel function.

## Usage

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://mal-stats-widget.vercel.app/api/mal?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://mal-stats-widget.vercel.app/api/mal?theme=light" />
  <img alt="MyAnimeList stats" src="https://mal-stats-widget.vercel.app/api/mal?theme=dark" width="100%" />
</picture>
```

## Configuration

| Env var | |
|---|---|
| `MAL_CLIENT_ID` | API client ID from https://myanimelist.net/apiconfig. A public "Web" client is enough; no OAuth login is needed. |
| `MAL_USERNAME` | The public MyAnimeList profile to read |

The widget reads your whole list through the official API v2 (`/users/{name}/animelist`, which works with just the client ID). **Days watched** is calculated as episodes watched × average episode duration, because the API only gives the precomputed total to OAuth-logged-in users. Posters use MyAnimeList's 116×180 CDN thumbnails (about 8 KB each) embedded in the SVG.

## Caching and errors

Cards are cached for 30 minutes at the CDN and served stale for up to an hour while refreshing. When something goes wrong (missing env, MAL error, timeout), the endpoint still returns a card reading `// SIGNAL LOST · <reason>`, and that card is never cached.

## Development

Tools are pinned with [mise](https://mise.jdx.dev): `mise install && npm ci`.

- `npm test`, `npm run lint`, `npm run typecheck`
- `npm run preview -- --env-file <file>` renders the card locally at http://127.0.0.1:8769/. The file holds `KEY=VALUE` lines, e.g. from `vercel env pull`.
- Pushing to `main` deploys to Vercel via `.github/workflows/deploy.yml`.
