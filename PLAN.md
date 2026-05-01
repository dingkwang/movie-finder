# Chinese Movie Finder — MVP Plan

## Context
Build a Next.js web app: user inputs a US zip code, app returns Chinese-language films currently showing in nearby theaters. Uses TMS (Gracenote) API for showtimes, TMDB to identify original language, filters for zh/cmn/yue. Deployed to Vercel as serverless functions — no separate backend needed.

---

## Project Setup

**Location:** `~/Desktop/movie-finder`

Bootstrap command (run by user after approval):
```bash
npx create-next-app@latest movie-finder --app --no-typescript --tailwind --no-src-dir
cd movie-finder
```

---

## File Structure

```
movie-finder/
├── app/
│   ├── layout.js             # Root layout (minimal, Tailwind base)
│   ├── page.jsx              # UI: zip input + movie results grid
│   └── api/
│       └── movies/
│           └── route.js      # Serverless API handler
├── .env.local                # API keys — gitignored
└── .gitignore                # ensure .env.local is listed
```

---

## API Route — `app/api/movies/route.js`

**Request:** `GET /api/movies?zip=94041`

**Flow:**
1. Read `zip` from query params; return 400 if missing
2. Call TMS showtimes endpoint:
   ```
   GET https://data.tmsapi.com/v1.1/movies/showings
     ?startDate={today YYYY-MM-DD}
     &zip={zip}
     &radius=20
     &api_key={process.env.TMS_API_KEY}
   ```
3. Deduplicate movies by `tmsId`; collect showtimes per movie
4. `Promise.all` — for each unique movie call TMDB:
   ```
   GET https://api.themoviedb.org/3/search/movie
     ?query={movie.title}
     &api_key={process.env.TMDB_API_KEY}
   ```
5. Filter: keep movies where `tmdb.results[0].original_language` is in `['zh', 'cmn', 'yue', 'cn']`
6. Return JSON array:
   ```json
   [
     {
       "title": "...",
       "tmdbTitle": "...",
       "posterPath": "https://image.tmdb.org/t/p/w300/...",
       "showtimes": [
         { "theater": "AMC ...", "times": ["10:30", "13:45"] }
       ]
     }
   ]
   ```

**Error handling:** wrap in try/catch, return 500 with message on API failure.

---

## Frontend — `app/page.jsx`

- Zip code `<input>` + "Search" `<button>`
- States: idle / loading / results / empty / error
- Results: responsive card grid
  - Movie poster (from TMDB image CDN, fallback placeholder)
  - Title
  - Theater name + showtime list
- Empty state message: `"No Chinese-language movies showing near {zip} today"`

No external UI library — plain Tailwind CSS.

---

## Environment Variables

**`.env.local`** (created manually, never committed):
```
TMS_API_KEY=your_gracenote_key
TMDB_API_KEY=your_tmdb_key
```

For Vercel: Project → Settings → Environment Variables — add both keys there before deploying.

---

## Critical Files to Create

| File | Purpose |
|------|---------|
| `app/api/movies/route.js` | Core serverless function |
| `app/page.jsx` | UI, replaces default Next.js page |
| `.env.local` | Keys (user fills in) |

---

## Verification

1. `npm run dev` → open `localhost:3000`
2. Test API directly: `localhost:3000/api/movies?zip=94041`
   - Expect JSON array (or empty array if no Chinese films today)
   - Check network tab for TMS / TMDB calls
3. Test UI: enter zip, click Search, confirm cards render with poster + showtimes
4. Test edge cases: invalid zip (e.g. `00000`), empty results
5. Check Vercel function logs after deploy for any timeout issues
