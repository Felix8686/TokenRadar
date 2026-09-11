import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChineseSummary, isHighQualityChineseSummary } from '../src/telegram';
import type { ItemRow } from '../src/types';

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

test('Telegram summary never emits semantically broken AI text that passes the old surface gate', () => {
  const badAiSummary = '个四系统信息当中无更新';
  assert.equal(isHighQualityChineseSummary(badAiSummary), true, 'fixture should pass the legacy surface-level gate');

  const summary = buildChineseSummary(item('limited_offer'), badAiSummary);
  assert.notEqual(summary, badAiSummary);
  assert.equal(summary, '检测到「Kimi API Pricing」限时优惠。建议查看原文确认优惠幅度、领取条件和截止时间。');
});

test('Telegram summary does not directly trust even fluent AI free-form copy', () => {
  const aiSummary = 'Kimi 调整了 API 定价，并将在今天起全面执行新的价格方案。';
  const summary = buildChineseSummary(item('price_change'), aiSummary);

  assert.notEqual(summary, aiSummary);
  assert.equal(summary, '检测到「Kimi API Pricing」定价或计费页面发生变化，建议查看原文确认具体价格和生效时间。');
});
