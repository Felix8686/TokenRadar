# AI-Radar

AI-Radar is a zero-cost-first, Cloudflare-native workflow for discovering AI coding-plan, API, token, free-credit, limited-time offer, and price-change information.

## Product direction

- Cloud-first: runs on Cloudflare Workers without a local always-on machine.
- Zero-cost-first: the default architecture must stay within free tiers; paid APIs are not required.
- Low-token monitoring: HTTP/RSS/GitHub/page-change detection runs continuously; AI is only used after a meaningful change is found.
- Telegram-first delivery: P1 items are pushed immediately; P2/P3 are summarized into a daily report at 12:30 Asia/Shanghai.
- Public-ready: the public web view is separated from the admin/control plane from the beginning.

## MVP pipeline

```text
Sources
  -> collectors (RSS / Web / GitHub / future X adapter)
  -> change detection + deduplication
  -> deterministic rules
  -> optional Workers AI enrichment
  -> D1
  -> P1 Telegram push
  -> P2/P3 daily report
  -> public web dashboard
```

## Status

Initial implementation in progress.
