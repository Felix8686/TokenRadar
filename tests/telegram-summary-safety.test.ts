import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDeterministically, maybeEnrichWithAi } from '../src/rules';
import { buildChineseSummary, isGroundedChineseSummary, isHighQualityChineseSummary } from '../src/telegram';
import type { Env, ItemRow, SourceRow } from '../src/types';

function item(kind: ItemRow['kind']): ItemRow {
  return {
    id: 1,
    source_id: 1,
    title: 'Kimi API Pricing changed',
    summary: 'Pricing page content changed.',
    url: 'https://example.com/pricing',
    kind,
    priority: 'P1',
    score: 90,
    source_confidence: 'high',
    verification_status: 'official_confirmed',
    vendor: 'Kimi',
    product: 'API Pricing',
    previous_price: null,
    current_price: null,
    currency: null,
    expires_at: null,
    discovered_at: '2026-09-11T07:33:00.000Z',
    published_at: null,
    pushed_at: null,
  };
}

function source(): SourceRow {
  return {
    id: 1,
    name: 'Kimi API Pricing',
    url: 'https://example.com/pricing',
    type: 'web',
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
  };
}

test('broken Chinese that passes the surface gate is rejected by grounding and falls back', () => {
  const badAiSummary = '个四系统信息当中无更新';
  assert.equal(isHighQualityChineseSummary(badAiSummary), true, 'fixture should pass the old surface-level gate');
  assert.equal(isGroundedChineseSummary(item('limited_offer'), badAiSummary), false);

  const summary = buildChineseSummary(item('limited_offer'), badAiSummary);
  assert.notEqual(summary, badAiSummary);
  assert.equal(summary, '检测到「Kimi API Pricing」限时优惠。建议查看原文确认优惠幅度、领取条件和截止时间。');
});

test('grounded AI summary is preserved instead of being replaced by a template', () => {
  const aiSummary = 'Kimi API 定价页面发生变化，具体价格和生效时间请以原文为准。';
  assert.equal(isGroundedChineseSummary(item('price_change'), aiSummary), true);
  assert.equal(buildChineseSummary(item('price_change'), aiSummary), aiSummary);
});

test('fluent but unsupported timing claims are rejected', () => {
  const aiSummary = 'Kimi 调整了 API 定价，并将在今天起全面执行新的价格方案。';
  assert.equal(isHighQualityChineseSummary(aiSummary), true);
  assert.equal(isGroundedChineseSummary(item('price_change'), aiSummary), false);
  assert.equal(buildChineseSummary(item('price_change'), aiSummary), '检测到「Kimi API Pricing」定价或计费页面发生变化，建议查看原文确认具体价格和生效时间。');
});

test('AI summary gets one retry after grounding failure and uses repaired AI copy', async () => {
  const candidate = {
    title: 'Kimi API Pricing changed',
    summary: 'Pricing page content changed.',
    url: 'https://example.com/pricing',
  };
  const base = classifyDeterministically(source(), candidate);
  let calls = 0;
  const env = {
    AI_ENABLED: 'true',
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-fast',
    AI_DAILY_CALL_LIMIT: '50',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ calls: 1 }) }) }) },
    AI: {
      run: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            response: JSON.stringify({ kind: 'price_change', score: 80, vendor: 'Kimi', product: 'API Pricing', summaryZh: '个四系统信息当中无更新' }),
          };
        }
        return { response: JSON.stringify({ summaryZh: 'Kimi API 定价页面发生变化，具体价格请以原文为准。' }) };
      },
    },
  } as unknown as Env;

  const enriched = await maybeEnrichWithAi(env, source(), candidate, base);
  assert.equal(calls, 2);
  assert.equal(enriched.summaryZh, 'Kimi API 定价页面发生变化，具体价格请以原文为准。');
});
