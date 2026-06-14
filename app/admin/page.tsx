import type { ReactNode } from 'react';
import { getUsageDashboardData } from '../lib/usage';
import { login, logout } from './actions';
import { adminPassword, isAuthorized } from './auth';

export const dynamic = 'force-dynamic';

interface Totals {
  total_events: number;
  events_today: number;
  searches: number;
  searches_today: number;
  unique_users_7d: number;
  empty_searches: number;
  rate_limited_events: number;
  rate_limited_events_today: number;
  error_events: number;
  avg_duration_ms: number | null;
  tms_requests: number;
  tms_requests_today: number;
  tmdb_requests: number;
  tmdb_requests_today: number;
  tmdb_search_requests: number;
  tmdb_detail_requests: number;
  avg_tms_requests: number | null;
  avg_tmdb_requests: number | null;
}

interface DailyRow {
  day: string;
  searches: number;
  unique_users: number;
}

interface TopZipRow {
  zip: string;
  searches: number;
}

interface DayRangeRow {
  range_label: string;
  searches: number;
}

interface RecentRow {
  created_at: string | Date;
  event_type: string;
  zip: string | null;
  days: number | null;
  start_date: string | null;
  end_date: string | null;
  radius: number | null;
  result_count: number | null;
  duration_ms: number | null;
  tms_request_count: number | null;
  tmdb_search_count: number | null;
  tmdb_detail_count: number | null;
  tmdb_request_count: number | null;
  status: string | null;
  ip_hash: string | null;
  country: string | null;
  region: string | null;
  user_agent: string | null;
  error: string | null;
}

interface SlowRow {
  created_at: string | Date;
  zip: string | null;
  days: number | null;
  start_date: string | null;
  end_date: string | null;
  result_count: number | null;
  duration_ms: number | null;
  tms_request_count: number | null;
  tmdb_search_count: number | null;
  tmdb_detail_count: number | null;
  tmdb_request_count: number | null;
  status: string | null;
  error: string | null;
}

type ExpensiveRow = SlowRow;

interface ErrorRow {
  created_at: string | Date;
  event_type: string;
  zip: string | null;
  days: number | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  error: string | null;
}

interface WindowTotals {
  total_events: number;
  searches: number;
  backend_events: number;
  unique_users: number;
  total_results: number;
  tms_requests: number;
  tmdb_requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  latest_event_at: string | Date | null;
}

interface HourlyRow {
  hour: string;
  events: number;
  searches: number;
  unique_users: number;
  tms_requests: number;
  tmdb_requests: number;
  errors: number;
  rate_limited: number;
}

interface WindowTopZipRow {
  zip: string;
  searches: number;
  unique_users: number;
  total_results: number;
}

interface WindowEventRow {
  local_time: string;
  event_type: string;
  zip: string | null;
  radius: number | null;
  start_date?: string | null;
  end_date?: string | null;
  result_count?: number | null;
  duration_ms?: number | null;
  tms_request_count?: number | null;
  tmdb_request_count?: number | null;
  status: string | null;
  error?: string | null;
}

interface UsageWindowData {
  configured: true;
  generatedAt: string;
  windowHours: number;
  totals: WindowTotals;
  hourly: HourlyRow[];
  topZips: WindowTopZipRow[];
  expensive: WindowEventRow[];
  errors: WindowEventRow[];
  recent: WindowEventRow[];
}

type DashboardData =
  | { configured: false }
  | {
      configured: true;
      totals: Totals;
      daily: DailyRow[];
      topZips: TopZipRow[];
      dayRanges: DayRangeRow[];
      recent: RecentRow[];
      slow: SlowRow[];
      expensive: ExpensiveRow[];
      errors: ErrorRow[];
      window: UsageWindowData | null;
      table: string;
    };

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDecimal(value: number | null | undefined) {
  if (value === null || value === undefined) return '-';
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatDateTime(value: string | Date) {
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
  return `${formatted} PT`;
}

function formatLocalTime(value: string) {
  return `${value} PT`;
}

function metricLabel(value: string | null | undefined) {
  return value || '-';
}

function formatSearchRange(row: {
  days?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}) {
  if (row.start_date && row.end_date) {
    return row.start_date === row.end_date ? row.start_date : `${row.start_date} 至 ${row.end_date}`;
  }
  if (row.days) return `${row.days} 天`;
  return '-';
}

function parseHours(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(168, Math.round(parsed)));
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const rangeOptions = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
  { hours: 168, label: '7d' },
];

