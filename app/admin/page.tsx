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
  days: number;
  searches: number;
}

interface RecentRow {
  created_at: string | Date;
  event_type: string;
  zip: string | null;
  days: number | null;
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
  status: string | null;
  error: string | null;
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
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function metricLabel(value: string | null | undefined) {
  return value || '-';
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

function Dashboard({ data }: { data: Extract<DashboardData, { configured: true }> }) {
  const totals = data.totals;
  const emptyRate = totals.searches > 0
    ? `${Math.round((totals.empty_searches / totals.searches) * 100)}%`
    : '-';

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Usage Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">最近 30 天的查询记录，IP 仅保存 hash 前缀。</p>
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
            <h2 className="mb-4 text-sm font-semibold text-gray-200">搜索天数</h2>
            <BarList
              rows={data.dayRanges.map(row => ({ label: `${row.days} 天`, value: row.searches }))}
            />
          </section>
        </div>

        <section className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-4 text-sm font-semibold text-gray-200">最近 100 条</h2>
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
                    <th className="whitespace-nowrap px-3 py-2 font-medium">天数</th>
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
                      <td className="whitespace-nowrap px-3 py-2">{row.days ?? '-'}</td>
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
                        {formatDateTime(row.created_at)} · {metricLabel(row.zip)} · {row.days ?? '-'} 天
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
                          {formatDateTime(row.created_at)} · {metricLabel(row.zip)} · {row.days ?? '-'} 天
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
  searchParams: Promise<{ login?: string }>;
}) {
  const query = await searchParams;
  if (!(await isAuthorized())) {
    return <LoginScreen failed={query.login === 'failed'} />;
  }

  const data = await getUsageDashboardData() as DashboardData;
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

  return <Dashboard data={data} />;
}
