import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSource, extractLinkedPageCandidates } from '../src/collectors';
import { classifyDeterministically } from '../src/rules';
import { directP1Allowed, needsVerification, verificationSignalScore } from '../src/verification';
import type { Classification, SourceRow } from '../src/types';

const source = (overrides: Partial<SourceRow> = {}): SourceRow => ({
  id: 9,
  name: 'Multiverse Computing Resources',
  url: 'https://multiversecomputing.com/resources',
  type: 'web',
  trust_level: 'A',
  enabled: 1,
  interval_minutes: 120,
  config_json: null,
  etag: null,
  last_modified: null,
  content_hash: 'old-hash',
  next_fetch_at: null,
  last_fetch_at: null,
  last_success_at: null,
  failure_count: 0,
  status: 'ok',
  source_tier: 'core',
  ...overrides,
});

test('generic web collector emits page-change observation plus exact linked content pages', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`
      <html><body>
        <a href="/resources/introducing-quasar-438b">Introducing Quasar 438B</a>
        <a href="/privacy">Privacy</a>
      </body></html>
    `, { status: 200 });
    const result = await collectSource(source());
    assert.equal(result.candidates[0]?.observationKind, 'page_change');
    const linked = result.candidates.find(candidate => candidate.observationKind === 'linked_page');
    assert.equal(linked?.url, 'https://multiversecomputing.com/resources/introducing-quasar-438b');
    assert.match(linked?.title || '', /Quasar 438B/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('linked-page extraction ignores navigation/legal links and keeps release pages', () => {
  const candidates = extractLinkedPageCandidates(source(), `
    <a href="/about">About us</a>
    <a href="/privacy">Privacy</a>
    <a href="/resources/new-free-api-credit">New free API credit</a>
  `);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.observationKind, 'linked_page');
  assert.match(candidates[0]?.url || '', /new-free-api-credit/);
});

test('page-level changed observation can never go directly to Telegram even if classifier scores it P1', () => {
  const candidate = {
    title: 'Multiverse Computing Resources changed',
    summary: 'Introducing a new free API model with credits for developers',
    url: 'https://multiversecomputing.com/resources',
    observationKind: 'page_change' as const,
  };
  const classification = classifyDeterministically(source(), candidate);
  const forced = { ...classification, priority: 'P1' as const, score: 99 };
  assert.equal(needsVerification(source(), candidate, classification), true);
  assert.equal(directP1Allowed(candidate, forced), false);
  assert.ok(verificationSignalScore(source(), candidate) >= 50);
});

test('linked pages are verification candidates, not direct alerts', () => {
  const candidate = {
    title: 'Introducing Quasar 438B',
    url: 'https://multiversecomputing.com/resources/introducing-quasar-438b',
    observationKind: 'linked_page' as const,
  };
  const c: Classification = {
    kind: 'new_model',
    priority: 'P1',
    score: 90,
    sourceConfidence: 'high',
    verificationStatus: 'official_confirmed',
    aiEnriched: false,
  };
  assert.equal(needsVerification(source(), candidate, c), true);
  assert.equal(directP1Allowed(candidate, c), false);
});

test('plain old catalog discovery cannot become a direct P1 alert', () => {
  const candidate = {
    title: 'Model discovery: apodex/Apodex-1.1-mini',
    summary: 'Created: 2024-03-16 | Observed in Hugging Face trending discovery set',
    publishedAt: '2024-03-16T00:00:00.000Z',
    signalKind: 'discovered_model' as const,
  };
  const c = classifyDeterministically(source({ trust_level: 'B', name: 'Hugging Face Trending LLM Discovery' }), candidate, new Date('2026-09-03T00:00:00Z'));
  assert.equal(c.kind, 'discovered_model');
  assert.equal(needsVerification(source({ trust_level: 'B' }), candidate, c), false);
  assert.equal(directP1Allowed(candidate, { ...c, priority: 'P1' }), false);
});
