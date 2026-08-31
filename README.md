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

The default system does not require paid APIs or paid infrastructure. Workers AI is enabled only after change detection, source-entry/global deduplication, and deterministic filtering. It is hard-capped at 50 calls per UTC day with at most 256 output tokens per call; quota exhaustion or any AI error falls back to the deterministic result. The current cap is intentionally below the Workers AI free daily allocation.

## Current collectors

- RSS / Atom
- Ordinary HTML pages with conditional requests and content hashing
- GitHub repositories through public Atom feeds
- X adapter reserved, intentionally not implemented until a sustainable zero-cost method is selected

## Cloudflare bindings

The Worker expects `DB` (D1), `AI` (Workers AI), and `ASSETS` (Workers Static Assets). Secrets: `ADMIN_TOKEN`, the dedicated AI-Radar `TELEGRAM_BOT_TOKEN`, and the dedicated group `TELEGRAM_CHAT_ID`. AI-Radar has no Telegram webhook or inbound command handler: the bot is outbound-only, does not share Hermes credentials, and does not use forum topics. Non-secret safety controls include `AI_DAILY_CALL_LIMIT` and `SOURCE_BATCH_SIZE`. Never commit secret values.

## Initial setup

1. Create D1 database `ai-radar-db`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc`.
3. `npm install`
4. `npm run db:migrate:remote`
5. Configure secrets with `wrangler secret put ...`.
6. `npm run deploy`

Cloudflare Cron runs in UTC. `30 4 * * *` equals 12:30 Asia/Shanghai. The report window is the preceding 24 hours ending at 12:30 Beijing time.

## Production source seed

The first production migration enables nine sources: DeepSeek, Zhipu BigModel, MiniMax, and Kimi official pricing pages; OpenCode releases; AI Coding Deals, LLM Price Tracker, and Coding Plan CN maintained GitHub collections; and an HN RSS community lead feed. The removed `cheahjs/free-llm-api-resources` repository is retained as a disabled migration record because the upstream URL returns 404.

## API

Public: `GET /api/health`, `GET /api/items`, `GET /daily/YYYY-MM-DD`, `GET /latest`.

Admin (Bearer `ADMIN_TOKEN`): `GET/POST /api/admin/sources`, `POST /api/admin/run-harvest`, `POST /api/admin/run-daily`.

## Delivery policy

- P1: immediate Telegram push.
- P2/P3: daily report at 12:30 Asia/Shanghai.
- First fetch establishes a baseline and does not flood Telegram.

## Status

MVP core is implemented on the `ai-radar-mvp` branch. Cloudflare resource creation, Telegram secrets, live deployment, and X acquisition remain for the deployment/configuration phase.
