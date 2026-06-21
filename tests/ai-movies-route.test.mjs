import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GET } from '../app/api/ai-movies/route.js';

function requestFor(path, ip = '198.51.100.31') {
  return {
    nextUrl: new URL(`http://localhost${path}`),
    url: `http://localhost${path}`,
    headers: new Headers({
      'x-forwarded-for': ip,
      'user-agent': 'node-test',
    }),
  };
}

async function withAiSearchEnv(fn) {
  const previous = {
    SERP_API_KEY: process.env.SERP_API_KEY,
    XAI_API_KEY: process.env.XAI_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  };

  process.env.SERP_API_KEY = 'test-serp-key';
  delete process.env.XAI_API_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.SUPABASE_DB_URL;

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('AI movies route', () => {
  it('returns a setup error when SerpApi is not configured', async () => {
    const previous = process.env.SERP_API_KEY;
    delete process.env.SERP_API_KEY;

    try {
      const res = await GET(requestFor('/api/ai-movies?q=Dear%20You%2010017', '198.51.100.32'));
      const data = await res.json();
      assert.equal(res.status, 500);
      assert.equal(data.error, '网络补查暂未配置。');
    } finally {
      if (previous === undefined) delete process.env.SERP_API_KEY;
      else process.env.SERP_API_KEY = previous;
    }
  });

  it('structures Google showtimes from SerpApi without requiring the LLM', async () => {
    await withAiSearchEnv(async () => {
      const originalFetch = globalThis.fetch;
      let capturedUrl;
      globalThis.fetch = async (url) => {
        capturedUrl = new URL(String(url));
        return Response.json({
          search_metadata: {
            status: 'Success',
            google_url: 'https://www.google.com/search?q=Dear+You+showtimes',
          },
          knowledge_graph: {
            title: 'Dear You',
            description: 'A Teochew-language family drama.',
          },
          showtimes: [
            {
              theaters: [
                {
                  name: 'Regal Essex Crossing',
                  distance: '2.6 mi',
                  address: '129 Delancey Street, New York, NY 10002',
                  showing: [{ time: ['9:20am', '12:20pm'] }],
                },
                {
                  name: 'Regal Tangram',
                  distance: '7.2 mi',
                  address: '133-36 37th Avenue, Flushing, NY 11354',
                  showing: [{ time: ['11:00am'] }],
                },
              ],
            },
          ],
          organic_results: [
            {
              title: 'Dear You | Tickets & Showtimes Near Me',
              link: 'https://www.atomtickets.com/movies/dear-you/416182',
              snippet: 'Opening June 26. Advance tickets for Dear You on sale now.',
            },
          ],
        });
      };

      try {
        const res = await GET(requestFor(
          '/api/ai-movies?q=Dear%20You%20movie%20showtimes%20near%2010017%20June%2026%202026',
          '198.51.100.33'
        ));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(capturedUrl.hostname, 'serpapi.com');
        assert.equal(capturedUrl.searchParams.get('api_key'), 'test-serp-key');
        assert.equal(data.movies.length, 1);
        assert.equal(data.movies[0].title_en, 'Dear You');
        assert.equal(data.movies[0].confidence, 'high');
        assert.deepEqual(data.movies[0].theaters, [
          { name: 'Regal Essex Crossing · 2.6 mi', times: ['9:20am', '12:20pm'] },
          { name: 'Regal Tangram · 7.2 mi', times: ['11:00am'] },
        ]);
        assert.equal(data.meta.structuredShowtimes, 2);
        assert.equal(data.meta.llmUsed, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('does not create movie cards when SerpApi has no exact showtimes', async () => {
    await withAiSearchEnv(async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json({
        search_metadata: { status: 'Success' },
        organic_results: [
          {
            title: 'Dear You (Teochew) Movie Tickets and Showtimes Near Me',
            link: 'https://www.regmovies.com/movies/dear-you-teochew-ho00021912?date=06-26-2026',
            snippet: 'Dear You (Teochew) Movie tickets and showtimes at a Regal theatre near you.',
          },
        ],
      });

      try {
        const res = await GET(requestFor(
          '/api/ai-movies?q=site%3Aregmovies.com%2Fmovies%2Fdear-you-teochew-ho00021912%2006-26-2026',
          '198.51.100.34'
        ));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(data.movies, []);
        assert.equal(data.meta.structuredShowtimes, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('does not treat a theater-only organic result as a movie', async () => {
    await withAiSearchEnv(async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json({
        search_metadata: { status: 'Success' },
        organic_results: [
          {
            title: 'Regal Tangram Movie Tickets and Showtimes',
            link: 'https://www.regmovies.com/theatres/regal-tangram/1918',
            snippet: 'Get showtimes, buy movie tickets and more at Regal Tangram movie theatre in Flushing, NY.',
          },
        ],
      });

      try {
        const res = await GET(requestFor(
          '/api/ai-movies?q=Regal%20Tangram%20Chinese%20movie%20showtimes',
          '198.51.100.35'
        ));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(data.movies, []);
        assert.equal(data.meta.structuredShowtimes, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('does not show source-only theater pages for broad fallback queries', async () => {
    await withAiSearchEnv(async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => Response.json({
        search_metadata: { status: 'Success' },
        organic_results: [
          {
            title: 'Cinemark Imperial Valley Mall 14 - Movies & Showtimes',
            link: 'https://www.cinemark.com/theatres/ca-el-centro/cinemark-imperial-valley-mall-14',
            snippet: 'Movie theater information and tickets. Check showtimes at Cinemark Imperial Valley Mall 14.',
          },
        ],
      });

      try {
        const res = await GET(requestFor(
          '/api/ai-movies?q=10017%202026-06-21%20%E8%87%B3%202026-06-27%2010%20mile%20Chinese-language%20movie%20showtimes%20Cinemark%20Imperial%20Valley%20Mall%2014%20-%20Movies%20%26',
          '198.51.100.37'
        ));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.deepEqual(data.movies, []);
        assert.equal(data.meta.structuredShowtimes, 0);
        assert.equal(data.meta.llmUsed, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('uses Google movies_playing as candidates for a follow-up showtimes search', async () => {
    await withAiSearchEnv(async () => {
      const originalFetch = globalThis.fetch;
      const seenQueries = [];

      globalThis.fetch = async (url) => {
        const parsed = new URL(String(url));
        const q = parsed.searchParams.get('q') ?? '';
        seenQueries.push(q);

        if (q.toLowerCase().includes('movie in theater')) {
          return Response.json({
            search_metadata: {
              status: 'Success',
              google_url: 'https://www.google.com/search?q=movie+in+theater',
            },
            knowledge_graph: {
              breadcrumbs: ['Movies'],
              movies_playing: [
                {
                  name: 'The Furious',
                  link: 'https://www.google.com/search?q=the+furious+showtimes',
                  serpapi_link: 'https://serpapi.com/search.json?engine=google&q=the+furious+showtimes',
                  image: 'https://example.com/the-furious.jpg',
                },
              ],
            },
            organic_results: [],
          });
        }

        if (q.toLowerCase().includes('the furious showtimes')) {
          return Response.json({
            search_metadata: {
              status: 'Success',
              google_url: 'https://www.google.com/search?q=The+Furious+showtimes',
            },
            knowledge_graph: {
              title: 'The Furious',
              description: 'A revenge thriller.',
            },
            showtimes: [
              {
                theaters: [
                  {
                    name: 'Roxie Theater',
                    distance: '1.2 mi',
                    address: '3117 16th St, San Francisco, CA 94103',
                    showing: [{ time: ['12:40pm', '3:10pm'] }],
                  },
                ],
              },
            ],
            organic_results: [],
          });
        }

        return Response.json({ search_metadata: { status: 'Success' }, organic_results: [] });
      };

      try {
        const res = await GET(requestFor(
          '/api/ai-movies?q=movie%20in%20theater%20near%2094017',
          '198.51.100.36'
        ));
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.equal(data.movies.length, 1);
        assert.equal(data.movies[0].title_en, 'The Furious');
        assert.deepEqual(data.movies[0].theaters, [
          { name: 'Roxie Theater · 1.2 mi', times: ['12:40pm', '3:10pm'] },
        ]);
        assert.equal(data.meta.moviePlayingCandidates, 1);
        assert.equal(data.meta.candidateSearchesUsed, 1);
        assert.equal(data.meta.llmUsed, false);
        assert.ok(seenQueries.some(query => query.toLowerCase().includes('movie in theater')));
        assert.ok(seenQueries.some(query => query.toLowerCase().includes('the furious showtimes')));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
