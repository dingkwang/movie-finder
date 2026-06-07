import {
  candidatePreScore,
  isAcceptedChineseMovie,
  isLikelyChineseFromTms,
  isLikelyChineseSearchCandidate,
  parseYear,
  pickBestTmdbResult,
} from './movie-matching';
import { recordUsageEvent } from '../../lib/usage';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 30;
const TMDB_DETAIL_CANDIDATE_LIMIT = 8;
const SEARCH_RADIUS_MILES = 40;
const TMS_BASE = 'https://data.tmsapi.com/v1.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_LOOKUP_CONCURRENCY = 4;
const STANDARD_SEARCH_CACHE_SECONDS = 60 * 60 * 6;
const STANDARD_SEARCH_STALE_SECONDS = 60 * 60 * 12;
const TMDB_CACHE_SECONDS = 60 * 60 * 24 * 30;

export const maxDuration = 30;

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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createApiMetrics() {
  return {
    tmsRequestCount: 0,
    tmdbSearchCount: 0,
    tmdbDetailCount: 0,
    get tmdbRequestCount() {
      return this.tmdbSearchCount + this.tmdbDetailCount;
    },
  };
}

function successCacheHeaders() {
  return {
    'Cache-Control': `public, s-maxage=${STANDARD_SEARCH_CACHE_SECONDS}, stale-while-revalidate=${STANDARD_SEARCH_STALE_SECONDS}`,
  };
}

async function fetchTmdbJson(url, metrics, requestType) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (requestType === 'search') metrics.tmdbSearchCount++;
    if (requestType === 'detail') metrics.tmdbDetailCount++;
    const res = await fetch(url, {
      next: {
        revalidate: TMDB_CACHE_SECONDS,
        tags: ['tmdb-movies'],
      },
    });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt === 2) return null;
    await wait(500 * (attempt + 1));
  }
  return null;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function getShowtimesForDate(zip, date, metrics) {
  if (!process.env.TMS_API_KEY) throw new Error('TMS_API_KEY not configured');
  const url = `${TMS_BASE}/movies/showings?startDate=${date}&zip=${zip}&radius=${SEARCH_RADIUS_MILES}&api_key=${process.env.TMS_API_KEY}`;
  metrics.tmsRequestCount++;
  const res = await fetch(url, {
    next: {
      revalidate: STANDARD_SEARCH_CACHE_SECONDS,
      tags: [`tms-showtimes-${zip}-${date}`],
    },
  });
  if (!res.ok) throw new Error(`TMS error ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return [];
  return JSON.parse(text);
}

async function getShowtimes(zip, days, metrics) {
  const dates = Array.from({ length: days }, (_, i) => dateWithOffset(i));
  const batches = await Promise.all(dates.map(date => getShowtimesForDate(zip, date, metrics)));
  return batches.flat();
}

async function tmdbSearch(title, year, metrics) {
  if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY not configured');
  const q = encodeURIComponent(title);
  const yearParam = year ? `&year=${year}` : '';
  const url = `${TMDB_BASE}/search/movie?query=${q}&language=zh-CN${yearParam}&api_key=${process.env.TMDB_API_KEY}`;
  const data = await fetchTmdbJson(url, metrics, 'search');
  return data?.results ?? [];
}

async function tmdbDetails(id, metrics) {
  if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY not configured');
  const zhUrl = `${TMDB_BASE}/movie/${id}?language=zh-CN&append_to_response=alternative_titles,external_ids&api_key=${process.env.TMDB_API_KEY}`;
  const enUrl = `${TMDB_BASE}/movie/${id}?language=en-US&append_to_response=credits&api_key=${process.env.TMDB_API_KEY}`;
  const [zh, en] = await Promise.all([
    fetchTmdbJson(zhUrl, metrics, 'detail'),
    fetchTmdbJson(enUrl, metrics, 'detail'),
  ]);
  if (!zh) return null;
  return { ...zh, credits: en?.credits ?? zh.credits };
}

async function tmdbLookup(movie, metrics) {
  const year = parseYear(movie.releaseYear) ?? parseYear(movie.releaseDate);
  const searches = [tmdbSearch(movie.title, undefined, metrics)];
  if (year) searches.push(tmdbSearch(movie.title, year, metrics));
  if (year) searches.push(tmdbSearch(movie.title, year + 1, metrics));

  const searchResults = await Promise.all(searches);
  const byId = new Map();
  for (const result of searchResults.flat()) {
    if (result?.id) byId.set(result.id, result);
  }

  const sortedCandidates = Array.from(byId.values())
    .sort((a, b) => candidatePreScore(movie, b) - candidatePreScore(movie, a));
  const candidatesById = new Map();
  for (const candidate of sortedCandidates.filter(isLikelyChineseSearchCandidate)) {
    candidatesById.set(candidate.id, candidate);
  }
  if (isLikelyChineseFromTms(movie)) {
    for (const candidate of sortedCandidates.slice(0, 3)) {
      candidatesById.set(candidate.id, candidate);
    }
  }
  const candidates = Array.from(candidatesById.values()).slice(0, TMDB_DETAIL_CANDIDATE_LIMIT);
  const details = await Promise.all(candidates.map(candidate => tmdbDetails(candidate.id, metrics)));
  return pickBestTmdbResult(movie, details.filter(Boolean));
}

function movieKey(movie) {
  return movie.tmsId ?? movie.rootId ?? movie.title?.toLowerCase();
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
  const startedAt = Date.now();
  const metrics = createApiMetrics();
  const zip = request.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}$/.test(zip)) {
    return Response.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }
  const days = parseDays(request.nextUrl.searchParams.get('days'));

  try {
    const showings = mergeShowings(await getShowtimes(zip, days, metrics));

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
        topCast: m.topCast ?? [],
        directors: m.directors ?? [],
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
    const enriched = await mapWithConcurrency(
      movies,
      TMDB_LOOKUP_CONCURRENCY,
      async (m) => {
        const tmdb = await tmdbLookup(m, metrics);
        return { ...m, tmdb };
      }
    );

    const chinese = enriched.filter(m => isAcceptedChineseMovie(m, m.tmdb));

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

    await recordUsageEvent({
      eventType: 'movie_search_backend',
      zip,
      days,
      radius: SEARCH_RADIUS_MILES,
      resultCount: result.length,
      durationMs: Date.now() - startedAt,
      tmsRequestCount: metrics.tmsRequestCount,
      tmdbSearchCount: metrics.tmdbSearchCount,
      tmdbDetailCount: metrics.tmdbDetailCount,
      tmdbRequestCount: metrics.tmdbRequestCount,
      status: result.length > 0 ? 'success' : 'empty',
    }, request);

    return Response.json(result, { headers: successCacheHeaders() });
  } catch (err) {
    console.error(err);
    await recordUsageEvent({
      eventType: 'movie_search_backend',
      zip,
      days,
      radius: SEARCH_RADIUS_MILES,
      durationMs: Date.now() - startedAt,
      tmsRequestCount: metrics.tmsRequestCount,
      tmdbSearchCount: metrics.tmdbSearchCount,
      tmdbDetailCount: metrics.tmdbDetailCount,
      tmdbRequestCount: metrics.tmdbRequestCount,
      status: 'error',
      error: err.message,
    }, request);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
