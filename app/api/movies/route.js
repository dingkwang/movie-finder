import {
  candidatePreScore,
  isAcceptedChineseMovie,
  isLikelyChineseFromTms,
  isLikelyChineseSearchCandidate,
  inferOriginalAudio,
  parseYear,
  pickBestTmdbResult,
} from './movie-matching.js';
import { checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';
import { recordUsageEvent } from '../../lib/usage.js';

const DEFAULT_RANGE_DAYS = 1;
const MAX_RANGE_DAYS = 30;
const APP_TIME_ZONE = 'America/Los_Angeles';
const TMDB_DETAIL_CANDIDATE_LIMIT = 8;
const SEARCH_RADIUS_OPTIONS = new Set([10, 40, 100, 200]);
const DEFAULT_SEARCH_RADIUS_MILES = 40;
const MAX_TMS_RADIUS_MILES = 100;
const TMS_BASE = 'https://data.tmsapi.com/v1.1';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMS_LOOKUP_CONCURRENCY = 3;
const TMDB_LOOKUP_CONCURRENCY = 4;
const STANDARD_SEARCH_CACHE_SECONDS = 60 * 60 * 6;
const STANDARD_SEARCH_STALE_SECONDS = 60 * 60 * 12;
const TMDB_CACHE_SECONDS = 60 * 60 * 24 * 30;
const TMS_FETCH_TIMEOUT_MS = 10_000;
const TMDB_FETCH_TIMEOUT_MS = 8_000;

export const maxDuration = 30;

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDateString() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return formatUtcDate(date);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${endDate}T12:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && formatUtcDate(date) === value;
}

function dateRange(startDate, endDate) {
  const days = daysBetweenInclusive(startDate, endDate);
  return Array.from({ length: days }, (_, index) => addDays(startDate, index));
}

function parseSearchRange(searchParams) {
  const today = todayDateString();
  const maxDate = addDays(today, MAX_RANGE_DAYS - 1);
  const dateParam = searchParams.get('date');

  if (dateParam) {
    if (!isValidDateString(dateParam)) {
      throw new Error('日期格式必须是 YYYY-MM-DD');
    }
    if (dateParam < today) {
      throw new Error('只能查询今天或未来日期');
    }
    if (dateParam > maxDate) {
      throw new Error('最多只能查询未来 30 天内的日期');
    }
    return { startDate: dateParam, endDate: dateParam, days: 1, dates: [dateParam] };
  }

  const startParam = searchParams.get('startDate');
  const endParam = searchParams.get('endDate');
  if (startParam || endParam) {
    const startDate = startParam || today;
    const endDate = endParam || startDate;
    if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
      throw new Error('日期格式必须是 YYYY-MM-DD');
    }
    if (startDate < today || endDate < today) {
      throw new Error('只能查询今天或未来日期');
    }
    if (startDate > endDate) {
      throw new Error('结束日期不能早于开始日期');
    }
    if (endDate > maxDate) {
      throw new Error('最多只能查询未来 30 天内的日期');
    }
    const days = daysBetweenInclusive(startDate, endDate);
    if (days > MAX_RANGE_DAYS) {
      throw new Error('日期范围最多 30 天');
    }
    return { startDate, endDate, days, dates: dateRange(startDate, endDate) };
  }

  const requestedDays = Number(searchParams.get('days') ?? DEFAULT_RANGE_DAYS);
  const days = Number.isInteger(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, MAX_RANGE_DAYS)
    : DEFAULT_RANGE_DAYS;
  const startDate = today;
  const endDate = addDays(today, days - 1);
  return { startDate, endDate, days, dates: dateRange(startDate, endDate) };
}

function parseSearchRadius(searchParams) {
  const requestedRadius = Number(searchParams.get('radius') ?? DEFAULT_SEARCH_RADIUS_MILES);
  if (!Number.isInteger(requestedRadius) || !SEARCH_RADIUS_OPTIONS.has(requestedRadius)) {
    throw new Error('搜索范围必须是 10、40、100 mile，旧的 200 mile 链接会自动按 100 mile 查询');
  }
  return Math.min(requestedRadius, MAX_TMS_RADIUS_MILES);
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

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${label} timeout`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTmdbJson(url, metrics, requestType) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (requestType === 'search') metrics.tmdbSearchCount++;
    if (requestType === 'detail') metrics.tmdbDetailCount++;
    let res;
    try {
      res = await fetchWithTimeout(url, {
        next: {
          revalidate: TMDB_CACHE_SECONDS,
          tags: ['tmdb-movies'],
        },
      }, TMDB_FETCH_TIMEOUT_MS, 'TMDB');
    } catch {
      return null;
    }
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

async function getShowtimesForDate(zip, date, radius, metrics) {
  if (!process.env.TMS_API_KEY) throw new Error('TMS_API_KEY not configured');
  const url = `${TMS_BASE}/movies/showings?startDate=${date}&zip=${zip}&radius=${radius}&api_key=${process.env.TMS_API_KEY}`;
  metrics.tmsRequestCount++;
  const res = await fetchWithTimeout(url, {
    next: {
      revalidate: STANDARD_SEARCH_CACHE_SECONDS,
      tags: [`tms-showtimes-${zip}-${date}-${radius}`],
    },
  }, TMS_FETCH_TIMEOUT_MS, 'TMS');
  if (!res.ok) {
    const error = new Error(`TMS error ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  if (!text.trim()) return [];
  return JSON.parse(text);
}

