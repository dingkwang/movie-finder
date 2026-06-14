import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GET } from '../app/api/movies/route.js';

function requestFor(path, ip = '198.51.100.10') {
  return {
    nextUrl: new URL(`http://localhost${path}`),
    headers: new Headers({
      'x-forwarded-for': ip,
      'user-agent': 'node-test',
    }),
  };
}

function withMovieApiEnv(fn) {
  const previous = {
    TMS_API_KEY: process.env.TMS_API_KEY,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  };

  process.env.TMS_API_KEY = 'test-tms-key';
  process.env.TMDB_API_KEY = 'test-tmdb-key';
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.SUPABASE_DB_URL;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function assertTmsFailureResponse({
  fetchImpl,
  expectedStatus,
  expectedError,
  ip,
}) {
  await withMovieApiEnv(async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    let errorLogged = false;
    globalThis.fetch = fetchImpl;

    try {
      console.error = () => {
        errorLogged = true;
      };
      const res = await GET(requestFor('/api/movies?zip=95129&radius=100&prewarm=1', ip));
      const data = await res.json();
      assert.equal(res.status, expectedStatus);
      assert.equal(data.error, expectedError);
      assert.ok(errorLogged, 'expected console.error to be called');
    } finally {
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
    }
  });
}

describe('movies API route', () => {
  it('uses 10 mile as the default search radius', async () => {
    await withMovieApiEnv(async () => {
      const originalFetch = globalThis.fetch;
      const tmsUrls = [];
      globalThis.fetch = async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          tmsUrls.push(new URL(textUrl));
          return new Response('[]', { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      };

      try {
        const res = await GET(requestFor('/api/movies?zip=95129&prewarm=1'));
        assert.equal(res.status, 200);
        assert.equal(tmsUrls.length, 1);
        assert.equal(tmsUrls[0].searchParams.get('radius'), '10');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('normalizes legacy 200 mile requests to the supported TMS radius', async () => {
    await withMovieApiEnv(async () => {
      const originalFetch = globalThis.fetch;
      const tmsUrls = [];
      globalThis.fetch = async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          tmsUrls.push(new URL(textUrl));
          return new Response('[]', { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      };

      try {
        const res = await GET(requestFor('/api/movies?zip=95129&radius=200&prewarm=1'));
        assert.equal(res.status, 200);
        assert.equal(tmsUrls.length, 1);
        assert.equal(tmsUrls[0].searchParams.get('radius'), '100');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('returns a user-facing message for TMS 400 responses', async () => {
    await assertTmsFailureResponse({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          return new Response('bad radius', { status: 400 });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      },
      expectedStatus: 400,
      expectedError: '院线数据源暂时无法处理这个查询，请缩小范围或换日期重试。',
      ip: '198.51.100.11',
    });
  });

  it('returns a server-side unavailable message for TMS auth failures', async () => {
    await assertTmsFailureResponse({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          return new Response('forbidden', { status: 403 });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      },
      expectedStatus: 502,
      expectedError: '院线数据源暂时不可用，请稍后重试。',
      ip: '198.51.100.12',
    });
  });

  it('returns a gateway error for TMS 5xx responses', async () => {
    await assertTmsFailureResponse({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          return new Response('upstream error', { status: 503 });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      },
      expectedStatus: 502,
      expectedError: '院线数据源暂时无法处理这个查询，请缩小范围或换日期重试。',
      ip: '198.51.100.13',
    });
  });

  it('returns a timeout message for TMS timeouts', async () => {
    await assertTmsFailureResponse({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (!textUrl.includes('data.tmsapi.com')) {
          throw new Error(`Unexpected fetch: ${textUrl}`);
        }

        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
      expectedStatus: 504,
      expectedError: '院线数据源响应超时，请稍后重试或缩小日期范围。',
      ip: '198.51.100.14',
    });
  });

  it('replaces generic Fandango TMS redirect links with movie search links', async () => {
    await withMovieApiEnv(async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('data.tmsapi.com')) {
          return Response.json([
            {
              title: 'The Furious',
              tmsId: 'MV027940780000',
              releaseYear: 2025,
              releaseDate: '2025-09-07',
              topCast: ['Xie Miao', 'Joe Taslim'],
              directors: ['Kenji Tanigaki'],
              showtimes: [
                {
                  dateTime: '2026-06-13T10:00',
                  ticketURI: 'http://www.fandango.com/tms.asp?t=AAYTC&m=319777&d=2026-06-13',
                  quals: 'Mandarin',
                  theatre: { name: 'AMC Sunnyvale 12' },
                },
              ],
            },
          ]);
        }
        if (textUrl.includes('api.themoviedb.org/3/search/movie')) {
          return Response.json({
            results: [
              {
                id: 1280738,
                title: '火遮眼',
                original_title: '火遮眼',
                // Deliberately en: The Furious is accepted through HK production
                // country plus Mandarin spoken language, not original_language.
                original_language: 'en',
                release_date: '2026-06-10',
                production_countries: [{ iso_3166_1: 'HK' }],
                spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
                alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'The Furious' }] },
              },
            ],
          });
        }
        if (textUrl.includes('api.themoviedb.org/3/movie/1280738')) {
          if (textUrl.includes('language=en-US')) {
            return Response.json({
              credits: {
                cast: [{ name: 'Xie Miao' }, { name: 'Joe Taslim' }],
                crew: [{ job: 'Director', name: 'Kenji Tanigaki' }],
              },
            });
          }
          return Response.json({
            id: 1280738,
            title: '火遮眼',
            original_title: '火遮眼',
            original_language: 'en',
            release_date: '2026-06-10',
            poster_path: '/poster.jpg',
            overview: 'A Chinese-language action film.',
            production_countries: [{ iso_3166_1: 'HK' }],
            spoken_languages: [{ iso_639_1: 'zh', english_name: 'Mandarin' }],
            alternative_titles: { titles: [{ iso_3166_1: 'US', title: 'The Furious' }] },
          });
        }
        throw new Error(`Unexpected fetch: ${textUrl}`);
      };

      try {
        const res = await GET(requestFor('/api/movies?zip=94041&date=2026-06-13&radius=40&prewarm=1'));
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.length, 1);
        assert.equal(
          data[0].theaters[0].ticketUrl,
          'https://www.fandango.com/search?q=The%20Furious%202026'
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