function TimeRangeControls({ hours }: { hours: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {rangeOptions.map(option => (
          <a
            key={option.hours}
            href={`/admin?hours=${option.hours}`}
            className={[
              'rounded-md border px-3 py-1.5 text-sm',
              hours === option.hours
                ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                : 'border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white',
            ].join(' ')}
          >
            {option.label}
          </a>
        ))}
      </div>
      <form method="get" action="/admin" className="flex items-center gap-2">
        <label htmlFor="hours" className="text-sm text-gray-500">过去</label>
        <input
          id="hours"
          name="hours"
          type="number"
          min="1"
          max="168"
          defaultValue={hours}
          className="w-20 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500"
        />
        <span className="text-sm text-gray-500">小时</span>
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
        >
          应用
        </button>
      </form>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-800 px-4 py-8 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}

function BarList({
  rows,
  suffix = '',
}: {
  rows: Array<{ label: string; value: number }>;
  suffix?: string;
}) {
  const max = Math.max(...rows.map(row => row.value), 1);
  if (rows.length === 0) return <EmptyState>暂无数据</EmptyState>;

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const value = row.value;
        const label = row.label;
        return (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-gray-300">{label}</span>
              <span className="shrink-0 text-gray-500">
                {formatNumber(value)}{suffix}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${Math.max((value / max) * 100, 3)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoginScreen({ failed }: { failed: boolean }) {
  const configured = Boolean(adminPassword());

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-16 text-white">
      <div className="mx-auto max-w-sm rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h1 className="text-xl font-semibold">Admin Dashboard</h1>
        <p className="mt-2 text-sm text-gray-500">查看院线查询使用记录和错误。</p>

        {!configured ? (
          <div className="mt-6 rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
            需要先在 Vercel 配置 <code>ADMIN_PASSWORD</code>。
          </div>
        ) : (
          <form action={login} className="mt-6 space-y-4">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Admin password"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
            />
            {failed && <p className="text-sm text-red-400">密码不正确</p>}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              登录
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function WindowEventsTable({ rows }: { rows: WindowEventRow[] }) {
  if (rows.length === 0) return <EmptyState>暂无记录</EmptyState>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-gray-500">
          <tr>
            <th className="whitespace-nowrap px-3 py-2 font-medium">时间</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">事件</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">ZIP</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">Radius</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">日期</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">结果</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">耗时</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">TMS</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">TMDB</th>
            <th className="whitespace-nowrap px-3 py-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800 text-gray-300">
          {rows.map((row, index) => (
            <tr key={`${row.local_time}-${index}`}>
              <td className="whitespace-nowrap px-3 py-2">{formatLocalTime(row.local_time)}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.event_type}</td>
              <td className="whitespace-nowrap px-3 py-2">{metricLabel(row.zip)}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.radius ?? '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatSearchRange(row)}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.result_count ?? '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatDuration(row.duration_ms)}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.tms_request_count ?? '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">{row.tmdb_request_count ?? '-'}</td>
              <td className="whitespace-nowrap px-3 py-2">{metricLabel(row.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ data, hours }: { data: Extract<DashboardData, { configured: true }>; hours: number }) {
  const totals = data.totals;
  const window = data.window;
  const emptyRate = totals.searches > 0
    ? `${Math.round((totals.empty_searches / totals.searches) * 100)}%`
    : '-';

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Usage Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">短窗口运营监控 + 最近 30 天概览，IP 仅保存 hash 前缀。</p>
          </div>
          <div className="flex gap-2">
            <a
              href="/admin"
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white"
            >
              刷新
            </a>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white"
              >
                退出
              </button>
            </form>
          </div>
        </div>

        <div className="mb-6">
          <TimeRangeControls hours={hours} />
        </div>

        {window && (
          <>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">过去 {window.windowHours} 小时</h2>
                <p className="text-sm text-gray-500">用于判断刚发布后是否有流量、错误、限流或 provider 成本异常。</p>
              </div>
              <p className="hidden text-xs text-gray-600 sm:block">
                更新于 {formatDateTime(window.generatedAt)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="搜索" value={formatNumber(window.totals.searches)} />
              <MetricCard label="独立用户" value={formatNumber(window.totals.unique_users)} hint="按 ip_hash 估算" />
              <MetricCard label="TMS fetches" value={formatNumber(window.totals.tms_requests)} />
              <MetricCard label="TMDB fetches" value={formatNumber(window.totals.tmdb_requests)} />
              <MetricCard label="错误" value={formatNumber(window.totals.errors)} />
              <MetricCard label="限流" value={formatNumber(window.totals.rate_limited)} />
              <MetricCard label="平均耗时" value={formatDuration(window.totals.avg_duration_ms)} />
              <MetricCard label="事件" value={formatNumber(window.totals.total_events)} hint={`${formatNumber(window.totals.backend_events)} backend`} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <h2 className="mb-4 text-sm font-semibold text-gray-200">小时搜索趋势</h2>
                <BarList rows={window.hourly.map(row => ({ label: row.hour, value: row.searches }))} />
              </section>
              <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <h2 className="mb-4 text-sm font-semibold text-gray-200">小时 TMS fetches</h2>
                <BarList rows={window.hourly.map(row => ({ label: row.hour, value: row.tms_requests }))} />
              </section>
              <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <h2 className="mb-4 text-sm font-semibold text-gray-200">窗口 Top ZIP</h2>
                <BarList rows={window.topZips.map(row => ({ label: `${row.zip} · ${row.unique_users} users`, value: row.searches }))} />
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <h2 className="mb-4 text-sm font-semibold text-gray-200">窗口最贵查询</h2>
                {window.expensive.length === 0 ? (
                  <EmptyState>暂无数据</EmptyState>
                ) : (
                  <div className="space-y-3">
                    {window.expensive.map((row, index) => {
                      const total = (row.tms_request_count ?? 0) + (row.tmdb_request_count ?? 0);
                      return (
                        <div key={`${row.local_time}-${index}`} className="text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-gray-300">
                              {formatLocalTime(row.local_time)} · {metricLabel(row.zip)} · {formatSearchRange(row)}
                            </span>
                            <span className="shrink-0 text-gray-500">{formatNumber(total)} fetches</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            radius {row.radius ?? '-'} · TMS {row.tms_request_count ?? '-'} · TMDB {row.tmdb_request_count ?? '-'} · {formatDuration(row.duration_ms)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <h2 className="mb-4 text-sm font-semibold text-gray-200">窗口错误 / 限流</h2>
                {window.errors.length === 0 ? (
                  <EmptyState>暂无错误或限流</EmptyState>
                ) : (
                  <div className="space-y-3">
                    {window.errors.map((row, index) => (
                      <div key={`${row.local_time}-${index}`} className="text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-300">
                            {formatLocalTime(row.local_time)} · {row.event_type} · {metricLabel(row.zip)}
                          </span>
                          <span className="text-xs text-red-300">{metricLabel(row.status)}</span>
                        </div>
                        {row.error && <p className="mt-1 truncate text-xs text-gray-500">{row.error}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
              <h2 className="mb-4 text-sm font-semibold text-gray-200">窗口最近事件</h2>
              <WindowEventsTable rows={window.recent} />
            </section>
          </>
        )}

        <div className="mt-8 mb-3">
          <h2 className="text-lg font-semibold text-gray-100">30 天概览</h2>
          <p className="text-sm text-gray-500">长期趋势和累计成本。</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="今天搜索" value={formatNumber(totals.searches_today)} />
          <MetricCard label="30 天搜索" value={formatNumber(totals.searches)} />
          <MetricCard label="7 天独立用户" value={formatNumber(totals.unique_users_7d)} hint="按 ip_hash 估算" />
          <MetricCard label="空结果率" value={emptyRate} hint={`${formatNumber(totals.empty_searches)} 次空结果`} />
          <MetricCard label="今天 TMS fetches" value={formatNumber(totals.tms_requests_today)} />
          <MetricCard label="今天 TMDB fetches" value={formatNumber(totals.tmdb_requests_today)} />
          <MetricCard label="30 天 TMS fetches" value={formatNumber(totals.tms_requests)} hint={`平均 ${formatDecimal(totals.avg_tms_requests)} / backend miss`} />
          <MetricCard label="30 天 TMDB fetches" value={formatNumber(totals.tmdb_requests)} hint={`平均 ${formatDecimal(totals.avg_tmdb_requests)} / backend miss`} />
          <MetricCard label="今天事件" value={formatNumber(totals.events_today)} />
          <MetricCard label="30 天事件" value={formatNumber(totals.total_events)} />
          <MetricCard label="今天限流" value={formatNumber(totals.rate_limited_events_today)} />
          <MetricCard label="30 天限流" value={formatNumber(totals.rate_limited_events)} />
          <MetricCard label="平均耗时" value={formatDuration(totals.avg_duration_ms)} />
          <MetricCard label="错误事件" value={formatNumber(totals.error_events)} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">近 14 天趋势</h2>
            <BarList
              rows={data.daily.map(row => ({ label: row.day, value: row.searches }))}
            />
          </section>
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">Top ZIP</h2>
            <BarList
              rows={data.topZips.map(row => ({ label: row.zip, value: row.searches }))}
            />
          </section>
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">搜索日期</h2>
            <BarList
              rows={data.dayRanges.map(row => ({ label: row.range_label, value: row.searches }))}
            />
          </section>
        </div>

        <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-1 text-sm font-semibold text-gray-200">过去 {hours} 小时最近 100 条</h2>
          <p className="mb-4 text-xs text-gray-500">跟顶部时间窗口一致，时间按 PT 显示。</p>
          {data.recent.length === 0 ? (
            <EmptyState>暂无记录</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">时间</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">事件</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">ZIP</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">查询日期</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">结果</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">耗时</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">TMS</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">TMDB</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">状态</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">IP</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">地区</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">UA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 text-gray-300">
                  {data.recent.map((row, index) => (
                    <tr key={`${row.created_at}-${index}`}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.created_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.event_type}</td>
                      <td className="whitespace-nowrap px-3 py-2">{metricLabel(row.zip)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatSearchRange(row)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.result_count ?? '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatDuration(row.duration_ms)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.tms_request_count ?? '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.tmdb_request_count ?? '-'}
                        {row.tmdb_request_count !== null && row.tmdb_request_count !== undefined && (
                          <span className="ml-1 text-gray-500">
                            ({row.tmdb_search_count ?? 0}/{row.tmdb_detail_count ?? 0})
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{metricLabel(row.status)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-500">{metricLabel(row.ip_hash)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{[row.country, row.region].filter(Boolean).join('/') || '-'}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-gray-500">{metricLabel(row.user_agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">最慢查询</h2>
            {data.slow.length === 0 ? (
              <EmptyState>暂无数据</EmptyState>
            ) : (
              <div className="space-y-3">
                {data.slow.map((row, index) => (
                  <div key={`${row.created_at}-${index}`} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-gray-300">
                        {formatDateTime(row.created_at)} · {metricLabel(row.zip)} · {formatSearchRange(row)}
                      </span>
                      <span className="shrink-0 text-gray-500">{formatDuration(row.duration_ms)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      TMS {row.tms_request_count ?? '-'} · TMDB {row.tmdb_request_count ?? '-'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">API 最贵查询</h2>
            {data.expensive.length === 0 ? (
              <EmptyState>暂无数据</EmptyState>
            ) : (
              <div className="space-y-3">
                {data.expensive.map((row, index) => {
                  const total = (row.tms_request_count ?? 0) + (row.tmdb_request_count ?? 0);
                  return (
                    <div key={`${row.created_at}-${index}`} className="text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-gray-300">
                          {formatDateTime(row.created_at)} · {metricLabel(row.zip)} · {formatSearchRange(row)}
                        </span>
                        <span className="shrink-0 text-gray-500">{formatNumber(total)} fetches</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        TMS {row.tms_request_count ?? '-'} · TMDB {row.tmdb_request_count ?? '-'}
                        {' '}({row.tmdb_search_count ?? 0} search / {row.tmdb_detail_count ?? 0} detail)
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold text-gray-200">最近错误</h2>
            {data.errors.length === 0 ? (
              <EmptyState>暂无错误</EmptyState>
            ) : (
              <div className="space-y-3">
                {data.errors.map((row, index) => (
                  <div key={`${row.created_at}-${index}`} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-300">
                        {formatDateTime(row.created_at)} · {row.event_type} · {metricLabel(row.zip)}
                      </span>
                      <span className="text-xs text-red-300">{metricLabel(row.status)}</span>
                    </div>
                    {row.error && <p className="mt-1 truncate text-xs text-gray-500">{row.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ login?: string; hours?: string }>;
}) {
  const query = await searchParams;
  const hours = parseHours(query.hours);
  if (!(await isAuthorized())) {
    return <LoginScreen failed={query.login === 'failed'} />;
  }

  const data = await getUsageDashboardData({ hours }) as DashboardData;
  if (!data.configured) {
    return (
      <main className="min-h-screen bg-gray-950 px-4 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-lg border border-gray-800 bg-gray-900 p-6">
          <h1 className="text-xl font-semibold">Usage Dashboard</h1>
          <p className="mt-3 text-sm text-gray-400">
            登录成功。下一步需要配置 <code>DATABASE_URL</code>、<code>POSTGRES_URL</code> 或 <code>SUPABASE_DB_URL</code>。
          </p>
          <p className="mt-2 text-sm text-gray-500">
            配好数据库后，新的查询会自动写入 <code>usage_events</code>。
          </p>
          <form action={logout} className="mt-6">
            <button
              type="submit"
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white"
            >
              退出
            </button>
          </form>
        </div>
      </main>
    );
  }

  return <Dashboard data={data} hours={hours} />;
}
