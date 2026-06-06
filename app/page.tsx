'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

interface Showtime {
  theater: string;
  times: string[];
  ticketUrl: string | null;
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

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const rangeOptions = [
  { days: 1, label: '今天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
];

const visibleTimesCount = 6;

export default function Home() {
  const [zip, setZip] = useState('');
  const [days, setDays] = useState(30);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (status !== 'loading') return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  async function search() {
    if (!/^\d{5}$/.test(zip)) {
      setError('请输入 5 位美国邮编');
      setStatus('error');
      return;
    }
    startTimeRef.current = Date.now();
    setElapsed(0);
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`/api/movies?zip=${zip}&days=${days}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setMovies(data);
      setElapsed(Math.round((Date.now() - startTimeRef.current) / 100) / 10);
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
        <p className="text-gray-400 text-center mb-8 text-sm">输入邮编，查找附近已有排片的华语电影</p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-3">
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
          <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900 p-1">
            {rangeOptions.map(option => (
              <button
                key={option.days}
                type="button"
                onClick={() => setDays(option.days)}
                className={`h-9 min-w-16 px-3 rounded-md text-sm font-medium transition-colors ${
                  days === option.days
                    ? 'bg-gray-100 text-gray-950'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={search}
            disabled={status === 'loading'}
            className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold transition-colors"
          >
            {status === 'loading' ? `查询中… ${fmtTime(elapsed)}` : '搜索'}
          </button>
        </div>

        <div className="h-6 flex items-center justify-center mb-7">
          {status === 'done' && (
            <span className="text-xs text-gray-500">
              {movies.length > 0 ? `找到 ${movies.length} 部` : '无结果'} · 用时 {fmtTime(elapsed)}
            </span>
          )}
        </div>

        {status === 'error' && (
          <p className="text-red-400 text-center mb-6">{error}</p>
        )}

        {status === 'done' && movies.length === 0 && (
          <div className="text-center">
            <p className="text-gray-500 mb-4">{zip} 附近未来 {days} 天没有华语院线排片</p>
            <Link
              href={`/ai?q=${zip}`}
              className="inline-block px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors"
            >
              ✨ 用 AI 搜索（含影展 / 专映）
            </Link>
          </div>
        )}

        {status === 'done' && movies.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {movies.map((m, i) => (
              <div key={i} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-gray-600 transition-colors">
                {m.posterPath ? (
                  <div className="relative w-full aspect-[2/3]">
                    <Image src={m.posterPath} alt={m.title} fill className="object-cover" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                  </div>
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
                    {m.theaters.map((t, j) => {
                      const visibleTimes = t.times.slice(0, visibleTimesCount);
                      const hiddenCount = Math.max(t.times.length - visibleTimes.length, 0);

                      return (
                      <div key={j} className="border-t border-gray-800 pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-2">
                          {t.ticketUrl ? (
                            <a
                              href={t.ticketUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="min-w-0 flex-1 truncate text-xs text-blue-400 font-medium hover:text-blue-300 underline-offset-2 hover:underline"
                            >
                              {t.theater}
                            </a>
                          ) : (
                            <p className="min-w-0 flex-1 truncate text-xs text-blue-400 font-medium">{t.theater}</p>
                          )}
                          {t.ticketUrl && (
                            <a
                              href={t.ticketUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:border-blue-400 hover:text-white"
                            >
                              购票
                            </a>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {visibleTimes.map(time => (
                            <span key={time} className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300">
                              {time}
                            </span>
                          ))}
                          {hiddenCount > 0 && (
                            <span className="rounded bg-gray-950 px-1.5 py-0.5 text-[11px] text-gray-500">
                              还有 {hiddenCount} 场
                            </span>
                          )}
                        </div>
                      </div>
                      );
                    })}
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
