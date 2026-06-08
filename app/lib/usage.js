import postgres from 'postgres';
import { createHash } from 'crypto';

const DEFAULT_RADIUS_MILES = 50;
const USAGE_TABLE = 'usage_events';

let client;
let initPromise;

function databaseUrl() {
  return process.env.DATABASE_URL
    ?? process.env.POSTGRES_URL
    ?? process.env.POSTGRES_PRISMA_URL
    ?? process.env.SUPABASE_DB_URL
    ?? '';
}

export function usageDatabaseConfigured() {
  return Boolean(databaseUrl());
}

function shouldUseSsl(url) {
  return !/localhost|127\.0\.0\.1/.test(url);
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: shouldUseSsl(url) ? 'require' : false,
      onnotice: () => {},
    });
  }
  return client;
}

async function ensureUsageTable() {
  const db = sql();
  if (!db) return null;
  if (!initPromise) {
    initPromise = (async () => {
      await db`
        create table if not exists usage_events (
          id bigserial primary key,
          created_at timestamptz not null default now(),
          event_type text not null,
          zip text,
          days int,
          start_date date,
          end_date date,
          radius int,
          result_count int,
          duration_ms int,
          tms_request_count int,
          tmdb_search_count int,
          tmdb_detail_count int,
          tmdb_request_count int,
          status text,
          ip_hash text,
          country text,
          region text,
          user_agent text,
          error text
        )
      `;
      await Promise.all([
        db`alter table usage_events add column if not exists tms_request_count int`,
        db`alter table usage_events add column if not exists tmdb_search_count int`,
        db`alter table usage_events add column if not exists tmdb_detail_count int`,
        db`alter table usage_events add column if not exists tmdb_request_count int`,
        db`alter table usage_events add column if not exists start_date date`,
        db`alter table usage_events add column if not exists end_date date`,
      ]);
      await Promise.all([
        db`create index if not exists usage_events_created_at_idx on usage_events (created_at desc)`,
        db`create index if not exists usage_events_event_type_idx on usage_events (event_type)`,
        db`create index if not exists usage_events_zip_idx on usage_events (zip)`,
      ]);
    })();
  }
  await initPromise;
  return db;
}

function firstHeader(headers, names) {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return '';
}

export function requestMetadata(request) {
  const forwardedFor = firstHeader(request.headers, [
    'x-forwarded-for',
    'x-vercel-forwarded-for',
    'x-real-ip',
  ]);
  const ip = forwardedFor.split(',')[0]?.trim() ?? '';
  return {
    ip,
    country: request.headers.get('x-vercel-ip-country') ?? '',
    region: request.headers.get('x-vercel-ip-country-region') ?? '',
    userAgent: request.headers.get('user-agent') ?? '',
  };
}

