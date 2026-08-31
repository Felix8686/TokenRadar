import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSource } from '../src/collectors';
import { beijingWindow, renderReport } from '../src/daily';
import { buildFingerprint } from '../src/db';
import { toPublicItem } from '../src/index';
import { classifyDeterministically, maybeEnrichWithAi } from '../src/rules';
import { buildChineseSummary, pushDailyReport, pushP1 } from '../src/telegram';
import type { Env, ItemRow, SourceRow } from '../src/types';

const source = (type: SourceRow['type']): SourceRow => ({
  id: 7,
  name: 'Example',
  url: 'https://example.com',
  type,
  trust_level: 'A',
  enabled: 1,
  interval_minutes: 60,
  config_json: null,
  etag: null,
  last_modified: null,
  content_hash: null,
  next_fetch_at: null,
  last_fetch_at: null,
  last_success_at: null,
  failure_count: 0,
  status: 'ok',
});

const item: ItemRow & { source_name: string; last_verified_at: string | null } = {
  id: 1,
  source_id: 7,
  title: 'Example free credit',
  summary: 'Free API credit for developers.',
  url: 'https://example.com/deal',
  kind: 'free_credit',
  priority: 'P2',
  score: 65,
  source_confidence: 'high',
  verification_status: 'official_confirmed',
  vendor: 'Example Vendor',
  product: 'Example API',
  previous_price: 10,
  current_price: 0,
  currency: 'USD',
  expires_at: '2026-09-30',
  discovered_at: '2026-08-31T03:00:00.000Z',
  published_at: '2026-08-31T02:00:00.000Z',
  pushed_at: null,
  source_name: 'Official pricing',
  last_verified_at: '2026-08-31T04:00:00.000Z',
};

test('Beijing daily window ends exactly at 12:30 Asia/Shanghai', () => {
  const window = beijingWindow(new Date('2026-08-31T04:30:00.000Z'));
  assert.deepEqual(window, {
    reportDate: '2026-08-31',
    start: '2026-08-30T04:30:00.000Z',
    end: '2026-08-31T04:30:00.000Z',
  });
});

test('web fingerprints distinguish content changes at the same URL', async () => {
  const first = await buildFingerprint(source('web'), { title: 'Changed', url: source('web').url, externalId: 'hash-a' });
  const second = await buildFingerprint(source('web'), { title: 'Changed', url: source('web').url, externalId: 'hash-b' });
  assert.notEqual(first, second);
});

test('feed fingerprints still deduplicate the same canonical URL', async () => {
  const first = await buildFingerprint(source('rss'), { title: 'Deal', url: 'https://example.com/deal?utm_source=a' });
  const second = await buildFingerprint(source('rss'), { title: 'Deal updated', url: 'https://example.com/deal?utm_source=b' });
  assert.equal(first, second);
});

test('public item projection exposes only user-facing fields', () => {
  const publicItem = toPublicItem(Object.assign({}, item, { raw_excerpt: 'internal', ai_enriched: 1 }));
  assert.equal(publicItem.title, item.title);
  for (const key of ['priority', 'score', 'source_confidence', 'source_id', 'raw_excerpt', 'ai_enriched', 'pushed_at']) {
    assert.equal(key in publicItem, false, `${key} must not be public`);
  }
});

test('daily HTML uses public categories and never renders internal priorities', () => {
  const html = renderReport('2026-08-31', [item]);
  assert.match(html, /免费额度/);
  assert.match(html, /Example Vendor/);
  assert.match(html, /最后核验/);
  assert.doesNotMatch(html, /\bP[123]\b/);
});

