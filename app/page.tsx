'use client';

import { useState } from 'react';

interface Showtime {
  theater: string;
  times: string[];
}

interface Movie {
  title: string;
  tmdbTitle: string;
  originalTitle: string;
  posterPath: string | null;
  overview: string;
  releaseDate: string;
  theaters: Showtime[];
}

export default function Home() {
  const [zip, setZip] = useState('');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function search() {
    if (!/^\d{5}$/.test(zip)) {
      setError('请输入 5 位美国邮编');
      setStatus('error');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`/api/movies?zip=${zip}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setMovies(data);
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setStatus('error');
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-center">🎬 附近华语院线</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">输入邮编，查找今天在附近放映的华语电影</p>

        <div className="flex gap-3 justify-center mb-10">
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            placeholder="例：94041"
            value={zip}
            onChange={e => setZip(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && search()}
            className="w-40 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-blue-500 text-center text-lg tracking-widest"
          />
          <button
            onClick={search}
            disabled={status === 'loading'}
            className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold transition-colors"
          >
            {status === 'loading' ? '查询中…' : '搜索'}
          </button>
        </div>

        {status === 'error' && (
          <p className="text-red-400 text-center mb-6">{error}</p>
        )}

        {status === 'done' && movies.length === 0 && (
          <div className="text-center">
            <p className="text-gray-500 mb-4">{zip} 附近今天没有华语院线排片</p>
            <a
              href={`/ai?q=${zip}`}
              className="inline-block px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
            >
              ✨ 用 AI 搜索（含影展 / 专映）
            </a>
          </div>
        )}

        {status === 'done' && movies.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {movies.map((m, i) => (
              <div key={i} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-gray-600 transition-colors">
                {m.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.posterPath} alt={m.title} className="w-full aspect-[2/3] object-cover" />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-600 text-sm">
                    无海报
                  </div>
                )}
                <div className="p-4">
                  <h2 className="font-bold text-lg leading-tight">{m.originalTitle || m.title}</h2>
                  {m.originalTitle && m.originalTitle !== m.title && (
                    <p className="text-gray-400 text-sm mt-0.5">{m.title}</p>
                  )}
                  {m.overview && (
                    <p className="text-gray-500 text-xs mt-2 line-clamp-3">{m.overview}</p>
                  )}
                  <div className="mt-4 space-y-2">
                    {m.theaters.map((t, j) => (
                      <div key={j}>
                        <p className="text-xs text-blue-400 font-medium truncate">{t.theater}</p>
                        <p className="text-xs text-gray-400">{t.times.join('  ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
