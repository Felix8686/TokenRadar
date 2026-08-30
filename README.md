# AI-Radar

AI-Radar is a zero-cost-first, Cloudflare-native workflow for discovering AI Coding Plan, API, Token, free-credit, limited-time offer, and price-change information.

## MVP architecture

```text
RSS / Web / GitHub / future X adapter
        ↓
Cloudflare Cron (every 5 minutes)
        ↓
ETag / Last-Modified / content hash
        ↓
Dedup + deterministic rules
        ↓
Optional Workers AI enrichment
        ↓
Cloudflare D1
   ↙              ↘
P1 Telegram       P2/P3 daily report
immediate push     12:30 Asia/Shanghai
                         ↓
                    public web page
```

The public UI never exposes the internal P1/P2/P3 field. It only affects delivery and ordering.

## Zero-cost rule

The default system must not require paid APIs or paid infrastructure. Workers AI is optional and disabled by default. If a source requires a paid API, the collector should degrade or remain unsupported rather than silently incur cost.

## Current collectors

- RSS / Atom
- Ordinary HTML pages with conditional requests and content hashing
- GitHub repositories through public Atom feeds
- X adapter reserved, intentionally not implemented until a sustainable zero-cost method is selected

## Cloudflare bindings

The Worker expects `DB` (D1), `AI` (Workers AI), and `ASSETS` (Static Assets). Secrets: `ADMIN_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, optional `TELEGRAM_TOPIC_P1`, optional `TELEGRAM_TOPIC_DAILY`. Set `PUBLIC_BASE_URL` after deployment. Never commit secrets.

## Initial setup

1. Create D1 database `ai-radar-db`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
3. `npm install`
4. `npm run db:migrate:remote`
5. Configure secrets with `wrangler secret put ...`.
6. `npm run deploy`

Cloudflare Cron runs in UTC. `30 4 * * *` equals 12:30 Asia/Shanghai.

## API

Public: `GET /api/health`, `GET /api/items`, `GET /daily/YYYY-MM-DD`, `GET /latest`.

Admin (Bearer `ADMIN_TOKEN`): `GET/POST /api/admin/sources`, `POST /api/admin/run-harvest`, `POST /api/admin/run-daily`.

## Delivery policy

- P1: immediate Telegram push.
- P2/P3: daily report at 12:30 Asia/Shanghai.
- First fetch establishes a baseline and does not flood Telegram.

## Status

MVP core is implemented on the `ai-radar-mvp` branch. Cloudflare resource creation, Telegram secrets, live deployment, and X acquisition remain for the deployment/configuration phase.
