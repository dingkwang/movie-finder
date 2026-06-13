import postgres from 'postgres';
import { createHash, randomBytes } from 'crypto';
import { requestMetadata } from './usage.js';

const RATE_LIMIT_TABLE = 'rate_limit_buckets';
const CLEANUP_PROBABILITY = 0.01;
const MEMORY_BUCKETS = globalThis.__movieFinderRateLimitBuckets ?? new Map();

globalThis.__movieFinderRateLimitBuckets = MEMORY_BUCKETS;

let client;
let initPromise;

function databaseUrl() {
  return process.env.DATABASE_URL
    ?? process.env.POSTGRES_URL
    ?? process.env.POSTGRES_PRISMA_URL
    ?? process.env.SUPABASE_DB_URL
    ?? '';
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

async function ensureRateLimitTable() {
  const db = sql();
  if (!db) return null;
  if (!initPromise) {
    initPromise = (async () => {
      await db`
        create table if not exists rate_limit_buckets (
          key text not null,
          window_start bigint not null,
          expires_at timestamptz not null,
          count int not null default 0,
          primary key (key, window_start)
        )
      `;
      await db`create index if not exists rate_limit_buckets_expires_at_idx on rate_limit_buckets (expires_at)`;
    })();
  }
  await initPromise;
  return db;
}

// Generated once per process. Used only when no salt is configured, so the IP
// hash is never derived from a source-visible constant or an auth secret. The
// trade-off is that without a real salt, IP buckets are not shared across
// instances — rate limiting degrades looser, never leaking a reversible hash.
const FALLBACK_SALT = randomBytes(16).toString('hex');

function anonymousHash(value) {
  const salt = process.env.RATE_LIMIT_SALT
    ?? process.env.USAGE_IP_SALT
    ?? FALLBACK_SALT;
  return createHash('sha256').update(`${value || 'unknown'}:${salt}`).digest('hex');
}

function costUnits({ days, radius }) {
  const radiusMultiplier = radius >= 100 ? 4 : radius >= 40 ? 2 : 1;
  return Math.max(1, Math.min(120, Number(days || 1) * radiusMultiplier));
}

function rulesFor({ endpoint, ipHash, zip, days, radius }) {
  const units = costUnits({ days, radius });
  const normalizedZip = zip || 'unknown';
  const rules = [
    {
      name: 'ip-burst',
      key: `${endpoint}:ip:${ipHash}:burst`,
      windowMs: 10 * 60 * 1000,
      limit: 40,
      increment: 1,
    },
    {
      name: 'ip-daily-cost',
      key: `${endpoint}:ip:${ipHash}:daily-cost`,
      windowMs: 24 * 60 * 60 * 1000,
      limit: 300,
      increment: units,
    },
    {
      name: 'ip-zip-burst',
      key: `${endpoint}:ip:${ipHash}:zip:${normalizedZip}:burst`,
      windowMs: 10 * 60 * 1000,
      limit: 20,
      increment: 1,
    },
    {
      name: 'zip-burst',
      key: `${endpoint}:zip:${normalizedZip}:burst`,
      windowMs: 10 * 60 * 1000,
      limit: 80,
      increment: 1,
    },
  ];

  if (radius >= 100 || days > 7) {
    rules.push({
      name: 'expensive-hourly',
      key: `${endpoint}:ip:${ipHash}:expensive`,
      windowMs: 60 * 60 * 1000,
      limit: 10,
      increment: 1,
    });
  }

  return rules;
}

function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

function retryAfterSeconds(now, start, windowMs) {
  return Math.max(1, Math.ceil((start + windowMs - now) / 1000));
}

async function incrementDatabaseRule(db, rule, now) {
  const start = windowStart(now, rule.windowMs);
  const expiresAt = new Date(start + rule.windowMs + 60_000);
  const rows = await db`
    insert into rate_limit_buckets (
      key,
      window_start,
      expires_at,
      count
    ) values (
      ${rule.key},
      ${start},
      ${expiresAt},
      ${rule.increment}
    )
    on conflict (key, window_start)
    do update set
      count = ${db(RATE_LIMIT_TABLE)}.count + excluded.count,
      expires_at = greatest(${db(RATE_LIMIT_TABLE)}.expires_at, excluded.expires_at)
    returning count
  `;
  return {
    ...rule,
    count: rows[0]?.count ?? rule.increment,
    retryAfter: retryAfterSeconds(now, start, rule.windowMs),
  };
}

function incrementMemoryRule(rule, now) {
  const start = windowStart(now, rule.windowMs);
  const key = `${rule.key}:${start}`;
  const current = MEMORY_BUCKETS.get(key) ?? {
    count: 0,
    expiresAt: start + rule.windowMs + 60_000,
  };
  current.count += rule.increment;
  MEMORY_BUCKETS.set(key, current);

  if (Math.random() < CLEANUP_PROBABILITY) {
    for (const [bucketKey, bucket] of MEMORY_BUCKETS.entries()) {
      if (bucket.expiresAt <= now) MEMORY_BUCKETS.delete(bucketKey);
    }
  }

  return {
    ...rule,
    count: current.count,
    retryAfter: retryAfterSeconds(now, start, rule.windowMs),
  };
}

async function incrementRules(rules, now) {
  let db;
  try {
    db = await ensureRateLimitTable();
  } catch (error) {
    console.error('rate limit database unavailable, using memory fallback', error);
    return rules.map(rule => incrementMemoryRule(rule, now));
  }
  if (!db) return rules.map(rule => incrementMemoryRule(rule, now));

  if (Math.random() < CLEANUP_PROBABILITY) {
    db`delete from rate_limit_buckets where expires_at < now()`.catch(() => {});
  }

  try {
    return await Promise.all(rules.map(rule => incrementDatabaseRule(db, rule, now)));
  } catch (error) {
    console.error('rate limit database increment failed, using memory fallback', error);
    return rules.map(rule => incrementMemoryRule(rule, now));
  }
}

export async function checkRateLimit({
  request,
  endpoint,
  zip,
  days,
  radius,
}) {
  const metadata = requestMetadata(request);
  const ipHash = anonymousHash(metadata.ip || metadata.userAgent || 'unknown');
  const rules = rulesFor({ endpoint, ipHash, zip, days, radius });
  const now = Date.now();
  const results = await incrementRules(rules, now);
  const exceeded = results
    .filter(result => result.count > result.limit)
    .sort((a, b) => b.retryAfter - a.retryAfter)[0];

  if (!exceeded) {
    const tightest = results
      .map(result => ({ ...result, remaining: Math.max(0, result.limit - result.count) }))
      .sort((a, b) => a.remaining - b.remaining)[0];
    return {
      limited: false,
      limit: tightest?.limit ?? 0,
      remaining: tightest?.remaining ?? 0,
      retryAfter: 0,
    };
  }

  return {
    limited: true,
    reason: exceeded.name,
    limit: exceeded.limit,
    remaining: 0,
    retryAfter: exceeded.retryAfter,
  };
}

export function rateLimitHeaders(result) {
  const headers = {
    'X-RateLimit-Limit': String(result.limit ?? 0),
    'X-RateLimit-Remaining': String(result.remaining ?? 0),
  };
  if (result.retryAfter) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}
