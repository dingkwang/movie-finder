import { xai } from '@ai-sdk/xai';
import { generateObject, jsonSchema } from 'ai';
import { searchMovieShowtimeEvidence } from '../../lib/serpapi.js';
import { checkRateLimit, rateLimitHeaders } from '../../lib/rate-limit.js';

export const maxDuration = 60;

const AI_EXTRACTION_TIMEOUT_MS = 15_000;
const AI_SEARCH_CACHE_SECONDS = 60 * 60 * 6;
const AI_SEARCH_STALE_SECONDS = 60 * 60 * 12;
const MOVIE_RESULT_LIMIT = 8;

const extractionSchema = jsonSchema({
  type: 'object',
  additionalProperties: false,
  required: ['movies'],
  properties: {
    movies: {
      type: 'array',
      maxItems: MOVIE_RESULT_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title_zh', 'title_en', 'description', 'theaters', 'source_note', 'source_url', 'confidence'],
        properties: {
          title_zh: { type: ['string', 'null'] },
          title_en: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          theaters: {
            type: 'array',
            maxItems: 16,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'times'],
              properties: {
                name: { type: 'string' },
                times: {
                  type: 'array',
                  maxItems: 24,
                  items: { type: 'string' },
                },
              },
            },
          },
          source_note: { type: 'string' },
          source_url: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function requestUrl(request) {
  return request.nextUrl ?? new URL(request.url);
}

function normalizeQuery(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
}

function successCacheHeaders() {
  return {
    'Cache-Control': `public, s-maxage=${AI_SEARCH_CACHE_SECONDS}, stale-while-revalidate=${AI_SEARCH_STALE_SECONDS}`,
  };
}

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() ?? null;
}

function inferTitleFromQuery(query) {
  const cleaned = normalizeQuery(query)
    .replace(/\b(movie|film|showtimes?|tickets?|near|playing|opens?|opening)\b/ig, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/ig, ' ')
    .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/ig, ' ')
    .replace(/\b(am|pm|ny|nyc|new york|ca|la|sf)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function inferTitleFromSourceTitle(title) {
  const cleaned = normalizeQuery(title)
    .split('|')[0]
    .replace(/\b(movie tickets?|showtimes?|near me|at an AMC theatre near you)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function sourceUrls(evidence) {
  return new Set([
    evidence.searchUrl,
    ...evidence.organicResults.map(result => result.link),
    ...evidence.showtimes.map(theater => theater.link),
  ].filter(Boolean));
}

function compactEvidence(evidence) {
  return {
    query: evidence.query,
    knowledgeGraph: evidence.knowledgeGraph,
    structuredShowtimes: evidence.showtimes,
    organicResults: evidence.organicResults,
  };
}

function evidenceText(evidence) {
  return JSON.stringify(compactEvidence(evidence)).toLowerCase();
}

function normalizeTime(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function hasTimeEvidence(time, evidence) {
  const normalized = normalizeTime(time);
  if (!normalized) return false;
  const structuredTimes = evidence.showtimes.flatMap(theater => theater.times).map(normalizeTime);
  return structuredTimes.includes(normalized) || evidenceText(evidence).includes(normalized);
}

function isKnownSourceUrl(url, evidence) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('google.com')) return true;
  } catch {
    return false;
  }
  return sourceUrls(evidence).has(url);
}

function sanitizeMovie(movie, evidence) {
  const titleZh = firstNonEmpty(movie?.title_zh);
  const titleEn = firstNonEmpty(movie?.title_en);
  const sourceUrl = isKnownSourceUrl(movie?.source_url, evidence) ? (movie?.source_url ?? null) : null;
  const theaters = Array.isArray(movie?.theaters)
    ? movie.theaters
      .map(theater => {
        const name = firstNonEmpty(theater?.name);
        if (!name) return null;
        const times = Array.isArray(theater?.times)
          ? Array.from(new Set(theater.times.map(String).filter(time => hasTimeEvidence(time, evidence))))
          : [];
        return { name, times };
      })
      .filter(Boolean)
    : [];

  if (!titleZh && !titleEn && theaters.length === 0 && !sourceUrl) return null;
  return {
    title_zh: titleZh,
    title_en: titleEn,
    description: firstNonEmpty(movie?.description),
    theaters,
    source_note: firstNonEmpty(movie?.source_note) ?? '查看来源确认排片',
    source_url: sourceUrl,
    confidence: ['high', 'medium', 'low'].includes(movie?.confidence) ? movie.confidence : 'low',
  };
}

function sanitizeMovies(movies, evidence) {
  if (!Array.isArray(movies)) return [];
  return movies.map(movie => sanitizeMovie(movie, evidence)).filter(Boolean).slice(0, MOVIE_RESULT_LIMIT);
}

function deterministicMovies(query, evidence) {
  const preferredSource = evidence.organicResults.find(result => {
    return /regmovies|amctheatres|atomtickets|fandango/i.test(result.link);
  }) ?? evidence.organicResults[0];
  const title = firstNonEmpty(
    evidence.knowledgeGraph?.title,
    inferTitleFromSourceTitle(preferredSource?.title),
    inferTitleFromQuery(query)
  );
  const description = firstNonEmpty(evidence.knowledgeGraph?.description);

  if (evidence.showtimes.length > 0) {
    return [{
      title_zh: null,
      title_en: title,
      description,
      theaters: evidence.showtimes.map(theater => ({
        name: theater.distance ? `${theater.name} · ${theater.distance}` : theater.name,
        times: theater.times,
      })),
      source_note: 'Google 排片卡片',
      source_url: preferredSource?.link ?? evidence.searchUrl ?? null,
      confidence: 'high',
    }];
  }

  if (preferredSource) {
    return [{
      title_zh: null,
      title_en: title,
      description,
      theaters: [],
      source_note: '找到相关购票/影院来源，点开确认时间',
      source_url: preferredSource.link,
      confidence: 'low',
    }];
  }

  return [];
}

async function extractWithLlm(query, evidence) {
  if (!process.env.XAI_API_KEY) return null;

  try {
    const result = await generateObject({
      model: xai.responses('grok-4-1-fast-non-reasoning'),
      schema: extractionSchema,
      temperature: 0,
      abortSignal: AbortSignal.timeout(AI_EXTRACTION_TIMEOUT_MS),
      system: `You extract Chinese-language movie showtime facts from SerpApi evidence only.

Rules:
- Use only the provided evidence. Do not use outside knowledge.
- Only output a movie if the evidence has a real source page or Google showtimes entry for it.
- Only include theater times if the exact time appears in structuredShowtimes or a provided organic result/snippet.
- If a source page exists but no time is visible in evidence, keep theaters empty or times empty and set confidence "low".
- source_url must be one of the provided source URLs.
- Text intended for users should be Simplified Chinese, except English movie titles and theater names.`,
      prompt: JSON.stringify({
        today: today(),
        userQuery: query,
        evidence: compactEvidence(evidence),
      }, null, 2),
    });
    return sanitizeMovies(result.object?.movies, evidence);
  } catch (error) {
    console.error('ai showtime extraction failed', error);
    return null;
  }
}

function zipFromQuery(query) {
  return query.match(/\b\d{5}\b/)?.[0] ?? undefined;
}

export async function GET(request) {
  const url = requestUrl(request);
  const q = normalizeQuery(url.searchParams.get('q'));
  if (!q) {
    return Response.json({ error: 'Location required' }, { status: 400 });
  }

  const rateLimit = await checkRateLimit({
    request,
    endpoint: 'ai-movies',
    zip: zipFromQuery(q),
    days: 1,
    radius: 10,
  });
  if (rateLimit.limited) {
    return Response.json(
      { error: '请求太频繁，请稍后再试。' },
      { status: 429, headers: rateLimitHeaders(rateLimit) }
    );
  }

  const evidence = await searchMovieShowtimeEvidence(q);
  if (!evidence.configured) {
    return Response.json({ error: '网络补查暂未配置。' }, { status: 500 });
  }

  const fallback = deterministicMovies(q, evidence);
  const extracted = await extractWithLlm(q, evidence);
  const movies = extracted?.length ? extracted : fallback;

  return Response.json({
    movies,
    meta: {
      source: 'serpapi',
      structuredShowtimes: evidence.showtimes.length,
      organicResults: evidence.organicResults.length,
      llmUsed: Boolean(extracted),
    },
  }, { headers: successCacheHeaders() });
}
