const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
const MAX_RANGE_SECONDS = 400 * 24 * 60 * 60;
const MAX_FUTURE_SECONDS = 2 * 24 * 60 * 60;

function jsonError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function onRequest({ request }) {
  if (request.method !== 'GET') {
    return jsonError('Only GET is supported.', 405);
  }

  const requestUrl = new URL(request.url);
  const symbol = requestUrl.searchParams.get('symbol') ?? '';
  const interval = requestUrl.searchParams.get('interval') ?? '';
  const period1 = Number(requestUrl.searchParams.get('period1'));
  const period2 = Number(requestUrl.searchParams.get('period2'));
  const now = Math.floor(Date.now() / 1000);

  if (!/^[A-Z0-9.^=_-]{1,20}$/.test(symbol)) {
    return jsonError('Invalid market symbol.', 400);
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return jsonError('Invalid candle interval.', 400);
  }
  if (
    !Number.isSafeInteger(period1) ||
    !Number.isSafeInteger(period2) ||
    period1 <= 0 ||
    period2 <= period1 ||
    period2 - period1 > MAX_RANGE_SECONDS ||
    period2 > now + MAX_FUTURE_SECONDS
  ) {
    return jsonError('Invalid candle time range.', 400);
  }

  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const query = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval,
    includePrePost: 'false',
    events: 'div,splits',
  });

  try {
    const headers = {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://finance.yahoo.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    };
    let upstream;
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      const yahooUrl = new URL(`https://${host}${path}`);
      yahooUrl.search = query.toString();
      upstream = await fetch(yahooUrl, { headers });
      if (upstream.status !== 429) break;
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': upstream.ok ? 'public, max-age=30' : 'no-store',
      },
    });
  } catch {
    return jsonError('Could not reach Yahoo Finance.', 502);
  }
}
