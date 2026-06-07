# Movie Finder

Next.js app for finding nearby Chinese-language theatrical showtimes.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Core search:

```bash
TMS_API_KEY=
TMDB_API_KEY=
```

Admin dashboard:

```bash
ADMIN_PASSWORD=
USAGE_IP_SALT=
DATABASE_URL=
```

`ADMIN_TOKEN` can be used instead of `ADMIN_PASSWORD`. For the database, the app also accepts `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `SUPABASE_DB_URL`.

## Usage Dashboard

Visit `/admin` and log in with `ADMIN_PASSWORD`.

The app creates a `usage_events` table automatically when a database URL is configured. User IPs are not stored directly; the app stores a SHA-256 hash using `USAGE_IP_SALT` when present.

The dashboard shows:

- daily searches
- estimated unique users by IP hash
- top ZIP codes
- search range distribution
- empty result rate
- TMS and TMDB request counts
- most expensive backend searches by external API calls
- slow queries
- recent errors
- recent usage events

TMS/TMDB counts represent backend `fetch` operations. Actual provider network calls can be lower when Next.js serves those fetches from its data cache.

Without a database URL, `/api/usage` returns `enabled:false` and the main search flow continues normally.

## Verification

```bash
npm run lint
npm test
npm run build
```
