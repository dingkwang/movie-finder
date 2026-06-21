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
  source_url: string | null;
  confidence?: 'high' | 'medium' | 'low';
}

function extractJSON(text: string): { movies: Movie[] } | null {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch { /* continue */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* continue */ }
  return null;
}

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function confidenceLabel(confidence: Movie['confidence']) {
  if (confidence === 'high') return '已提取排片';
  if (confidence === 'medium') return '有来源';
  return '需确认';
}

function AiSearch() {
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [rawText, setRawText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(0);
  const didAutoSearch = useRef(false);

  useEffect(() => {
    if (status !== 'loading') return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  async function search(query = q) {
    const trimmed = query.trim();
    if (!trimmed) return;
    startTimeRef.current = Date.now();
    setElapsed(0);
    setStatus('loading');
    setError('');
    setMovies([]);
    setRawText('');

    try {
      const res = await fetch(`/api/ai-movies?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

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
      setElapsed(Math.round((Date.now() - startTimeRef.current) / 100) / 10);
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
        <h1 className="text-3xl font-bold mb-1 text-center">网络补查</h1>
        <p className="text-gray-400 text-center mb-2 text-sm">
          搜索网页来源，补查标准院线源可能漏掉的排片
        </p>
        <p className="text-yellow-600/80 text-center mb-8 text-xs">
          ⚠️ AI 结果仅供参考，请点击来源链接确认实际放映时间
        </p>

        <div className="flex gap-3 justify-center mb-3">
          <input
            type="text"
            placeholder="例：Dear You showtimes near 10017 June 26 2026"
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
            {status === 'loading' ? `搜索中… ${fmtTime(elapsed)}` : '搜索'}
          </button>
        </div>

        <div className="h-6 flex items-center justify-center mb-7">
          {status === 'loading' && (
            <span className="text-amber-500/70 text-xs">正在搜索网络…</span>
          )}
          {status === 'done' && (
            <span className="text-xs text-gray-500">
              {movies.length > 0 ? `找到 ${movies.length} 部` : rawText ? 'AI 回复' : '无结果'} · 用时 {fmtTime(elapsed)}
            </span>
          )}
        </div>

        {status === 'error' && (
          <p className="text-red-400 text-center mb-6">{error}</p>
        )}

        {status === 'done' && movies.length === 0 && !rawText && (
          <p className="text-gray-500 text-center">没有在网页结果里找到可用来源</p>
        )}

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
                  <span className="text-xs font-semibold bg-amber-600 text-white px-2 py-0.5 rounded-full">
                    {confidenceLabel(m.confidence)}
                  </span>
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
                  {m.theaters.length === 0 && (
                    <p className="mb-3 text-xs text-gray-500">搜索结果里没有可直接提取的具体时间，请点来源确认。</p>
                  )}
                  {m.source_url ? (
                    <a href={m.source_url} target="_blank" rel="noopener noreferrer" className="text-amber-600/70 hover:text-amber-500 text-xs underline underline-offset-2 truncate block">
                      {m.source_note || '查看来源'}
                    </a>
                  ) : (
                    <p className="text-gray-600 text-xs italic truncate">{m.source_note}</p>
                  )}
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
