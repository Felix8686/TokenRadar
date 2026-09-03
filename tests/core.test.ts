import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSource } from '../src/collectors';
import { beijingWindow, renderReport } from '../src/daily';
import { buildFingerprint } from '../src/db';
import { toPublicItem } from '../src/index';
import { classifyDeterministically, isRecentRelease, maybeEnrichWithAi } from '../src/rules';
import { buildChineseSummary, isHighQualityChineseSummary, pushDailyReport, pushP1 } from '../src/telegram';
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

test('model discovery fingerprints are event-aware', async () => {
  const newModel = await buildFingerprint(source('web'), { title: 'Quasar', signalKind: 'new_model', vendorHint: 'Multiverse', productHint: 'Quasar 438B' });
  const api = await buildFingerprint(source('web'), { title: 'Quasar API', signalKind: 'model_api_available', vendorHint: 'Multiverse', productHint: 'Quasar 438B' });
  assert.notEqual(newModel, api);
});

test('public item projection exposes only user-facing fields', () => {
  const publicItem = toPublicItem(Object.assign({}, item, { raw_excerpt: 'internal', ai_enriched: 1 }));
  assert.equal(publicItem.title, item.title);
  for (const key of ['priority', 'score', 'source_confidence', 'source_id', 'raw_excerpt', 'ai_enriched', 'pushed_at']) {
    assert.equal(key in publicItem, false, `${key} must not be public`);
  }
});

test('daily HTML uses public categories and never renders internal priorities', () => {
  const modelItem = Object.assign({}, item, { id: 2, kind: 'new_model' as const, title: 'Quasar 438B', priority: 'P2' as const });
  const html = renderReport('2026-08-31', [item, modelItem]);
  assert.match(html, /免费额度/);
  assert.match(html, /新模型与 API/);
  assert.match(html, /Quasar 438B/);
  assert.match(html, /Example Vendor/);
  assert.match(html, /最后核验/);
  assert.doesNotMatch(html, /\bP[123]\b/);
});

