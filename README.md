# TraderLog Backend

NestJS + Postgres + TypeORM backend for TraderLog. It owns:

- MT5 broker-session history for the trade detail charts via an internal Python
  stdio worker — the only chart feed;
- the strategy catalogue, rulebook telemetry, verification rules and MT5 tickets;
- user accounts, JWT login/sign-up and per-user strategy drafts.

The Flutter app holds only presentation models and thin HTTP clients; business
data and validation live here.

## Run

```bash
npm install
cp .env.example .env        # then edit JWT_SECRET for anything but local dev
npm run db:up               # Postgres 16 on localhost:5433 (Docker Compose)
npm run start:dev           # API at http://localhost:3000/api
```

Set `PORT` in `.env` to use a different API port. `npm run db:down` stops the
database. If you already have a Postgres server, point `DB_*` in `.env` at it
and skip `db:up`; the schema is created automatically by TypeORM
(`DB_SYNCHRONIZE=true`) and the four playbooks are seeded on first start.

### Environment

| Variable         | Default (in `.env.example`) | Purpose                          |
| ---------------- | --------------------------- | -------------------------------- |
| `PORT`           | `3000`                      | NestJS listen port               |
| `DB_HOST`        | `127.0.0.1`                 | Postgres host                    |
| `DB_PORT`        | `5433`                      | Postgres port                    |
| `DB_USER`        | `traderlog`                 | Postgres user                    |
| `DB_PASSWORD`    | `traderlog`                 | Postgres password                |
| `DB_NAME`        | `traderlog`                 | Postgres database                |
| `DB_SYNCHRONIZE` | `true`                      | Auto-create schema (dev only)    |
| `JWT_SECRET`     | dev placeholder             | Signing secret — change in prod  |
| `JWT_EXPIRES_IN` | `7d`                        | Access token lifetime            |
| `SMTP_USER`      | `arifindepayjr@gmail.com`   | Gmail account sending OTP mail   |
| `SMTP_APP_PASSWORD` | empty                    | 16-char Gmail App Password       |
| `SMTP_FROM`      | `TradeLog <SMTP_USER>`      | Sender shown on verification mail|
| `AUTH_DEV_CODE`  | `true`                      | Fallback when SMTP is not set    |
| `MT5_PYTHON`     | `.venv` / `py -3.12`        | Python interpreter for the worker|
| `MT5_WORKER_PATH`| `backend/mt5_worker.py`     | Internal stdio worker script     |
| `MT5_TERMINAL_PATH` | auto-detect              | Exact broker terminal when needed|
| `MT5_REQUEST_TIMEOUT_MS` | `30000`              | Worker request timeout           |
| `MT5_CACHE_TTL_SECONDS` | `60`                 | History/symbol cache lifetime    |
| `MT5_SESSION_GAP_MULTIPLIER` | `3`           | Broker-session gap detection     |
| `MT5_MAX_SESSION_HOURS` | `30`                 | Max inferred session span        |
| `MT5_MAX_REQUEST_BARS` | `5000`               | Per-request bar cap              |

Never commit `.env`; use `.env.example` as the template.

## Data model (TypeORM)

| Entity         | Table             | Notes                                                       |
| -------------- | ----------------- | ----------------------------------------------------------- |
| `User`         | `users`           | Unique email, bcrypt hash, trading framework (never returned) |
| `AuthCode`     | `auth_codes`      | Hashed 6-digit code, password hash, 10-minute expiry         |
| `Playbook`     | `playbooks`       | Cards + hero/telemetry figures, seeded on first run         |
| `StrategyRule` | `strategy_rules`  | Entry/risk checklist rows, cascade-deleted with a playbook  |
| `StrategyTrade`| `strategy_trades` | Assigned MT5 tickets, cascade-deleted with a playbook       |
| `StrategyDraft`| `strategy_drafts` | Full JSON form payload, owned by a `User`                   |

## Endpoints

All paths are prefixed with `/api`.

### Auth (public)

| Method | Path              | Body                                  | Result                                    |
| ------ | ----------------- | ------------------------------------- | ----------------------------------------- |
| POST   | `/auth/signup`    | `{ email, password, name }`           | `201` + `{ accessToken, user, ... }`      |
| POST   | `/auth/login`     | `{ email, password }`                 | `200` + same token shape (`/signin` alias)|
| POST   | `/auth/request-code` | `{ email, password, name, framework? }` | `200` + `{ email, expiresInSeconds, devCode? }` |
| POST   | `/auth/verify-code`  | `{ email, code }`                       | `200` + same token shape; creates the user     |
| GET    | `/auth/me`        | `Authorization: Bearer <token>`       | `200` + `{ id, email, name, framework? }`      |

Passwords must be 8–72 characters. A duplicate email returns `409`; bad
credentials return `401`. Send the returned `accessToken` as a Bearer token on
protected requests.

The two `*-code` endpoints back the Flutter Create Account → OTP flow. Codes
are bcrypt-hashed in Postgres, expire after 10 minutes, allow five attempts and
are deleted on success. Set `SMTP_APP_PASSWORD` to a Gmail App Password to send
the 6-digit code to the email entered on Create Account; the response then has
`delivery: "email"` and no `devCode`. Without it, development falls back to
`delivery: "dev"` and echoes `devCode` so the screen is still testable (disable
that with `AUTH_DEV_CODE=false`; never enable it in production). A wrong code
returns `401`, an expired one `400`.

