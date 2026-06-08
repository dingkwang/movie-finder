<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# movie-finder

Next.js app that finds Chinese-language films currently showing in theaters near a US zip code.

## Project Overview

- Framework: Next.js App Router
- Deployment: Vercel
- Package manager: npm
- Runtime: Node.js on Vercel Functions unless explicitly marked Edge
- Primary goals: correctness, privacy, low latency, controlled external API cost

## Architecture

- **Frontend** `app/page.tsx` — client component, zip/date input + movie card grid
- **Movies API** `app/api/movies/route.js` — Vercel function, TMS showtimes + TMDB enrichment
- **Usage/admin** `app/lib/usage.js`, `app/api/usage/route.js`, `app/admin/page.tsx` — optional Postgres-backed dashboard

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
npm install      # install dependencies
npm run dev      # localhost:3000
npm run lint     # ESLint
npm test         # node --test
npm run build    # type-check + production build
```

Before finishing any code change, run the smallest relevant check first. Run `npm run build` when a change affects routing, rendering, API routes, caching, environment variables, or Vercel deployment behavior.

## Environment variables

| Key | Where to get |
|-----|-------------|
| `TMS_API_KEY` | developer.tmsapi.com → My Account |
| `TMDB_API_KEY` | themoviedb.org → Settings → API |
| `ADMIN_PASSWORD` | local/project secret for `/admin` |
| `DATABASE_URL` / `POSTGRES_URL` | Vercel Marketplace Postgres/Neon connection string |
| `USAGE_IP_SALT` | random secret used to hash IPs for usage metrics |

Local: `.env.local` (gitignored). Production: Vercel dashboard → Settings → Environment Variables.

## Deploy

Push to `main` → Vercel auto-deploys when the Git integration is active. Manual production deploys use `vercel deploy --prod` only after local validation passes.

## Known limitations

- TMS only has current/upcoming showtimes — no historical data
- Hobby tier Vercel function timeout: 10 s. Parallel TMDB calls keep this well under budget for typical zip codes (~50 movies × fast fetch)
- TMDB title search can misidentify films with common English titles; filter may produce false negatives for Chinese films with unusual English-only titles

## Shared Guidance

The repo-specific instructions are here. Shared Vercel / agent guidance lives in `~/.agent/AGENTS.md`, and the installed Vercel skills live in `~/.agent/skills`.

# Coding Principles

## Product truth over cleverness

- This app answers a narrow user question: "What Chinese-language theatrical movies can I watch near me soon?" Keep changes focused on that workflow.
- Do not imply completeness unless the data source supports it. TMS, TMDB, Google, Fandango, IMDb, and festival listings each cover different slices.
- When search results are empty, treat it as "not found by this pipeline", not proof that no screening exists.
- Prefer clear user-facing constraints over hidden magic: date range, radius, ZIP, source limitations, and loading state should be understandable.

## Location and privacy

- Use explicit user action for location detection. Do not silently infer location from IP for primary product behavior.
- If browser geolocation is used, convert latitude/longitude to ZIP server-side and avoid storing precise coordinates.
- Usage analytics should stay product-oriented: ZIP/date/range/result count/status/cost metrics. Avoid storing exact coordinates, raw IPs, or unnecessary personal data.
- Hash IPs with a salt when needed for abuse or unique-user estimates. Never expose hashes as identities.

## Data sources and matching

- Keep TMS as the source of truth for actual showtimes when using the standard cinema search.
- Use TMDB for enrichment and classification only: title matching, poster, overview, language, release metadata.
- Matching logic must be conservative enough to avoid showing unrelated movies, but not so strict that known Chinese releases are dropped because of English US titles.
- Add focused tests for title/year/language matching whenever changing movie filtering rules.

## Cost, latency, and caching

- Cache expensive standard search results by `zip + date` or `zip + date range` for 6-12 hours unless freshness requirements change.
- Cache TMDB enrichment much longer, normally 7-30 days, because movie metadata changes slowly.
- Count and surface TMS/TMDB fetches in admin metrics when adding new backend paths.
- Avoid background prewarm that can multiply cost unexpectedly. Prewarm only common locations and short date ranges unless explicitly approved.
- Keep APIs responsive for Vercel serverless limits; use bounded concurrency for enrichment.

## Date and geography semantics

- Dates are user-facing product state. Use concrete dates and the app timezone (`America/Los_Angeles`) when validating or explaining behavior.
- Search should only allow today through the next 30 days unless the product requirement changes.
- Radius-based searches are not strict ZIP-only results. ZIP is the center point for nearby theaters.
- If adding non-ZIP inputs such as city or current location, normalize them to the existing ZIP-centered query path unless a better showtimes API is added.

## UI behavior

- The first screen should remain the usable search experience, not a marketing page.
- Keep movie cards scannable: show summary counts first, hide long showtime lists behind explicit expansion, and group showtimes by date.
- Theater names with ticket URLs should be clickable when available.
- Do not expose internal provider/model names in routine user-facing status text.
- Chinese UI copy should be concise and natural for Chinese-speaking users in the US.

## Observability and admin

- Dashboard data must make operational questions answerable: how many searches, which ZIP/date ranges, error rate, result counts, cache behavior, and provider fetch cost.
- Do not claim the dashboard shows returned movie titles unless the schema explicitly records them.
- Admin pages must remain password protected and must not print secrets.
- Prefer privacy-preserving metrics over full request logs.

## Verification and deployment

- Before merging or deploying product changes, run `npm run lint`, `npm test`, and `npm run build`.
- For frontend behavior changes, verify the actual browser flow locally when practical.
- Do not deploy unvalidated changes to production.
- Keep PRs scoped: one product behavior change per PR when possible.
- Never paste `.env` secrets, API keys, database URLs, or admin passwords into chat or committed files.
