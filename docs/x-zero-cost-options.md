# X 零成本抓取候选方案（2026-08-31）

## 结论

本阶段不正式上线 X Collector。2026 年官方 X API 已转为按资源计费：读取 Post 为每条 $0.005，需购买 credits；“免费 xAI credits”是购买 X API credits 后的返利，不是免费读取额度。[8] 官方 changelog 仅说明经批准的 Public Utility Apps 可继续免费规模化访问、近期 Legacy Free 用户有一次性 $10 voucher，这两类都不是 AI-Radar 可长期默认依赖的公开免费层。[9]

因此继续保留 `XCollector` 接口，首选未来出现的官方免费 read-only 计划；当前不购买 X API、不使用付费代理、不部署自动登录脚本。

## 候选矩阵

| 方案 | 免费 | 需要登录 | 稳定性 | Cloudflare 可直接运行 | 主要风险 | 推荐级别 |
|---|---|---|---|---|---|---|
| 官方 X API Pay-per-use | 否 | 开发者账号 | 高 | 是 | 明确按读取资源收费；违反长期 0 元目标 | **不采用** |
| Public Utility Apps 特批 | 可能 | 需要申请与审核 | 高 | 是 | 非通用免费层，资格不确定 | **C：仅在官方批准后重评** |
| RSSHub 自托管 Twitter 路由 | 软件免费 | 通常需要 X Cookie/账号 | 低至中 | 不能直接作为纯 Worker 路由运行 | Cookie 失效、接口字段轮换、账号风控；2026 仍有时间线空结果问题。[10] | **D** |
| Nitter/公共实例 RSS | 表面免费 | 否 | 低 | 技术上可抓公开实例 | 上游 guest access、实例存活、法律与封禁风险；不能作为长期 SLA。[11] | **D** |
| X Syndication 单 Tweet endpoint | 免费且免登录 | 否 | 中 | 是 | 只能在已知 Tweet ID 后读取，不能发现新内容 | **C：只作详情补全** |
| 搜索引擎 `site:x.com` 线索 | 取决于搜索服务免费额度 | 否 | 低至中 | 取决于供应商 | 索引延迟、漏检、搜索 API 配额，不是完整时间线 | **C：只作发现补充** |
| OpenCLI/浏览器登录态 | 工具本身免费 | 是 | 中 | 否（依赖本机浏览器会话） | 电脑关闭即停止，不符合脱离本机要求 | **不用于生产** |
| 用户手工提交 X 链接 | 免费 | Worker 不需要登录 | 高 | 是 | 不是自动发现源 | **B：可作为补充入口** |

## 后续触发条件

仅在以下任一条件满足时重新评估并实现：

1. X 官方提供明确、可长期使用的免费只读/search 配额；
2. 获得 Public Utility Apps 免费资格且条款允许该监控场景；
3. 出现无需账户 Cookie、可在 Cloudflare 运行、连续验证至少 30 天的合法稳定公共源。

在此之前，AI-Radar 的 RSS/Web/GitHub 主链独立运行，X 不影响上线与日报。

## Sources

[8] https://docs.x.com/x-api/getting-started/pricing
[9] https://docs.x.com/changelog
[10] https://github.com/DIYgod/RSSHub/issues/22938
[11] https://github.com/zedeus/nitter