export function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.USAGE_IP_SALT ?? process.env.ADMIN_PASSWORD ?? process.env.ADMIN_TOKEN;
  if (!salt) return null;
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex');
}

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function textOrNull(value, maxLength = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function dateOrNull(value) {
  const text = textOrNull(value, 10);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

export async function recordUsageEvent(event, request) {
  if (!usageDatabaseConfigured()) return { enabled: false };

  try {
    const metadata = request ? requestMetadata(request) : {};
    const db = await ensureUsageTable();
    if (!db) return { enabled: false };

    await db`
      insert into usage_events (
        event_type,
        zip,
        days,
        start_date,
        end_date,
        radius,
        result_count,
        duration_ms,
        tms_request_count,
        tmdb_search_count,
        tmdb_detail_count,
        tmdb_request_count,
        status,
        ip_hash,
        country,
        region,
        user_agent,
        error
      ) values (
        ${textOrNull(event.eventType ?? event.event_type, 80) ?? 'unknown'},
        ${textOrNull(event.zip, 16)},
        ${intOrNull(event.days)},
        ${dateOrNull(event.startDate ?? event.start_date)},
        ${dateOrNull(event.endDate ?? event.end_date)},
        ${intOrNull(event.radius ?? DEFAULT_RADIUS_MILES)},
        ${intOrNull(event.resultCount ?? event.result_count)},
        ${intOrNull(event.durationMs ?? event.duration_ms)},
        ${intOrNull(event.tmsRequestCount ?? event.tms_request_count)},
        ${intOrNull(event.tmdbSearchCount ?? event.tmdb_search_count)},
        ${intOrNull(event.tmdbDetailCount ?? event.tmdb_detail_count)},
        ${intOrNull(event.tmdbRequestCount ?? event.tmdb_request_count)},
        ${textOrNull(event.status, 40)},
        ${hashIp(metadata.ip)},
        ${textOrNull(metadata.country, 12)},
        ${textOrNull(metadata.region, 40)},
        ${textOrNull(metadata.userAgent, 500)},
        ${textOrNull(event.error, 500)}
      )
    `;
    return { enabled: true };
  } catch (error) {
    console.error('usage event insert failed', error);
    return { enabled: false, error: error.message };
  }
}

export async function getUsageDashboardData() {
  if (!usageDatabaseConfigured()) {
    return { configured: false };
  }

  const db = await ensureUsageTable();
  if (!db) return { configured: false };

  const [
    totals,
    daily,
    topZips,
    dayRanges,
    recent,
    slow,
    expensive,
    errors,
  ] = await Promise.all([
    db`
      select
        count(*)::int as total_events,
        count(*) filter (where created_at >= now() - interval '1 day')::int as events_today,
        count(*) filter (where event_type = 'movie_search')::int as searches,
        count(*) filter (where event_type = 'movie_search' and created_at >= now() - interval '1 day')::int as searches_today,
        count(distinct ip_hash) filter (where created_at >= now() - interval '7 days')::int as unique_users_7d,
        count(*) filter (where event_type = 'movie_search' and status = 'empty')::int as empty_searches,
        count(*) filter (where status = 'error')::int as error_events,
        round(avg(duration_ms) filter (where duration_ms is not null))::int as avg_duration_ms,
        coalesce(sum(tms_request_count), 0)::int as tms_requests,
        coalesce(sum(tms_request_count) filter (where created_at >= now() - interval '1 day'), 0)::int as tms_requests_today,
        coalesce(sum(tmdb_request_count), 0)::int as tmdb_requests,
        coalesce(sum(tmdb_request_count) filter (where created_at >= now() - interval '1 day'), 0)::int as tmdb_requests_today,
        coalesce(sum(tmdb_search_count), 0)::int as tmdb_search_requests,
        coalesce(sum(tmdb_detail_count), 0)::int as tmdb_detail_requests,
        round(avg(tms_request_count) filter (where event_type = 'movie_search_backend' and tms_request_count is not null), 1)::float as avg_tms_requests,
        round(avg(tmdb_request_count) filter (where event_type = 'movie_search_backend' and tmdb_request_count is not null), 1)::float as avg_tmdb_requests
      from usage_events
      where created_at >= now() - interval '30 days'
    `,
    db`
      select
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
        count(*) filter (where event_type = 'movie_search')::int as searches,
        count(distinct ip_hash)::int as unique_users
      from usage_events
      where created_at >= now() - interval '14 days'
      group by 1
      order by 1
    `,
    db`
      select zip, count(*)::int as searches
      from usage_events
      where event_type = 'movie_search'
        and zip is not null
        and created_at >= now() - interval '30 days'
      group by zip
      order by searches desc
      limit 10
    `,
    db`
      select
        coalesce(
          case
            when start_date is not null and end_date is not null and start_date = end_date then to_char(start_date, 'YYYY-MM-DD')
            when start_date is not null and end_date is not null then to_char(start_date, 'YYYY-MM-DD') || ' 至 ' || to_char(end_date, 'YYYY-MM-DD')
            else null
          end,
          days::text || ' 天'
        ) as range_label,
        count(*)::int as searches
      from usage_events
      where event_type = 'movie_search'
        and (days is not null or start_date is not null)
        and created_at >= now() - interval '30 days'
      group by range_label
      order by min(start_date) nulls last, min(days)
    `,
    db`
      select
        created_at,
        event_type,
        zip,
        days,
        to_char(start_date, 'YYYY-MM-DD') as start_date,
        to_char(end_date, 'YYYY-MM-DD') as end_date,
        radius,
        result_count,
        duration_ms,
        tms_request_count,
        tmdb_search_count,
        tmdb_detail_count,
        tmdb_request_count,
        status,
        left(ip_hash, 12) as ip_hash,
        country,
        region,
        user_agent,
        error
      from usage_events
      order by created_at desc
      limit 100
    `,
    db`
      select
        created_at,
        zip,
        days,
        to_char(start_date, 'YYYY-MM-DD') as start_date,
        to_char(end_date, 'YYYY-MM-DD') as end_date,
        result_count,
        duration_ms,
        tms_request_count,
        tmdb_search_count,
        tmdb_detail_count,
        tmdb_request_count,
        status,
        error
      from usage_events
      where duration_ms is not null
      order by duration_ms desc
      limit 10
    `,
    db`
      select
        created_at,
        zip,
        days,
        to_char(start_date, 'YYYY-MM-DD') as start_date,
        to_char(end_date, 'YYYY-MM-DD') as end_date,
        result_count,
        duration_ms,
        tms_request_count,
        tmdb_search_count,
        tmdb_detail_count,
        tmdb_request_count,
        status,
        error
      from usage_events
      where event_type = 'movie_search_backend'
        and (tms_request_count is not null or tmdb_request_count is not null)
      order by coalesce(tms_request_count, 0) + coalesce(tmdb_request_count, 0) desc
      limit 10
    `,
    db`
      select
        created_at,
        event_type,
        zip,
        days,
        to_char(start_date, 'YYYY-MM-DD') as start_date,
        to_char(end_date, 'YYYY-MM-DD') as end_date,
        status,
        error
      from usage_events
      where status = 'error' or error is not null
      order by created_at desc
      limit 20
    `,
  ]);

  return {
    configured: true,
    totals: totals[0],
    daily,
    topZips,
    dayRanges,
    recent,
    slow,
    expensive,
    errors,
    table: USAGE_TABLE,
  };
}
