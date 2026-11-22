import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Query string accepted by GET /api/candles. */
export interface CandleQuery {
  symbol?: string;
  interval?: string;
  period1?: string;
  period2?: string;
}

/** Raw upstream result forwarded by the controller. */
export interface CandleResponse {
  status: number;
  body: string | object;
  contentType: string;
  cacheControl: string;
}

const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
const MAX_RANGE_SECONDS = 400 * 24 * 60 * 60;
const MAX_FUTURE_SECONDS = 2 * 24 * 60 * 60;
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

/**
 * Port of the original Cloudflare Pages function (functions/api/candles.js).
 * It proxies Yahoo Finance chart data without changing its response shape.
 */
@Injectable()
export class CandlesService {
  async getCandles(query: CandleQuery): Promise<CandleResponse> {
    const symbol = query.symbol ?? '';
    const interval = query.interval ?? '';
    const period1 = Number(query.period1);
    const period2 = Number(query.period2);
    const now = Math.floor(Date.now() / 1000);

    if (!/^[A-Z0-9.^=_-]{1,20}$/.test(symbol)) {
      throw this.error('Invalid market symbol.', HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      throw this.error('Invalid candle interval.', HttpStatus.BAD_REQUEST);
    }
    if (
      !Number.isSafeInteger(period1) ||
      !Number.isSafeInteger(period2) ||
      period1 <= 0 ||
      period2 <= period1 ||
      period2 - period1 > MAX_RANGE_SECONDS ||
      period2 > now + MAX_FUTURE_SECONDS
    ) {
      throw this.error('Invalid candle time range.', HttpStatus.BAD_REQUEST);
    }

    const path = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const search = new URLSearchParams({
      period1: String(period1),
      period2: String(period2),
      interval,
      includePrePost: 'false',
      events: 'div,splits',
    });
    const headers = {
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://finance.yahoo.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    };

    try {
      let upstream: Response;
      for (const host of YAHOO_HOSTS) {
        const url = new URL(`https://${host}${path}`);
        url.search = search.toString();
        upstream = await fetch(url, { headers });
        if (upstream.status !== 429) break;
      }

      const raw = await upstream.text();
      let body: string | object = raw;
      try {
        body = JSON.parse(raw) as object;
      } catch {
        // Keep the raw text when Yahoo answers with something non-JSON.
      }

      return {
        status: upstream.status,
        body,
        contentType: upstream.headers.get('content-type') ?? 'application/json',
        cacheControl: upstream.ok ? 'public, max-age=30' : 'no-store',
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw this.error('Could not reach Yahoo Finance.', HttpStatus.BAD_GATEWAY);
    }
  }

  private error(message: string, status: HttpStatus): HttpException {
    return new HttpException({ error: message }, status);
  }
}