test('RSS, GitHub Atom, and web collectors recognize new content', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`<?xml version="1.0"?><rss><channel><item><guid>deal-2</guid><title>New free credits</title><link>https://example.com/deal-2</link><description>New AI API credits</description><pubDate>Mon, 31 Aug 2026 03:00:00 GMT</pubDate></item></channel></rss>`, { status: 200, headers: { etag: '"rss-v2"' } });
    const rss = await collectSource(source('rss'));
    assert.equal(rss.candidates[0]?.externalId, 'deal-2');
    assert.equal(rss.candidates[0]?.url, 'https://example.com/deal-2');

    let githubUrl = '';
    globalThis.fetch = async (input) => {
      githubUrl = String(input);
      return new Response(`<?xml version="1.0"?><feed><entry><id>tag:github.com,2008:Grit::Commit/feed123</id><title>New release pricing</title><link href="https://github.com/example/repo/commit/feed123"/><updated>2026-08-31T03:10:00Z</updated></entry></feed>`, { status: 200 });
    };
    const githubSource = Object.assign(source('github'), { config_json: JSON.stringify({ githubOwner: 'example', githubRepo: 'repo', githubMode: 'commits', githubBranch: 'main' }) });
    const github = await collectSource(githubSource);
    assert.equal(githubUrl, 'https://github.com/example/repo/commits/main.atom');
    assert.equal(github.candidates[0]?.externalId, 'tag:github.com,2008:Grit::Commit/feed123');

    globalThis.fetch = async () => new Response('<html><body>Price is now $1</body></html>', { status: 200 });
    const webBefore = await collectSource(source('web'));
    globalThis.fetch = async () => new Response('<html><body>Price is now free</body></html>', { status: 200 });
    const webAfter = await collectSource(source('web'));
    assert.notEqual(webBefore.contentHash, webAfter.contentHash);
    assert.notEqual(webBefore.candidates[0]?.externalId, webAfter.candidates[0]?.externalId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Workers AI response includes a concise Chinese summary and quota exhaustion falls back to rules', async () => {
  const candidate = { title: 'New coding plan', summary: 'A new plan launch', url: 'https://example.com/plan' };
  const base = classifyDeterministically(source('web'), candidate);
  let aiCalls = 0;
  const env = {
    AI_ENABLED: 'true',
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    AI_DAILY_CALL_LIMIT: '50',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ calls: 1 }) }) }) },
    AI: { run: async () => { aiCalls += 1; return { response: '{"kind":"price_drop","score":80,"vendor":"Example","summaryZh":"Example Coding Plan 已降价，具体价格和适用范围请查看官方页面。"}' }; } },
  } as unknown as Env;
  const enriched = await maybeEnrichWithAi(env, source('web'), candidate, base);
  assert.equal(enriched.kind, 'price_drop');
  assert.equal(enriched.priority, 'P1');
  assert.equal(enriched.summaryZh, 'Example Coding Plan 已降价，具体价格和适用范围请查看官方页面。');
  assert.equal(enriched.aiEnriched, true);
  assert.equal(aiCalls, 1);

  const exhausted = {
    ...env,
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
  } as unknown as Env;
  const fallback = await maybeEnrichWithAi(exhausted, source('web'), candidate, base);
  assert.deepEqual(fallback, base);
  assert.equal(aiCalls, 1, 'AI must not run after the daily quota is exhausted');
});

test('P1 fallback still produces Chinese summary when Workers AI is unavailable', () => {
  const summary = buildChineseSummary(Object.assign({}, item, { kind: 'free_credit' }));
  assert.match(summary, /免费额度/);
  assert.match(summary, /Example Vendor Example API/);
});

test('Telegram is outbound-only and sends P1/daily to one chat without topics', async () => {
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = async (_input, init) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response('{"ok":true}', { status: 200 });
    };
    const env = {
      TELEGRAM_BOT_TOKEN: 'dedicated-test-token',
      TELEGRAM_CHAT_ID: '-1001234567890',
      PUBLIC_BASE_URL: 'https://ai-radar.example',
    } as unknown as Env;
    assert.equal(await pushP1(env, Object.assign({}, item, { source_name: 'Official pricing' }), '这是中文摘要测试。'), true);
    assert.equal(await pushDailyReport(env, '2026-08-31', { p2: 2, p3: 3 }), true);
    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
      assert.equal(payload.chat_id, '-1001234567890');
      assert.equal('message_thread_id' in payload, false);
    }
    assert.match(String(payloads[0].text), /🔥 <b>高价值优惠<\/b>/);
    assert.match(String(payloads[0].text), /📝 <b>中文摘要<\/b>/);
    assert.match(String(payloads[0].text), /这是中文摘要测试/);
    assert.doesNotMatch(String(payloads[0].text), /Free API credit for developers/);
    assert.match(String(payloads[1].text), /📋 <b>AI 优惠雷达日报 · 2026-08-31<\/b>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
