const CENSUS_GEOCODER_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const CENSUS_LOOKUP_TIMEOUT_MS = 8000;
const CENSUS_LAYERS = 'ZIP Code Tabulation Areas,Incorporated Places,County Subdivisions,States';

export const maxDuration = 10;

function json(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  });
}

function parseCoordinate(value, min, max) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function pickFirst(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function pickGeography(geographies, name) {
  const key = Object.keys(geographies).find(item => item.includes(name));
  return pickFirst(key ? geographies[key] : null);
}

function extractLocation(data) {
  const geographies = data?.result?.geographies ?? {};
  const zipArea = pickGeography(geographies, 'ZIP Code Tabulation Areas');
  const place = pickGeography(geographies, 'Incorporated Places');
  const countySubdivision = pickGeography(geographies, 'County Subdivisions');
  const state = pickGeography(geographies, 'States');

  return {
    zip: zipArea?.ZCTA5 ?? null,
    city: place?.BASENAME ?? countySubdivision?.BASENAME ?? null,
    state: state?.STUSAB ?? null,
  };
}

async function fetchCensusData(lat, lon) {
  const params = new URLSearchParams({
    x: String(lon),
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: CENSUS_LAYERS,
    format: 'json',
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CENSUS_LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch(`${CENSUS_GEOCODER_BASE}?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, data };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON body required' }, { status: 400 });
  }

  const lat = parseCoordinate(body?.lat, -90, 90);
  const lon = parseCoordinate(body?.lon, -180, 180);
  if (lat === null || lon === null) {
    return json({ error: 'Valid lat/lon required' }, { status: 400 });
  }

  try {
    const result = await fetchCensusData(lat, lon);
    if (!result.ok) {
      return json({ error: '定位服务暂时不可用，请手动输入邮编' }, { status: 502 });
    }

    const location = extractLocation(result.data);
    if (!/^\d{5}$/.test(location.zip ?? '')) {
      return json({ error: '当前位置没有匹配到美国邮编' }, { status: 404 });
    }

    return json(location);
  } catch (err) {
    if (err?.name === 'AbortError') {
      return json({ error: '定位服务响应超时，请手动输入邮编' }, { status: 504 });
    }
    return json({ error: '定位服务暂时不可用，请手动输入邮编' }, { status: 500 });
  }
}
