const CHINESE_LANGS = new Set(['zh', 'cmn', 'yue', 'cn', 'zh-hans', 'zh-hant']);
const CHINESE_SHOWTIME_RE = /\b(cantonese|mandarin|chinese|putonghua|guangdonghua)\b/i;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 30;
const SEARCH_RADIUS_MILES = 40;
const TMS_BASE = 'https://data.tmsapi.com/v1.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateWithOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function parseDays(value) {
  const days = Number(value ?? DEFAULT_DAYS);
  if (!Number.isInteger(days) || days < 1) return DEFAULT_DAYS;
  return Math.min(days, MAX_DAYS);
}

async function getShowtimesForDate(zip, date) {
  if (!process.env.TMS_API_KEY) throw new Error('TMS_API_KEY not configured');
  const url = `${TMS_BASE}/movies/showings?startDate=${date}&zip=${zip}&radius=${SEARCH_RADIUS_MILES}&api_key=${process.env.TMS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMS error ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return [];
  return JSON.parse(text);
}

async function getShowtimes(zip, days) {
  const dates = Array.from({ length: days }, (_, i) => dateWithOffset(i));
  const batches = await Promise.all(dates.map(date => getShowtimesForDate(zip, date)));
  return batches.flat();
}

function normalizeTitle(title) {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseYear(value) {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function isChineseLanguage(language) {
  return CHINESE_LANGS.has(language?.toLowerCase());
}

function isLikelyChineseFromTms(movie) {
  if (isChineseLanguage(movie.titleLang) || isChineseLanguage(movie.descriptionLang)) return true;
  return (movie.showtimes ?? []).some(st => CHINESE_SHOWTIME_RE.test(st.quals ?? ''));
}

function scoreTmdbResult(movie, tmdb) {
  let score = 0;
  const movieTitle = normalizeTitle(movie.title);
  const tmdbTitle = normalizeTitle(tmdb.title);
  const tmdbOriginalTitle = normalizeTitle(tmdb.original_title);
  const movieYear = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  const tmdbYear = parseYear(tmdb.release_date);
  const exactTitle = tmdbTitle === movieTitle || tmdbOriginalTitle === movieTitle;
  const titleContains = movieTitle.length > 3 && (
    tmdbTitle.includes(movieTitle) || tmdbOriginalTitle.includes(movieTitle)
  );
  const chineseLanguage = isChineseLanguage(tmdb.original_language);
  const chineseTmsSignal = isLikelyChineseFromTms(movie);

  if (exactTitle) score += 80;
  else if (titleContains) score += 20;
  if (chineseLanguage && chineseTmsSignal) score += 100;
  if (chineseLanguage && !chineseTmsSignal && !exactTitle && !titleContains) score -= 100;

  if (movieYear && tmdbYear) {
    const distance = Math.abs(movieYear - tmdbYear);
    if (distance === 0) score += 25;
    else if (distance === 1) score += 8;
    else score -= Math.min(distance, 10);
  }

  return score;
}

function pickBestTmdbResult(movie, results = []) {
  return results
    .filter(Boolean)
    .sort((a, b) => scoreTmdbResult(movie, b) - scoreTmdbResult(movie, a))[0] ?? null;
}

async function tmdbSearch(title, year) {
  if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY not configured');
  const q = encodeURIComponent(title);
  const yearParam = year ? `&year=${year}` : '';
  const url = `${TMDB_BASE}/search/movie?query=${q}&language=zh-CN${yearParam}&api_key=${process.env.TMDB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.results ?? [];
}

async function tmdbLookup(movie) {
  const initialResults = await tmdbSearch(movie.title);
  const initialBest = pickBestTmdbResult(movie, initialResults);
  if (initialBest && isChineseLanguage(initialBest.original_language)) return initialBest;

  const year = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  if (!year || !isLikelyChineseFromTms(movie)) return initialBest;

  const yearResults = await tmdbSearch(movie.title, year);
  const byId = new Map();
  for (const result of [...(initialResults ?? []), ...(yearResults ?? [])]) {
    byId.set(result.id, result);
  }
  return pickBestTmdbResult(movie, Array.from(byId.values()));
}

function movieKey(movie) {
  return movie.tmsId ?? movie.rootId ?? normalizeTitle(movie.title);
}

function mergeShowings(showings) {
  const byMovie = new Map();
  for (const movie of showings) {
    const key = movieKey(movie);
    const existing = byMovie.get(key);
    if (!existing) {
      byMovie.set(key, { ...movie, showtimes: [...(movie.showtimes ?? [])] });
      continue;
    }
    existing.showtimes.push(...(movie.showtimes ?? []));
  }
  return Array.from(byMovie.values());
}

function formatShowtime(dateTime, days) {
  if (!dateTime) return null;
  const time = dateTime.slice(11, 16);
  if (days === 1) return time;
  return `${dateTime.slice(5, 10)} ${time}`;
}

function normalizeTicketUrl(url) {
  return url?.replace(/^http:/, 'https:') ?? null;
}

export async function GET(request) {
  const zip = request.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}$/.test(zip)) {
    return Response.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }
  const days = parseDays(request.nextUrl.searchParams.get('days'));

  try {
    const showings = mergeShowings(await getShowtimes(zip, days));

    // TMS returns one entry per movie with nested showtimes[]
    const movies = showings.map(m => {
      const theaterMap = new Map();
      const sortedShowtimes = [...(m.showtimes ?? [])].sort((a, b) => {
        return String(a.dateTime ?? '').localeCompare(String(b.dateTime ?? ''));
      });
      for (const st of sortedShowtimes) {
        const name = st.theatre?.name ?? 'Unknown';
        if (!theaterMap.has(name)) {
          theaterMap.set(name, { times: [], ticketUrl: normalizeTicketUrl(st.ticketURI) });
        }
        const time = formatShowtime(st.dateTime, days);
        const theater = theaterMap.get(name);
        if (time) theater.times.push(time);
        if (!theater.ticketUrl) theater.ticketUrl = normalizeTicketUrl(st.ticketURI);
      }
      return {
        title: m.title,
        tmsId: m.tmsId,
        releaseYear: m.releaseYear,
        releaseDate: m.releaseDate,
        titleLang: m.titleLang,
        descriptionLang: m.descriptionLang,
        longDescription: m.longDescription,
        theaters: Array.from(theaterMap.entries()).map(([theater, data]) => {
          return {
            theater,
            ticketUrl: data.ticketUrl,
            times: Array.from(new Set(data.times)),
          };
        }),
        showtimes: sortedShowtimes,
      };
    });

    // Parallel TMDB lookups
    const enriched = await Promise.all(
      movies.map(async (m) => {
        const tmdb = await tmdbLookup(m);
        return { ...m, tmdb };
      })
    );

    const chinese = enriched.filter(
      m => (m.tmdb && isChineseLanguage(m.tmdb.original_language)) || isLikelyChineseFromTms(m)
    );

    const result = chinese.map(m => ({
      title: m.title,
      tmdbTitle: m.tmdb?.title ?? m.title,
      originalTitle: m.tmdb?.original_title ?? m.title,
      posterPath: m.tmdb?.poster_path
        ? `https://image.tmdb.org/t/p/w300${m.tmdb.poster_path}`
        : null,
      overview: m.tmdb?.overview ?? m.longDescription ?? '',
      releaseDate: m.tmdb?.release_date ?? String(m.releaseDate ?? m.releaseYear ?? ''),
      theaters: m.theaters,
    }));

    return Response.json(result);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