test('RSS, GitHub Atom, web, and model discovery collectors recognize new content', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        `<?xml version="1.0"?><rss><channel><item><guid>deal-2</guid><title>New free credits</title><link>https://example.com/deal-2</link><description>New AI API credits</description><pubDate>Mon, 31 Aug 2026 03:00:00 GMT</pubDate></item></channel></rss>`,
        { status: 200, headers: { etag: '"rss-v2"' } }
      );
    const rss = await collectSource(source('rss'));
    assert.equal(rss.candidates[0]?.externalId, 'deal-2');
    assert.equal(rss.candidates[0]?.url, 'https://example.com/deal-2');

    let githubUrl = '';
    globalThis.fetch = async (input) => {
      githubUrl = String(input);
      return new Response(
        `<?xml version="1.0"?><feed><entry><id>tag:github.com,2008:Grit::Commit/feed123</id><title>New release pricing</title><link href="https://github.com/example/repo/commit/feed123"/><updated>2026-08-31T03:10:00Z</updated></entry></feed>`,
        { status: 200 }
      );
    };
    const githubSource = Object.assign(source('github'), {
      config_json: JSON.stringify({ githubOwner: 'example', githubRepo: 'repo', githubMode: 'commits', githubBranch: 'main' }),
    });
    const github = await collectSource(githubSource);
    assert.equal(githubUrl, 'https://github.com/example/repo/commits/main.atom');
    assert.equal(github.candidates[0]?.externalId, 'tag:github.com,2008:Grit::Commit/feed123');

    globalThis.fetch = async () => new Response('<html><body>Price is now $1</body></html>', { status: 200 });
    const webBefore = await collectSource(source('web'));
    globalThis.fetch = async () => new Response('<html><body>Price is now free</body></html>', { status: 200 });
    const webAfter = await collectSource(source('web'));
    assert.notEqual(webBefore.contentHash, webAfter.contentHash);
    assert.notEqual(webBefore.candidates[0]?.externalId, webAfter.candidates[0]?.externalId);

    const openRouterSource = Object.assign(source('web'), {
      url: 'https://openrouter.ai/api/v1/models',
      config_json: JSON.stringify({ discoveryProvider: 'openrouter_models' }),
    });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'multiverse/quasar-438b', name: 'Quasar 438B', created: 1788360000, context_length: 131072, pricing: { prompt: '0.000001', completion: '0.000003' } }],
        }),
        { status: 200 }
      );
    const openRouter = await collectSource(openRouterSource);
    assert.equal(openRouter.candidates[0]?.signalKind, 'model_api_available');
    assert.equal(openRouter.candidates[0]?.productHint, 'Quasar 438B');

    const aaSource = Object.assign(source('web'), {
      url: 'https://artificialanalysis.ai/models',
      config_json: JSON.stringify({ discoveryProvider: 'artificial_analysis_models' }),
    });
    globalThis.fetch = async () =>
      new Response('<html><body><a href="/models/quasar-438b"><span>Quasar 438B</span></a></body></html>', { status: 200 });
    const aa = await collectSource(aaSource);
    assert.equal(aa.candidates[0]?.externalId, 'artificial-analysis:quasar-438b');
    assert.equal(aa.candidates[0]?.signalKind, 'discovered_model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Regression Test 1: Hugging Face model created in 2024 (age > 14 days)
test('Regression 1: Hugging Face model from 2024 is discovered_model, never new_model or P1', () => {
  const hfSource = Object.assign(source('web'), { trust_level: 'B' as const });
  const fixedNow = new Date('2026-09-03T00:00:00.000Z');
  const candidate = {
    title: 'Model discovery: OBLITERATUS/Ornith-1.5-9B-OBLITERATED',
    summary: 'Model ID: OBLITERATUS/Ornith-1.5-9B-OBLITERATED | Created: 2024-09-23 | Status: Observed in Hugging Face trending discovery set',
    publishedAt: '2024-09-23T00:00:00.000Z',
    signalKind: 'discovered_model' as const,
    vendorHint: 'OBLITERATUS',
    productHint: 'OBLITERATUS/Ornith-1.5-9B-OBLITERATED',
  };
  const result = classifyDeterministically(hfSource, candidate, fixedNow);
  assert.equal(result.kind, 'discovered_model');
  assert.notEqual(result.kind, 'new_model');
  assert.notEqual(result.priority, 'P1');
  assert.ok(result.score < 75);
});

// Regression Test 2: Hugging Face model created 3 days ago
test('Regression 2: Hugging Face model created 3 days ago is new_model and at least P2', () => {
  const hfSource = Object.assign(source('web'), { trust_level: 'B' as const });
  const fixedNow = new Date('2026-09-03T00:00:00.000Z');
  const candidate = {
    title: 'Model discovery: deepseek-ai/DeepSeek-V3.5',
    summary: 'Model ID: deepseek-ai/DeepSeek-V3.5 | Created: 2026-08-31 | Status: Observed in Hugging Face trending discovery set',
    publishedAt: '2026-08-31T00:00:00.000Z',
    signalKind: 'new_model' as const,
    vendorHint: 'deepseek-ai',
    productHint: 'DeepSeek-V3.5',
  };
  const result = classifyDeterministically(hfSource, candidate, fixedNow);
  assert.equal(result.kind, 'new_model');
  assert.ok(result.priority === 'P1' || result.priority === 'P2');
  assert.ok(result.score >= 40);
});

// Regression Test 3: Official announcement "Introducing Quasar 438B" within 7 days
test('Regression 3: Official release "Introducing Quasar 438B" is new_model and can become P1 with API/Coding signals', () => {
  const officialSource = Object.assign(source('web'), { trust_level: 'A' as const });
  const fixedNow = new Date('2026-09-03T00:00:00.000Z');
  const candidate = {
    title: 'Introducing Quasar 438B',
    summary: 'Today we announce and release the Quasar 438B model. It is now available via API for coding and agent workflows.',
    publishedAt: '2026-08-30T00:00:00.000Z',
    productHint: 'Quasar 438B',
    vendorHint: 'Multiverse Computing',
  };
  const result = classifyDeterministically(officialSource, candidate, fixedNow);
  assert.equal(result.kind, 'new_model');
  assert.equal(result.priority, 'P1');
  assert.ok(result.score >= 75);
});

// Regression Test 4: Garbled / hallucinated AI Chinese summary rejected by quality gate
test('Regression 4: Garbled AI Chinese summary is rejected and falls back to deterministic factual summary', async () => {
  const candidate = {
    title: 'Model discovery: OBLITERATUS/Ornith-1.5-9B-OBLITERATED',
    summary: 'Model ID: OBLITERATUS/Ornith-1.5-9B-OBLITERATED | Created: 2024-09-23',
    publishedAt: '2024-09-23T00:00:00.000Z',
    signalKind: 'discovered_model' as const,
  };
  const base = classifyDeterministically(source('web'), candidate);
  const env = {
    AI_ENABLED: 'true',
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    AI_DAILY_CALL_LIMIT: '50',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ calls: 1 }) }) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          kind: 'discovered_model',
          score: 30,
          summaryZh: '一个回家的国度学习模式。给我一个不得偷的学习。',
        }),
      }),
    },
  } as unknown as Env;

  const enriched = await maybeEnrichWithAi(env, source('web'), candidate, base);
  assert.doesNotMatch(enriched.summaryZh || '', /国度学习模式|不得偷/);
  assert.match(enriched.summaryZh || '', /在信源中观测到模型|收录/);
  assert.equal(isHighQualityChineseSummary('一个回家的国度学习模式。给我一个不得偷的学习。'), false);
});

// Regression Test 5: createdAt must never become expires_at
test('Regression 5: createdAt = 2024-09-23 preserves published_at but expires_at is null', async () => {
  const candidate = {
    title: 'Model discovery: OBLITERATUS/Ornith-1.5-9B-OBLITERATED',
    summary: 'Model ID: OBLITERATUS/Ornith-1.5-9B-OBLITERATED | Created: 2024-09-23',
    publishedAt: '2024-09-23T00:00:00.000Z',
    signalKind: 'discovered_model' as const,
  };
  const base = classifyDeterministically(source('web'), candidate);
  const env = {
    AI_ENABLED: 'true',
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct',
    AI_DAILY_CALL_LIMIT: '50',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ calls: 1 }) }) }) },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          kind: 'discovered_model',
          score: 30,
          expiresAt: '2024-09-23T00:00:00Z',
          summaryZh: '在信源中观测到模型 Ornith-1.5-9B，创建于 2024-09-23。',
        }),
      }),
    },
  } as unknown as Env;

  const enriched = await maybeEnrichWithAi(env, source('web'), candidate, base);
  assert.equal(enriched.expiresAt, undefined);
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
    assert.match(String(payloads[0].text), /🔥 <b>高价值情报<\/b>/);
    assert.match(String(payloads[0].text), /📝 <b>中文摘要<\/b>/);
    assert.match(String(payloads[0].text), /这是中文摘要测试/);
    assert.doesNotMatch(String(payloads[0].text), /Free API credit for developers/);
    assert.match(String(payloads[1].text), /📋 <b>AI-Radar 日报 · 2026-08-31<\/b>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
