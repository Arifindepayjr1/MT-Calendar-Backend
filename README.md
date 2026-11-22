# TraderLog Backend

NestJS + Postgres + TypeORM backend for TraderLog. It owns:

- the Yahoo Finance candle proxy used by the trade detail charts;
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

Never commit `.env`; use `.env.example` as the template.

## Data model (TypeORM)

| Entity         | Table             | Notes                                                       |
| -------------- | ----------------- | ----------------------------------------------------------- |
| `User`         | `users`           | Unique email, bcrypt password hash (never returned)         |
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
| GET    | `/auth/me`        | `Authorization: Bearer <token>`       | `200` + `{ id, email, name }`             |

Passwords must be 8–72 characters. A duplicate email returns `409`; bad
credentials return `401`. Send the returned `accessToken` as a Bearer token on
protected requests.

### Candles (public)

`GET /api/candles?symbol=AAPL&interval=1d&period1=1762000000&period2=1763000000`

Proxy of the original Cloudflare function. `interval` accepts `1m`, `5m`,
`15m`, `30m`, `1h`, `4h`, `1d`; the range is capped at 400 days.

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

TOKEN=<accessToken from either response>
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
strategy requests use automatically.

### Postman

Import `backend/postman/TraderLog.postman_collection.json` and
`backend/postman/TraderLog.local.postman_environment.json` (Import → Files).
Select the **TraderLog local** environment, then run **Auth → Sign up** or
**Auth → Login** first; both save the token to the `token` variable used by the
protected requests.

## Notes

- The original candle proxy is kept in `reference/candles.js`; the chart dev
  server still imports it.
- Catalogue and rulebook values are seed data in Postgres, not hard-coded in
  Flutter. Updating a row changes every client immediately.
- Drafts persist per user across restarts. Deleting the database volume resets
  the seed data.
- `DB_SYNCHRONIZE=true` is convenient for development; use TypeORM migrations
  before deploying to production.
