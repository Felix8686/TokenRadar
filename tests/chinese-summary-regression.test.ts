import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSource } from '../src/collectors';
import { renderReport } from '../src/daily';
import type { ItemRow, SourceRow } from '../src/types';

const source: SourceRow = {
  id: 99,
  name: 'incoai/GLM-5.3-Flash-DFlash2 watch',
  url: 'https://huggingface.co/incoai/GLM-5.3-Flash-DFlash2',
  type: 'web',
  trust_level: 'C',
  enabled: 1,
  interval_minutes: 360,
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

const item: ItemRow & { source_name: string; last_verified_at: string | null } = {
  id: 99,
  source_id: 99,
  title: 'incoai/GLM-5.3-Flash-DFlash2 watch changed',
  summary: 'Hugging Face Models Datasets Spaces Buckets Docs Enterprise Pricing Website Tasks HuggingChat Collections',
  url: source.url,
  kind: 'other',
  priority: 'P3',
  score: 20,
  source_confidence: 'low',
  verification_status: 'unverified',
  vendor: null,
  product: null,
  previous_price: null,
  current_price: null,
  currency: null,
  expires_at: null,
  discovered_at: '2026-09-04T02:01:02.000Z',
  published_at: null,
  pushed_at: null,
  source_name: source.name,
  last_verified_at: '2026-09-04T02:01:03.000Z',
};

test('daily report replaces raw English web text with a Chinese fallback summary', () => {
  const html = renderReport('2026-09-04', [item]);
  assert.match(html, /页面或信源发生变化/);
  assert.doesNotMatch(html, /Hugging Face Models Datasets Spaces Buckets Docs/);
});

test('generic web collector prefers main content and strips global navigation chrome', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        '<html><body><nav>Hugging Face Models Datasets Spaces Buckets Docs Enterprise Pricing</nav><main><h1>GLM-5.3-Flash-DFlash2</h1><p>Model card updated with new inference details.</p></main><footer>Terms Privacy</footer></body></html>',
        { status: 200 }
      );
    const result = await collectSource(source);
    const summary = result.candidates[0]?.summary || '';
    assert.match(summary, /Model card updated with new inference details/);
    assert.doesNotMatch(summary, /Models Datasets Spaces Buckets Docs/);
    assert.doesNotMatch(summary, /Terms Privacy/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
