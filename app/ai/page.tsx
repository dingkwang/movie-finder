'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

interface Theater {
  name: string;
  times: string[];
}

interface Movie {
  title_zh: string | null;
  title_en: string | null;
  description: string | null;
  theaters: Theater[];
  source_note: string;
}

function extractJSON(text: string): { movies: Movie[] } | null {
  const trimmed = text.trim();
  // try direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  // strip markdown code fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch { /* continue */ }
  // find first { ... } block
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* continue */ }
  return null;
}

function AiSearch() {
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [rawText, setRawText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const didAutoSearch = useRef(false);

  async function search(query = q) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setStatus('loading');
    setError('');
    setMovies([]);
    setRawText('');

    try {
      const res = await fetch(`/api/grok-movies?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // stream the response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }
      accumulated += decoder.decode();

      const parsed = extractJSON(accumulated);
      if (parsed) {
        setMovies(parsed.movies ?? []);
      } else {
        setRawText(accumulated);
      }
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  useEffect(() => {
    const initial = searchParams.get('q');
    if (initial && !didAutoSearch.current) {
      didAutoSearch.current = true;
      search(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-1 text-center">✨ AI 搜索</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">
          由 Grok 实时搜索，覆盖影展、专映、小影院
        </p>

        <div className="flex gap-3 justify-center mb-10">
          <input
            type="text"
            placeholder="城市或邮编，例：San Francisco / 94041"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            className="flex-1 max-w-sm px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-amber-500 text-sm"
          />
          <button
            onClick={() => search()}
            disabled={status === 'loading'}
            className="px-6 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-semibold transition-colors"
          >
            {status === 'loading' ? 'AI 搜索中…' : '搜索'}
          </button>
        </div>

        {status === 'loading' && (
          <p className="text-amber-400 text-center text-sm animate-pulse">
            Grok 正在搜索网络，需要 15–30 秒…
          </p>
        )}

        {status === 'error' && (
          <p className="text-red-400 text-center mb-6">{error}</p>
        )}

        {status === 'done' && movies.length === 0 && !rawText && (
          <p className="text-gray-500 text-center">AI 也没有找到附近的华语电影</p>
        )}

        {/* fallback: raw text when JSON parsing fails */}
        {status === 'done' && rawText && (
          <div className="bg-gray-900 rounded-xl p-6 border border-amber-900/40 text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">
            <span className="text-xs font-semibold bg-amber-600 text-white px-2 py-0.5 rounded-full mb-3 inline-block">AI</span>
            <p className="mt-2">{rawText}</p>
          </div>
        )}

        {status === 'done' && movies.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {movies.map((m, i) => (
              <div key={i} className="bg-gray-900 rounded-xl overflow-hidden border border-amber-900/40 hover:border-amber-700/60 transition-colors">
                <div className="w-full aspect-[2/3] bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center gap-2 px-4 text-center">
                  <span className="text-xs font-semibold bg-amber-600 text-white px-2 py-0.5 rounded-full">AI</span>
                  <p className="text-white font-bold text-lg leading-tight">
                    {m.title_zh ?? m.title_en ?? '未知片名'}
                  </p>
                  {m.title_zh && m.title_en && (
                    <p className="text-gray-400 text-xs">{m.title_en}</p>
                  )}
                </div>
                <div className="p-4">
                  {m.description && (
                    <p className="text-gray-400 text-xs mb-3 line-clamp-3">{m.description}</p>
                  )}
                  {m.theaters.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {m.theaters.map((t, j) => (
                        <div key={j}>
                          <p className="text-xs text-amber-400 font-medium truncate">{t.name}</p>
                          {t.times.length > 0 && (
                            <p className="text-xs text-gray-500">{t.times.join('  ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-gray-600 text-xs italic truncate">{m.source_note}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function AiPage() {
  return (
    <Suspense>
      <AiSearch />
    </Suspense>
  );
}
