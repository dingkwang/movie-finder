import { recordUsageEvent, usageDatabaseConfigured } from '../../lib/usage';

export const maxDuration = 10;

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = body.eventType ?? body.event_type;
  if (!eventType || typeof eventType !== 'string') {
    return Response.json({ error: 'eventType required' }, { status: 400 });
  }

  const result = await recordUsageEvent({
    eventType,
    zip: body.zip,
    days: body.days,
    radius: body.radius,
    resultCount: body.resultCount,
    durationMs: body.durationMs,
    tmsRequestCount: body.tmsRequestCount,
    tmdbSearchCount: body.tmdbSearchCount,
    tmdbDetailCount: body.tmdbDetailCount,
    tmdbRequestCount: body.tmdbRequestCount,
    status: body.status,
    error: body.error,
  }, request);

  return Response.json({
    ok: true,
    enabled: usageDatabaseConfigured() && result.enabled,
  });
}
