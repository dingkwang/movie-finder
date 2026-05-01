@AGENTS.md

# movie-finder

Next.js app that finds Chinese-language films currently showing in theaters near a US zip code.

## Architecture

- **Frontend** `app/page.tsx` — client component, zip input + movie card grid
- **API** `app/api/movies/route.js` — serverless function, no DB

### Data flow
1. Call TMS (Gracenote) `/movies/showings` with zip + radius → list of movies, each with nested `showtimes[]`
2. `Promise.all` TMDB title search for every unique movie
3. Filter by `original_language` in `{zh, cmn, yue, cn, zh-hans, zh-hant}`
4. Return enriched array to frontend

### TMS response shape (important)
TMS returns **one object per movie**, with all showtimes nested inside:
```json
[{ "tmsId": "...", "title": "...", "showtimes": [{ "theatre": { "name": "..." }, "dateTime": "2026-05-01T14:30" }] }]
```
Do **not** treat each item as a single showing — `theatre` lives inside `showtimes[]`, not at the top level.

## Dev

```bash
npm run dev      # localhost:3000
npm run build    # type-check + production build
```

## Environment variables

| Key | Where to get |
|-----|-------------|
| `TMS_API_KEY` | developer.tmsapi.com → My Account |
| `TMDB_API_KEY` | themoviedb.org → Settings → API |

Local: `.env.local` (gitignored). Production: Vercel dashboard → Settings → Environment Variables.

## Deploy

Push to `main` → Vercel auto-deploys. No manual step needed.

## Known limitations

- TMS only has current/upcoming showtimes — no historical data
- Hobby tier Vercel function timeout: 10 s. Parallel TMDB calls keep this well under budget for typical zip codes (~50 movies × fast fetch)
- TMDB title search can misidentify films with common English titles; filter may produce false negatives for Chinese films with unusual English-only titles
