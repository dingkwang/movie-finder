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
  originalAudio: '普通话' | '粤语' | '英语' | '多语' | '未知';
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

interface DetectedLocation {
  zip: string;
  city: string | null;
  state: string | null;
}

type LocationStatus = 'idle' | 'requesting' | 'resolving' | 'done' | 'error';

interface LocationState {
  status: LocationStatus;
  message: string;
}

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function currentTimeMs() {
  return Date.now();
}

const locationLookupTimeoutMs = 9000;

function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
  return error instanceof GeolocationPositionError;
}

function isAbortError(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function locationErrorMessage(error: unknown) {
  if (isAbortError(error)) return '定位服务超时，请手动输入邮编';
  if (!isGeolocationPositionError(error)) {
    return error instanceof Error ? error.message : '定位失败，请手动输入邮编';
  }
  if (error.code === 1) return '浏览器没有获得定位权限';
  if (error.code === 2) return '暂时无法读取当前位置';
  if (error.code === 3) return '定位超时，请手动输入邮编';
  return '定位失败，请手动输入邮编';
}

function getCurrentPosition(options: PositionOptions) {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('当前浏览器不支持定位'));
  }

  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function isDetectedLocation(value: unknown): value is DetectedLocation {
  if (typeof value !== 'object' || value === null) return false;
  const location = value as Partial<DetectedLocation>;
  return typeof location.zip === 'string' && /^\d{5}$/.test(location.zip);
}

function detectedLocationLabel(location: DetectedLocation) {
  if (location.city && location.state) {
    return `已定位到 ${location.city}, ${location.state} ${location.zip}`;
  }
  return `已定位到 ${location.zip}`;
}

async function lookupLocationZip(position: GeolocationPosition) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), locationLookupTimeoutMs);

  try {
    const res = await fetch('/api/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      }),
    });
    const data: unknown = res.ok ? await res.json() : await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '定位失败，请手动输入邮编';
      throw new Error(message);
    }
    if (!isDetectedLocation(data)) {
      throw new Error('没有匹配到有效美国邮编');
    }
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

const rangeOptions = [
  { days: 1, label: '今天' },
  { days: 7, label: '7 天内' },
  { days: 30, label: '30 天内' },
];

const popularLocations = [
  { label: '94041', description: '南湾', zip: '94041' },
  { label: '旧金山', description: 'Chinatown', zip: '94133' },
  { label: '法拉盛', description: 'Flushing', zip: '11354' },
  { label: '曼哈顿', description: 'Chinatown', zip: '10013' },
];

const visibleShowingsPerDate = 8;

function todayDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, offset: number) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetweenInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  return Math.round((end - start) / 86400000) + 1;
}

function dateRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return startDate;
  return `${startDate} 至 ${endDate}`;
}

function movieKey(movie: Movie) {
  return `${movie.title}-${movie.releaseDate}`;
}

function splitShowtimeLabel(label: string, selectedDate: string) {
  const match = label.match(/^(\d{2}-\d{2})\s+(.+)$/);
  if (!match) return { date: selectedDate, time: label };
  return { date: match[1], time: match[2] };
}

