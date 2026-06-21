// SerpApi (Google Search) grounding for the AI discovery path.
//
// The standard cinema search (TMS) and Google's structured "movie showtimes"
// onebox both miss indie/arthouse one-off Chinese screenings (e.g. a single
// festival night at the Roxie). Those screenings DO surface in Google's plain
// web results — theater calendar pages, festival pages, university event pages.
//
// This module fetches those organic results so the AI route can ground its
// answer in real pages instead of relying solely on the model's own web search.
// It is best-effort: no key, a timeout, or any error returns [] and the AI path
// continues to work on its own.
//
// Budget note: the Free SerpApi plan allows 250 searches/month, so results are
// cached per location (see SERPAPI_CACHE_SECONDS) to avoid spending a search on
// repeated lookups of the same place.

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const SERPAPI_FETCH_TIMEOUT_MS = 10_000;
const SERPAPI_CACHE_SECONDS = 60 * 60 * 6;
const GROUNDING_RESULT_LIMIT = 8;
const SHOWTIME_RESULT_LIMIT = 12;

export function serpApiConfigured() {
  return Boolean(process.env.SERP_API_KEY);
}

function normalizeQuery(value, maxLength = 180) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOrganicResult(result) {
  const title = String(result?.title ?? '').trim();
  const link = String(result?.link ?? '').trim();
  if (!title || !link) return null;
  return {
    title,
    link,
    snippet: String(result?.snippet ?? '').trim(),
    source: String(result?.source ?? '').trim(),
  };
}

function normalizeShowtimeTheater(theater) {
  const name = String(theater?.name ?? '').trim();
  if (!name) return null;
  const times = (theater?.showing ?? [])
    .flatMap(showing => showing?.time ?? [])
    .map(time => String(time ?? '').trim())
    .filter(Boolean);
  return {
    name,
    link: String(theater?.link ?? '').trim(),
    distance: String(theater?.distance ?? '').trim(),
    address: String(theater?.address ?? '').trim(),
    times: Array.from(new Set(times)),
  };
}

function normalizeShowtimes(showtimes) {
  if (!Array.isArray(showtimes)) return [];
  const byTheater = new Map();
  for (const group of showtimes) {
    for (const rawTheater of group?.theaters ?? []) {
      const theater = normalizeShowtimeTheater(rawTheater);
      if (!theater) continue;
      const existing = byTheater.get(theater.name);
      if (!existing) {
        byTheater.set(theater.name, theater);
        continue;
      }
      existing.times = Array.from(new Set([...existing.times, ...theater.times]));
      if (!existing.link) existing.link = theater.link;
      if (!existing.distance) existing.distance = theater.distance;
      if (!existing.address) existing.address = theater.address;
    }
  }
  return Array.from(byTheater.values()).slice(0, SHOWTIME_RESULT_LIMIT);
}

function normalizeKnowledgeGraph(knowledgeGraph) {
  if (!knowledgeGraph || typeof knowledgeGraph !== 'object') return null;
  return {
    title: String(knowledgeGraph.title ?? '').trim(),
    description: String(knowledgeGraph.description ?? '').trim(),
    type: String(knowledgeGraph.type ?? '').trim(),
    moviesPlaying: Array.isArray(knowledgeGraph.movies_playing)
      ? knowledgeGraph.movies_playing
        .map(movie => {
          const name = String(movie?.name ?? '').trim();
          if (!name) return null;
          return {
            name,
            link: String(movie?.link ?? '').trim(),
            serpapiLink: String(movie?.serpapi_link ?? '').trim(),
            image: String(movie?.image ?? '').trim(),
          };
        })
        .filter(Boolean)
      : [],
  };
}

async function searchSerpApi(params, tagKey) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${SERPAPI_BASE}?${params.toString()}`,
      {
        next: {
          revalidate: SERPAPI_CACHE_SECONDS,
          tags: [`serpapi-${tagKey}`],
        },
      },
      SERPAPI_FETCH_TIMEOUT_MS,
    );
  } catch {
    return null;
  }

  if (!res.ok) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Returns a small list of real web results for Chinese-language screenings near
// `location`. Always resolves; never throws. Empty array means "no grounding"
// (no key, error, or nothing found) — callers should degrade gracefully.
export async function searchChineseShowtimeGrounding(location) {
  if (!serpApiConfigured()) return [];
  const place = normalizeQuery(location, 80);
  if (!place) return [];

  const params = new URLSearchParams({
    engine: 'google',
    q: `chinese language movie showtimes near ${place}`,
    hl: 'en',
    gl: 'us',
    api_key: process.env.SERP_API_KEY,
  });

  const data = await searchSerpApi(params, `grounding-${place.toLowerCase()}`);
  if (data?.error || !Array.isArray(data?.organic_results)) return [];

  return data.organic_results
    .map(normalizeOrganicResult)
    .filter(Boolean)
    .slice(0, GROUNDING_RESULT_LIMIT);
}

export async function searchMovieShowtimeEvidence(query, options = {}) {
  if (!serpApiConfigured()) {
    return { configured: false, query: normalizeQuery(query), organicResults: [], showtimes: [], knowledgeGraph: null };
  }
  const q = normalizeQuery(query);
  if (!q) {
    return { configured: true, query: '', organicResults: [], showtimes: [], knowledgeGraph: null };
  }

  const params = new URLSearchParams({
    engine: 'google',
    q,
    hl: 'en',
    gl: 'us',
    api_key: process.env.SERP_API_KEY,
  });
  const location = normalizeQuery(options.location, 100);
  if (location) params.set('location', location);

  const data = await searchSerpApi(params, `movie-showtimes-${q.toLowerCase()}`);
  if (!data || data.error) {
    return { configured: true, query: q, organicResults: [], showtimes: [], knowledgeGraph: null };
  }

  return {
    configured: true,
    query: q,
    searchUrl: data.search_metadata?.google_url ?? null,
    organicResults: (data.organic_results ?? [])
      .map(normalizeOrganicResult)
      .filter(Boolean)
      .slice(0, GROUNDING_RESULT_LIMIT),
    showtimes: normalizeShowtimes(data.showtimes),
    knowledgeGraph: normalizeKnowledgeGraph(data.knowledge_graph),
  };
}
