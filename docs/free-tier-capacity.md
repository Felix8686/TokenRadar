# AI-Radar 免费层容量评估（2026-08-31）

## 官方上限

- Workers Free：100,000 个动态请求/日；每次 HTTP/Cron 调用 10 ms CPU；每次调用 50 个外部子请求；每账号最多 5 个 Cron Trigger。静态资源请求免费且不限量。[1][2]
- D1 Free：5,000,000 rows read/日、100,000 rows written/日、5 GB 账号总存储；单库 500 MB；单次 Worker 调用最多 50 条 D1 查询。[3][4]
- Workers AI：每天 10,000 Neurons 免费额度；AI-Radar 另设 50 次/UTC 日、每次最多 256 输出 token 的应用层硬上限。[5]
- 当前静态页面采用 Workers Static Assets 的 `assets.directory` + `ASSETS` binding + `run_worker_first`，符合官方当前全栈 Worker 推荐方式。[6]
- `ADMIN_TOKEN`、AI-Radar 专用 Telegram Bot Token 与独立群 Chat ID 只使用加密 Secret；不使用 Topic，且不与 Hermes 共享 Bot 凭据。官方推荐 `wrangler secret put`，Secret 值设置后不在 Wrangler 或 Dashboard 回显。[7]

## 估算假设

- 每个信源平均每 60 分钟抓取一次；Cron 每 5 分钟运行，另有 1 次日报 Cron，即 289 次 Worker 调用/日。
- 外部抓取 `fetch()` 是子请求，不计为入站 Worker 请求；每轮最多处理 10 个源，低于 50 子请求上限。
- D1 保守按每次源抓取 3 rows read、4 rows written 估算；另加 1,000 次/日公开 API 访问，每次最多读取 100 条。
- Workers AI 最坏按 50 次/日、约 4,300 Neurons/日估算，仍低于 10,000 免费额。
- 页面 HTML/CSS/JS 由 Static Assets 直接提供，不计动态请求；`/api/items`、`/latest`、`/daily/*` 才计动态请求。

## 结果

| 信源数 | 源抓取/日 | Worker 基础调用/日 | D1 read/日（含 1,000 次 API 浏览） | D1 write/日 | AI 上限 | 结论 |
|---:|---:|---:|---:|---:|---:|---|
| 20 | 480 | 289 + 动态页面/API 访问 | 101,729 | 2,020 | 4,300 Neurons | **SAFE** |
| 50 | 1,200 | 289 + 动态页面/API 访问 | 103,889 | 4,900 | 4,300 Neurons | **SAFE** |
| 100 | 2,400 | 289 + 动态页面/API 访问 | 107,489 | 9,700 | 4,300 Neurons | **WARNING** |

100 个源的 D1 与请求额度仍远低于免费上限，但平均每个 5 分钟周期会有约 8.3 个到期源，接近当前 `SOURCE_BATCH_SIZE=10`，并且复杂 HTML 的解析可能触碰 Free Cron 10 ms CPU 限制。因此 100 源不作为默认配置；必须先按源类型拆分频率、监控 `exceededCpu`，再决定是否扩容。

当前 9 个源按实际 60/120/180 分钟混合频率约 160 次抓取/日，明显低于 20 源模型，属于 **SAFE**。默认配置不会自动开通付费服务；额度耗尽时应失败或降级，而不是产生额外调用。

## Sources

[1] https://developers.cloudflare.com/workers/platform/pricing
[2] https://developers.cloudflare.com/workers/platform/limits
[3] https://developers.cloudflare.com/d1/platform/pricing
[4] https://developers.cloudflare.com/d1/platform/limits
[5] https://developers.cloudflare.com/workers-ai/platform/pricing
[6] https://developers.cloudflare.com/workers/static-assets
[7] https://developers.cloudflare.com/workers/configuration/secrets