### MT5 historical market data (public)

NestJS remains the only HTTP API. `GET /api/mt5/*` talks to an internal,
read-only Python stdio worker that uses the official `MetaTrader5` package and
the locally logged-in terminal. There is no FastAPI service or extra port.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/mt5/status` | Initialized/connected state, broker/server names; soft-degrades to 200 with an error when disconnected |
| GET | `/mt5/symbols?search=XAU` | Exact broker symbols from the terminal |
| GET | `/mt5/candles?symbol=XAUUSDc&date=2026-11-24&timeframe=M15` | Full broker session OHLC candles in UTC |
| GET | `/mt5/latest?symbol=XAUUSDc&timeframe=M15&count=200` | Latest real candles |
| GET | `/mt5/ticks?symbol=XAUUSDc&start=...&end=...` | Read-only ticks for future live updates |

Always pass the exact symbol from the imported trade (the verified Exness symbol
is `XAUUSDc`); symbols are never guessed. Validation errors return `400`, an
unknown symbol `404`, a failed MT5 call `502`, MT5/worker unavailability `503`
and worker timeouts `504`. An empty weekend/holiday session is a successful
`200` with `candles: []` and a `reason`.

`timeframe` accepts `M1`, `M5`, `M15`, `M30`, `H1`, `H4`, `D1`. Candle responses
include `source: "mt5"`, `timezone: "UTC"`, `sessionStart`, `sessionEnd`, and
OHLC/tick volume/spread/real volume. Session boundaries come from the broker's
actual bars, not the PC timezone; weekends and holidays return an empty result
with a `reason`. No order operations are exposed and no MT5 credentials are
returned.

Windows setup, interpreter requirements, and troubleshooting are in
`../implement/mt5_windows_setup.md`. Worker tests:

```bash
python -m venv .venv          # use py -3.12 on Windows
.venv\Scripts\python.exe -m pip install -r requirements-mt5.txt
.venv\Scripts\python.exe -m pytest tests/test_mt5_worker.py -q
```

### Strategies

| Method | Path                  | Auth    | Result                                              |
| ------ | --------------------- | ------- | --------------------------------------------------- |
| GET    | `/strategies`         | public  | Playbook cards + summary KPIs                       |
| GET    | `/strategies/:id`     | public  | Hero, telemetry, rules and MT5 tickets              |
| GET    | `/strategies/drafts`  | Bearer  | Current user's saved drafts, newest first           |
| POST   | `/strategies`         | Bearer  | `201` + `{ id, name, savedAt, draftCount }`         |

`pb_silver_bullet` is the fully hand-authored ICT Silver Bullet rulebook; the
other seeded playbooks have their own rules and tickets too. Unknown ids return
`404`. Creating a draft validates a non-empty `name` (400 on failure) and may
also carry `description`, `category`, `categories`, `narrative`,
`entryConditions`, `takeProfitRule`, `stopLossRule`, `invalidationRule`,
`disciplineRules`, `sessions` and `intervals`.

Quick check:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@example.com","password":"secret123","name":"Trader"}'

curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"trader@example.com","password":"secret123"}'

# Passwordless onboarding (returns devCode locally)
curl -X POST http://localhost:3000/api/auth/request-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"newtrader@example.com","password":"secret123","name":"Alex","framework":"ICT / SMC"}'

curl -X POST http://localhost:3000/api/auth/verify-code \
  -H 'Content-Type: application/json' \
  -d '{"email":"newtrader@example.com","code":"<devCode>"}'

TOKEN=<accessToken from any response above>
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/strategies/drafts

curl -X POST http://localhost:3000/api/strategies \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"London Sweep","category":"ictSmc","sessions":["London"]}'
```

## API clients

### Bruno

Open Bruno → **Add Collection → Directory** → select `backend/bruno`. Pick the
`local` environment. Run `auth/Sign up`, then `auth/Login`; the login script
stores `accessToken` in the environment variable `token`, which the protected
strategy requests use automatically. For the OTP flow run `auth/Request code`
(saves `devCode` to `otp`) then `auth/Verify code` (saves a fresh `token`).

### Postman

Import `backend/postman/TraderLog.postman_collection.json` and
`backend/postman/TraderLog.local.postman_environment.json` (Import → Files).
Select the **TraderLog local** environment, then run **Auth → Sign up** or
**Auth → Login** first; both save the token to the `token` variable used by the
protected requests. **Auth → Request code** saves `devCode` to `otp`; follow it
with **Auth → Verify code** to exercise the OTP screen's backend flow.

## Notes

- The original candle proxy is kept in `reference/candles.js`; the chart dev
  server still imports it.
- Catalogue and rulebook values are seed data in Postgres, not hard-coded in
  Flutter. Updating a row changes every client immediately.
- Drafts persist per user across restarts. Deleting the database volume resets
  the seed data.
- `DB_SYNCHRONIZE=true` is convenient for development; use TypeORM migrations
  before deploying to production.
