# MT-Calendar-Backend

NestJS backend for TraderLog. Exposes the Yahoo Finance candle proxy that was originally a Cloudflare Pages function.

## Run

```bash
npm install
npm run start:dev      # http://localhost:3000
```

Set `PORT` to use a different port.

## Endpoint

`GET /api/candles`

| Param      | Required | Notes                                            |
| ---------- | -------- | ------------------------------------------------ |
| `symbol`   | yes      | 1-20 chars: `A-Z 0-9 . ^ = _ -` (e.g. `GC=F`)    |
| `interval` | yes      | `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`        |
| `period1`  | yes      | Unix seconds, start of range                     |
| `period2`  | yes      | Unix seconds, end of range (max 400 days later)  |

Example:

```
http://localhost:3000/api/candles?symbol=AAPL&interval=1d&period1=1762000000&period2=1763000000
```

Returns the unmodified Yahoo Finance chart JSON. Errors use `{"error":"..."}` with status 400, 405, 502, or the upstream status.

## Bruno collection

Open Bruno and add an existing collection pointing at `backend/bruno`. Select the `local` environment, then run the requests in the `candles` folder.

## Notes

- The original endpoint file was moved from `functions/api/candles.js` to `reference/candles.js` and kept as a reference of the exact proxy behaviour.
- `chart_engine/scripts/dev-candles.mjs` still imports that reference file, so the old Flutter web dev proxy continues to work.