async function getShowtimes(zip, date, radius, metrics) {
  if (Array.isArray(date)) {
    const batches = await mapWithConcurrency(
      date,
      TMS_LOOKUP_CONCURRENCY,
      item => getShowtimesForDate(zip, item, radius, metrics)
    );
    return batches.flat();
  }
  return getShowtimesForDate(zip, date, radius, metrics);
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

function formatShowtime(dateTime, includeDate) {
  if (!dateTime) return null;
  const time = dateTime.slice(11, 16);
  if (!includeDate) return time;
  return `${dateTime.slice(5, 10)} ${time}`;
}

function normalizeTicketUrl(url) {
  return url?.replace(/^http:/, 'https:') ?? null;
}

function errorResponse(err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  const providerStatus = err instanceof Error && err.status != null
    ? Number(err.status)
    : null;

  if (message === 'TMS timeout') {
    return {
      status: 504,
      message: '院线数据源响应超时，请稍后重试或缩小日期范围。',
    };
  }

  if (message.startsWith('TMS error')) {
    if (providerStatus === 401 || providerStatus === 403) {
      return {
        status: 502,
        message: '院线数据源暂时不可用，请稍后重试。',
      };
    }
    return {
      status: providerStatus && providerStatus >= 500 ? 502 : 400,
      message: '院线数据源暂时无法处理这个查询，请缩小范围或换日期重试。',
    };
  }

  return { status: 500, message };
}

export async function GET(request) {
  const startedAt = Date.now();
  const metrics = createApiMetrics();
  const shouldRecordUsage = request.nextUrl.searchParams.get('prewarm') !== '1';
  const zip = request.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}$/.test(zip)) {
    return Response.json({ error: 'Valid 5-digit zip required' }, { status: 400 });
  }
  let range;
  let radius;
  try {
    range = parseSearchRange(request.nextUrl.searchParams);
    radius = parseSearchRadius(request.nextUrl.searchParams);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  const { startDate, endDate, days, dates } = range;
  const includeShowtimeDate = days > 1 || startDate !== todayDateString();

  try {
    // Rate limiting only covers requests that reach this function. Successful
    // responses are sent with `s-maxage` (see successCacheHeaders), so the CDN
    // serves repeats of an identical URL from the edge without invoking this
    // handler — those never increment a bucket. That is intentional: a CDN hit
    // costs no TMS/TMDB calls, so it needs no limiting. The limiter guards the
    // CDN-miss traffic (varied zip/date/radius), which is what actually spends.
    const rateLimit = await checkRateLimit({
      request,
      endpoint: 'movies',
      zip,
      days,
      radius,
    });
    if (rateLimit.limited) {
      if (shouldRecordUsage) {
        await recordUsageEvent({
          eventType: 'movie_search_backend',
          zip,
          days,
          startDate,
          endDate,
          radius,
          durationMs: Date.now() - startedAt,
          tmsRequestCount: 0,
          tmdbSearchCount: 0,
          tmdbDetailCount: 0,
          tmdbRequestCount: 0,
          status: 'rate_limited',
          error: rateLimit.reason,
        }, request);
      }
      return Response.json(
        { error: '请求太频繁，请稍后再试。' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const showings = mergeShowings(await getShowtimes(zip, dates, radius, metrics));

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
        const time = formatShowtime(st.dateTime, includeShowtimeDate);
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
      originalAudio: inferOriginalAudio(m, m.tmdb),
      theaters: m.theaters,
    }));

    if (shouldRecordUsage) {
      await recordUsageEvent({
        eventType: 'movie_search_backend',
        zip,
        days,
        startDate,
        endDate,
        radius,
        resultCount: result.length,
        durationMs: Date.now() - startedAt,
        tmsRequestCount: metrics.tmsRequestCount,
        tmdbSearchCount: metrics.tmdbSearchCount,
        tmdbDetailCount: metrics.tmdbDetailCount,
        tmdbRequestCount: metrics.tmdbRequestCount,
        status: result.length > 0 ? 'success' : 'empty',
      }, request);
    }

    return Response.json(result, { headers: successCacheHeaders() });
  } catch (err) {
    console.error(err);
    const response = errorResponse(err);
    if (shouldRecordUsage) {
      await recordUsageEvent({
        eventType: 'movie_search_backend',
        zip,
        days,
        startDate,
        endDate,
        radius,
        durationMs: Date.now() - startedAt,
        tmsRequestCount: metrics.tmsRequestCount,
        tmdbSearchCount: metrics.tmdbSearchCount,
        tmdbDetailCount: metrics.tmdbDetailCount,
        tmdbRequestCount: metrics.tmdbRequestCount,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      }, request);
    }
    return Response.json({ error: response.message }, { status: response.status });
  }
}
