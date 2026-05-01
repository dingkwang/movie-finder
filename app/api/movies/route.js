const CHINESE_LANGS = new Set(['zh', 'cmn', 'yue', 'cn', 'zh-hans', 'zh-hant']);
const TMS_BASE = 'https://data.tmsapi.com/v1.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getShowtimes(zip) {
  const url = `${TMS_BASE}/movies/showings?startDate=${todayDate()}&zip=${zip}&radius=20&api_key=${process.env.TMS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMS error ${res.status}`);
  return res.json();
}

async function tmdbLookup(title) {
  const q = encodeURIComponent(title);
  const url = `${TMDB_BASE}/search/movie?query=${q}&api_key=${process.env.TMDB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] ?? null;
}

export async function GET(request) {
  const zip = request.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}$/.test(zip)) {
    return Response.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }

  try {
    const showings = await getShowtimes(zip);

    // TMS returns one entry per movie with nested showtimes[]
    const movies = showings.map(m => {
      const theaterMap = new Map();
      for (const st of m.showtimes ?? []) {
        const name = st.theatre?.name ?? 'Unknown';
        if (!theaterMap.has(name)) theaterMap.set(name, []);
        if (st.dateTime) theaterMap.get(name).push(st.dateTime.slice(11, 16));
      }
      return {
        title: m.title,
        tmsId: m.tmsId,
        theaters: Array.from(theaterMap.entries()).map(([theater, times]) => ({ theater, times })),
      };
    });

    // Parallel TMDB lookups
    const enriched = await Promise.all(
      movies.map(async (m) => {
        const tmdb = await tmdbLookup(m.title);
        return { ...m, tmdb };
      })
    );

    const chinese = enriched.filter(
      m => m.tmdb && CHINESE_LANGS.has(m.tmdb.original_language?.toLowerCase())
    );

    const result = chinese.map(m => ({
      title: m.title,
      tmdbTitle: m.tmdb.title,
      originalTitle: m.tmdb.original_title,
      posterPath: m.tmdb.poster_path
        ? `https://image.tmdb.org/t/p/w300${m.tmdb.poster_path}`
        : null,
      overview: m.tmdb.overview,
      releaseDate: m.tmdb.release_date,
      theaters: m.theaters,
    }));

    return Response.json(result);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