function groupShowtimesByDate(movie: Movie, selectedDate: string): ShowtimeDateGroup[] {
  const groups = new Map<string, DateShowing[]>();

  for (const theater of movie.theaters) {
    for (const label of theater.times) {
      const { date, time } = splitShowtimeLabel(label, selectedDate);
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
  startDate: string;
  endDate: string;
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
  const today = todayDateString();
  const maxDate = addDays(today, 29);
  const [zip, setZip] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [expandedMovies, setExpandedMovies] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [location, setLocation] = useState<LocationState>({ status: 'idle', message: '' });
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(0);
  const locationRequestIdRef = useRef(0);
  const prewarmedDatesRef = useRef<Set<string>>(new Set());
  const days = daysBetweenInclusive(startDate, endDate);
  const isLocating = location.status === 'requesting' || location.status === 'resolving';
  const activeRangeDays = rangeOptions.find(option => {
    return startDate === today && endDate === addDays(today, option.days - 1);
  })?.days;
  const endDateMax = addDays(startDate, Math.min(29, daysBetweenInclusive(startDate, maxDate) - 1));

  function setPresetRange(nextDays: number) {
    setStartDate(today);
    setEndDate(addDays(today, nextDays - 1));
  }

  function updateStartDate(value: string) {
    const nextStart = value < today ? today : value > maxDate ? maxDate : value;
    setStartDate(nextStart);
    setEndDate(current => {
      if (current < nextStart) return nextStart;
      const nextMax = addDays(nextStart, Math.min(29, daysBetweenInclusive(nextStart, maxDate) - 1));
      return current > nextMax ? nextMax : current;
    });
  }

  function updateEndDate(value: string) {
    const nextEnd = value < startDate ? startDate : value > endDateMax ? endDateMax : value;
    setEndDate(nextEnd);
  }

  useEffect(() => {
    if (status !== 'loading') return;
    const id = setInterval(() => {
      setElapsed(Math.floor((currentTimeMs() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (days > 7) return;
    const prewarmKey = `${startDate}:${endDate}`;
    if (prewarmedDatesRef.current.has(prewarmKey)) return;
    prewarmedDatesRef.current.add(prewarmKey);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void (async () => {
        for (const loc of popularLocations) {
          const params = new URLSearchParams({
            zip: loc.zip,
            startDate,
            endDate,
            prewarm: '1',
          });
          try {
            await fetch(`/api/movies?${params.toString()}`, {
              signal: controller.signal,
            });
          } catch {
            if (controller.signal.aborted) return;
          }
        }
      })();
    }, 1200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [days, endDate, startDate]);

  async function search(zipOverride = zip) {
    const searchZip = zipOverride.trim();
    if (!/^\d{5}$/.test(searchZip)) {
      setError('请输入 5 位美国邮编');
      setStatus('error');
      return;
    }
    if (startDate < today || endDate < today || startDate > endDate || endDate > maxDate) {
      setError('请选择今天起 30 天内的日期范围');
      setStatus('error');
      return;
    }
    startTimeRef.current = currentTimeMs();
    setElapsed(0);
    setStatus('loading');
    setError('');
    setExpandedMovies({});
    try {
      const params = new URLSearchParams({ zip: searchZip, startDate, endDate });
      const res = await fetch(`/api/movies?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'API error');
      setMovies(data);
      const durationMs = currentTimeMs() - startTimeRef.current;
      setElapsed(Math.round(durationMs / 100) / 10);
      setStatus('done');
      trackMovieSearch({
        zip: searchZip,
        days,
        startDate,
        endDate,
        resultCount: Array.isArray(data) ? data.length : 0,
        durationMs,
        status: Array.isArray(data) && data.length > 0 ? 'success' : 'empty',
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(message);
      setStatus('error');
      trackMovieSearch({
        zip: searchZip,
        days,
        startDate,
        endDate,
        durationMs: currentTimeMs() - startTimeRef.current,
        status: 'error',
        error: message,
      });
    }
  }

  function selectPopularLocation(nextZip: string) {
    setZip(nextZip);
    void search(nextZip);
  }

  async function detectCurrentLocation() {
    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;
    setLocation({ status: 'requesting', message: '请允许浏览器读取当前位置' });

    try {
      const position = await getCurrentPosition({
        enableHighAccuracy: false,
        maximumAge: 10 * 60 * 1000,
        timeout: 10000,
      });
      if (requestId !== locationRequestIdRef.current) return;

      setLocation({ status: 'resolving', message: '正在匹配附近邮编…' });
      const detected = await lookupLocationZip(position);
      if (requestId !== locationRequestIdRef.current) return;

      setZip(detected.zip);
      setLocation({ status: 'done', message: detectedLocationLabel(detected) });
      void search(detected.zip);
    } catch (error: unknown) {
      if (requestId !== locationRequestIdRef.current) return;
      setLocation({ status: 'error', message: locationErrorMessage(error) });
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
            onKeyDown={e => {
              if (e.key === 'Enter') void search();
            }}
            className="w-40 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:border-blue-500 text-center text-lg tracking-widest"
          />
          <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900 p-1">
            {rangeOptions.map(option => (
              <button
                key={option.days}
                type="button"
                onClick={() => setPresetRange(option.days)}
                className={`h-9 min-w-16 px-3 rounded-md text-sm font-medium transition-colors ${
                  activeRangeDays === option.days
                    ? 'bg-gray-100 text-gray-950'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1">
            <input
              type="date"
              value={startDate}
              min={today}
              max={maxDate}
              onChange={e => updateStartDate(e.target.value)}
              className="h-8 bg-transparent text-sm text-gray-200 outline-none [color-scheme:dark]"
            />
            <span className="text-xs text-gray-500">至</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={endDateMax}
              onChange={e => updateEndDate(e.target.value)}
              className="h-8 bg-transparent text-sm text-gray-200 outline-none [color-scheme:dark]"
            />
          </div>
          <button
            onClick={() => void search()}
            disabled={status === 'loading'}
            className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold transition-colors"
          >
            {status === 'loading' ? `查询中… ${fmtTime(elapsed)}` : '搜索'}
          </button>
          <button
            type="button"
            onClick={detectCurrentLocation}
            disabled={isLocating || status === 'loading'}
            className="px-4 py-2 rounded-lg border border-gray-700 bg-gray-900 text-sm font-semibold text-gray-200 hover:border-gray-500 hover:text-white disabled:opacity-50 transition-colors"
          >
            {isLocating ? '定位中…' : '当前位置'}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
          {popularLocations.map(loc => {
            const selected = zip === loc.zip;

            return (
              <button
                key={loc.zip}
                type="button"
                onClick={() => selectPopularLocation(loc.zip)}
                className={`rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? 'border-blue-400 bg-blue-500/15 text-blue-100'
                    : 'border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-white'
                }`}
              >
                <span className="font-semibold">{loc.label}</span>
                <span className="ml-1 text-gray-500">{loc.description}</span>
              </button>
            );
          })}
        </div>

        {location.message && (
          <p
            aria-live="polite"
            className={`mb-3 text-center text-xs ${
              location.status === 'error' ? 'text-red-400' : 'text-gray-500'
            }`}
          >
            {location.message}
          </p>
        )}

        <div className="h-6 flex items-center justify-center mb-7">
          {status === 'done' && (
            <span className="text-xs text-gray-500">
              {movies.length > 0 ? `找到 ${movies.length} 部` : '无结果'} · {dateRangeLabel(startDate, endDate)} · 用时 {fmtTime(elapsed)}
            </span>
          )}
        </div>

        {status === 'error' && (
          <p className="text-red-400 text-center mb-6">{error}</p>
        )}

        {status === 'done' && movies.length === 0 && (
          <div className="text-center">
            <p className="text-gray-500 mb-4">{zip} 附近 {dateRangeLabel(startDate, endDate)} 没有华语院线排片</p>
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
              const dateGroups = groupShowtimesByDate(m, startDate);
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded border border-gray-700 bg-gray-950 px-2 py-0.5 text-[11px] text-gray-300">
                      原声：{m.originalAudio ?? '未知'}
                    </span>
                  </div>
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
