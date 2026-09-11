# AI-Radar

AI-Radar is a zero-cost-first, Cloudflare-native workflow for discovering AI model launches, API availability, Coding Plan, Token, free-credit, limited-time offer, and price-change information.

## Discovery Radar v2 architecture

```text
Known sources (RSS / Web / GitHub)
            │
            ├──────────────┐
            │              │
            ↓              ↓
      normal monitoring   discovery feeds
                         (OpenRouter / Hugging Face /
                          Artificial Analysis)
            │              │
            └──────┬───────┘
                   ↓
        change detection + source-entry dedup
                   ↓
          deterministic event classifier
                   ↓
       optional Workers AI enrichment
                   ↓
              Cloudflare D1
          ↙            ↓             ↘
 P1 Telegram     dynamic source pool   P2/P3 daily
 immediate       temporary → candidate 12:30 Asia/Shanghai
                 → core
```

The discovery layer is designed to find previously unknown models/vendors instead of relying only on a manually maintained seed list. A newly discovered model page can be added automatically as a temporary source for 30 days. If it produces meaningful follow-up signals it is promoted to candidate, then to core after repeated useful hits. The active temporary/candidate pool is capped to avoid uncontrolled source growth.

## Event types

AI-Radar now treats model intelligence as first-class data rather than requiring a discount or free-credit signal:

- `new_model`
- `model_api_available`
- `model_open_source`
- `model_benchmark`
- `free_credit`
- `limited_offer`
- `price_drop`
- `price_change`
- `new_plan`

A clear new-model event has a deterministic P2 floor. New models with API availability, coding/agent relevance, or other high-value signals can be promoted to P1.

## Zero-cost rule

The default system does not require paid APIs or paid infrastructure. Discovery uses public web/API endpoints. Workers AI is enabled only after change detection, source-entry/global deduplication, and deterministic filtering. It is hard-capped at 50 calls per UTC day with at most 256 output tokens per call; quota exhaustion or any AI error falls back to the deterministic result.

## Current collectors

- RSS / Atom
- Ordinary HTML pages with conditional requests and content hashing
- GitHub repositories through public Atom feeds
- OpenRouter public model catalog discovery
- Hugging Face text-generation discovery set
- Artificial Analysis model-catalog discovery
- X adapter reserved; the zero-cost discovery layer is the current fallback for X-only announcements

## Source tiers

- `core`: stable long-term monitored source
- `discovery`: aggregator/catalog used to find unknown models and vendors
- `temporary`: auto-added page with a 30-day observation window
- `candidate`: temporary source that produced a meaningful update; observation window extends to 90 days
- candidate sources become `core` after three meaningful hits

## Cloudflare bindings

The Worker expects `DB` (D1), `AI` (Workers AI), and `ASSETS` (Workers Static Assets). Secrets: `ADMIN_TOKEN`, the dedicated AI-Radar `TELEGRAM_BOT_TOKEN`, and the dedicated group `TELEGRAM_CHAT_ID`. AI-Radar has no Telegram webhook or inbound command handler: the bot is outbound-only. Non-secret safety controls include `AI_DAILY_CALL_LIMIT` and `SOURCE_BATCH_SIZE`. Never commit secret values.

## Initial setup / upgrade

1. Create D1 database `ai-radar-db` if this is a fresh install.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` if needed.
3. `npm install`
4. `npm run db:migrate:remote`
5. Configure secrets with `wrangler secret put ...`.
6. `npm run check`
7. `npm run deploy`

Migration `0006_discovery_radar.sql` adds source lifecycle fields and seeds OpenRouter, Hugging Face, Artificial Analysis, plus Multiverse Computing's official resources page.

Cloudflare Cron runs in UTC. `30 4 * * *` equals 12:30 Asia/Shanghai. The report window is the preceding 24 hours ending at 12:30 Beijing time.

## API

Public: `GET /api/health`, `GET /api/items`, `GET /daily/YYYY-MM-DD`, `GET /latest`.

Admin (Bearer `ADMIN_TOKEN`): `GET/POST /api/admin/sources`, `POST /api/admin/run-harvest`, `POST /api/admin/run-daily`.

## Delivery policy

- P1: immediate Telegram push.
- P2/P3: daily report at 12:30 Asia/Shanghai.
- First fetch establishes a baseline and does not flood Telegram.
- A new model does not get discarded merely because no discount/free-credit information is present.

## Branch status

Discovery Radar v2 is implemented on `feature/discovery-radar-v2`, based on `ai-radar-mvp`. `main` is unchanged.
