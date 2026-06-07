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

interface DateShowing {
  time: string;
  theater: string;
  ticketUrl: string | null;
}

interface ShowtimeDateGroup {
  date: string;
  showings: DateShowing[];
}

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const rangeOptions = [
  { days: 1, label: '今天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
];

const visibleShowingsPerDate = 8;

function movieKey(movie: Movie) {
  return `${movie.title}-${movie.releaseDate}`;
}

function splitShowtimeLabel(label: string) {
  const match = label.match(/^(\d{2}-\d{2})\s+(.+)$/);
  if (!match) return { date: '今天', time: label };
  return { date: match[1], time: match[2] };
}

function groupShowtimesByDate(movie: Movie): ShowtimeDateGroup[] {
  const groups = new Map<string, DateShowing[]>();

  for (const theater of movie.theaters) {
    for (const label of theater.times) {
      const { date, time } = splitShowtimeLabel(label);
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)?.push({
        time,
        theater: theater.theater,
        ticketUrl: theater.ticketUrl,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([date, showings]) => ({
      date,
      showings: showings.sort((a, b) => {
        const timeOrder = a.time.localeCompare(b.time);
        if (timeOrder !== 0) return timeOrder;
        return a.theater.localeCompare(b.theater);
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function trackMovieSearch(payload: {
  zip: string;
  days: number;
  resultCount?: number;
  durationMs?: number;
  status: 'success' | 'empty' | 'error';
  error?: string;
}) {
  void fetch('/api/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      eventType: 'movie_search',
      radius: 40,
      ...payload,
    }),
  }).catch(() => {});
}

export default function Home() {
  const [zip, setZip] = useState('');
  const [days, setDays] = useState(30);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [expandedMovies, setExpandedMovies] = useState<Record<string, boolean>>({});
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
    setExpandedMovies({});
    try {
      const res = await fetch(`/api/movies?zip=${zip}&days=${days}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setMovies(data);
      const durationMs = Date.now() - startTimeRef.current;
      setElapsed(Math.round(durationMs / 100) / 10);
      setStatus('done');
      trackMovieSearch({
        zip,
        days,
        resultCount: Array.isArray(data) ? data.length : 0,
        durationMs,
        status: Array.isArray(data) && data.length > 0 ? 'success' : 'empty',
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
      setStatus('error');
      trackMovieSearch({
        zip,
        days,
        durationMs: Date.now() - startTimeRef.current,
        status: 'error',
        error: message,
      });
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
          <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {movies.map((m, i) => {
              const key = movieKey(m);
              const expanded = Boolean(expandedMovies[key]);
              const dateGroups = groupShowtimesByDate(m);
              const showtimeCount = dateGroups.reduce((sum, group) => sum + group.showings.length, 0);
              const nextDateGroup = dateGroups[0];
              const nextShowing = nextDateGroup?.showings[0];
              const firstTicketUrl = m.theaters.find(theater => theater.ticketUrl)?.ticketUrl;

              return (
              <div key={key || i} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 hover:border-gray-600 transition-colors">
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
                  <div className="mt-4 border-t border-gray-800 pt-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-300">
                          {dateGroups.length} 天 · {m.theaters.length} 家影院 · {showtimeCount} 场
                        </p>
                        {nextDateGroup && nextShowing && (
                          <p className="mt-1 truncate text-[11px] text-gray-500">
                            下一场 {nextDateGroup.date} {nextShowing.time} · {nextShowing.theater}
                          </p>
                        )}
                      </div>
                      {firstTicketUrl && (
                        <a
                          href={firstTicketUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-blue-400 hover:text-white"
                        >
                          购票
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedMovies(current => ({ ...current, [key]: !expanded }))}
                      className="mt-3 w-full rounded-md bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 hover:bg-gray-700"
                    >
                      {expanded ? '隐藏排片' : '展开排片'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-3">
                      {dateGroups.map(group => {
                        const visibleShowings = group.showings.slice(0, visibleShowingsPerDate);
                        const hiddenCount = Math.max(group.showings.length - visibleShowings.length, 0);

                        return (
                        <div key={group.date} className="border-t border-gray-800 pt-3 first:border-t-0 first:pt-0">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-gray-200">{group.date}</p>
                            {hiddenCount > 0 && (
                              <span className="rounded bg-gray-950 px-1.5 py-0.5 text-[11px] text-gray-500">
                                还有 {hiddenCount} 场
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            {visibleShowings.map(showing => (
                              <div key={`${showing.time}-${showing.theater}`} className="flex items-center gap-2 text-xs">
                                <span className="w-11 shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-center text-[11px] text-gray-300">
                                  {showing.time}
                                </span>
                                {showing.ticketUrl ? (
                                  <a
                                    href={showing.ticketUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 flex-1 truncate text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                                  >
                                    {showing.theater}
                                  </a>
                                ) : (
                                  <span className="min-w-0 flex-1 truncate text-gray-300">{showing.theater}</span>
                                )}
                                {showing.ticketUrl && (
                                  <a
                                    href={showing.ticketUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:border-blue-400 hover:text-white"
                                  >
                                    购票
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
