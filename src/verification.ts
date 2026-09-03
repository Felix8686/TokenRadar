import type { Candidate, Classification, Env, ItemRow, SourceRow, VerificationQueueRow } from './types';
import { getDueVerification, getSourceById, insertItem, markPushed, markVerificationResolved, markVerificationRetry, noteSourceValue, registerDiscoveredSource } from './db';
import { classifyDeterministically, isRecentRelease, maybeEnrichWithAi } from './rules';
import { pushP1 } from './telegram';
import { stripHtml, textExcerpt } from './utils';

const HIGH_VALUE_SIGNAL = /\b(?:free|credits?|quota|token|pricing|price|discount|coupon|promo|api|models?|release|launch|introducing|announcement|open[-\s]?source|benchmark|coding|agent)\b|免费|额度|价格|优惠|折扣|模型|发布|推出|开源|评测|编程|智能体/i;
const STRONG_SIGNAL = /\b(?:free\s+(?:api|credits?|quota)|api\s+(?:available|access)|price\s+(?:drop|cut|change)|introducing|announcing|launching|released|open[-\s]?source)\b|免费.{0,8}(?:api|额度|调用)|开放.{0,8}api|降价|限时|正式发布|正式推出|开源模型/i;
const VERIFYABLE_KINDS = new Set<Classification['kind']>(['free_credit','limited_offer','price_drop','price_change','new_plan','new_model','model_api_available','model_open_source','model_benchmark']);

export function verificationSignalScore(source: SourceRow, candidate: Candidate): number {
  const text = `${candidate.title}\n${candidate.summary || ''}\n${candidate.rawExcerpt || ''}`;
  let score = source.trust_level === 'A' ? 25 : source.trust_level === 'B' ? 15 : 5;
  if (candidate.observationKind === 'linked_page') score += 30;
  if (candidate.observationKind === 'page_change') score += 15;
  if (HIGH_VALUE_SIGNAL.test(text)) score += 25;
  if (STRONG_SIGNAL.test(text)) score += 25;
  return Math.max(0, Math.min(100, score));
}

export function needsVerification(source: SourceRow, candidate: Candidate, classification: Classification): boolean {
  if (candidate.observationKind === 'page_change' || candidate.observationKind === 'linked_page') return true;
  if (classification.kind !== 'discovered_model') return false;
  if (isRecentRelease(candidate.publishedAt)) return true;
  return verificationSignalScore(source, candidate) >= 70;
}

export function directP1Allowed(candidate: Candidate, classification: Classification): boolean {
  if (candidate.observationKind) return false;
  if (classification.kind === 'discovered_model' || classification.kind === 'other') return false;
  return classification.priority === 'P1';
}

function extractPageTitle(html: string, fallback: string): string {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const value = stripHtml(h1 || title || '').replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 300) : fallback;
}

function extractPublishedAt(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|date|datePublished|publish_date)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|date|datePublished|publish_date)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

async function fetchVerificationCandidate(row: VerificationQueueRow, queued: Candidate): Promise<Candidate> {
  if (!queued.url) throw new Error('verification candidate has no URL');
  const response = await fetch(queued.url, {
    headers: {
      'user-agent': 'AI-Radar/0.3 (+https://github.com/Felix8686/TokenRadar)',
      accept: 'text/html, text/plain;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`verification HTTP ${response.status} for ${queued.url}`);
  const body = await response.text();
  const normalized = stripHtml(body).replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('verification page has no readable text');
  const title = extractPageTitle(body, queued.title);
  const excerpt = textExcerpt(normalized, 1800);
  return {
    externalId: `verified:${row.external_id}`,
    title,
    summary: excerpt,
    rawExcerpt: excerpt,
    url: response.url || queued.url,
    publishedAt: extractPublishedAt(body) || queued.publishedAt,
    vendorHint: queued.vendorHint,
    productHint: queued.productHint,
  };
}

function buildItem(source: SourceRow, id: number, candidate: Candidate, c: Classification): ItemRow & { source_name: string } {
  return {
    id,
    source_id: source.id,
    title: candidate.title,
    summary: candidate.summary || null,
    url: candidate.url || null,
    kind: c.kind,
    priority: c.priority,
    score: c.score,
    source_confidence: c.sourceConfidence,
    verification_status: c.verificationStatus,
    vendor: c.vendor || null,
    product: c.product || null,
    previous_price: c.previousPrice ?? null,
    current_price: c.currentPrice ?? null,
    currency: c.currency || null,
    expires_at: c.expiresAt || null,
    discovered_at: new Date().toISOString(),
    published_at: candidate.publishedAt || null,
    pushed_at: null,
    source_name: source.name,
  };
}

async function verifyOne(env: Env, row: VerificationQueueRow): Promise<boolean> {
  const source = await getSourceById(env.DB, row.source_id);
  if (!source) {
    await markVerificationRetry(env.DB, row, 'source not found');
    return false;
  }
  let queued: Candidate;
  try {
    queued = JSON.parse(row.candidate_json) as Candidate;
  } catch (error) {
    await markVerificationRetry(env.DB, row, error);
    return false;
  }

  try {
    const candidate = await fetchVerificationCandidate(row, queued);
    const deterministic = classifyDeterministically(source, candidate);
    if (!VERIFYABLE_KINDS.has(deterministic.kind)) {
      await markVerificationRetry(env.DB, row, `no concrete event extracted: ${deterministic.kind}`);
      return false;
    }
    const c = await maybeEnrichWithAi(env, source, candidate, deterministic);
    if (!VERIFYABLE_KINDS.has(c.kind)) {
      await markVerificationRetry(env.DB, row, `AI did not confirm a concrete event: ${c.kind}`);
      return false;
    }

    const saved = await insertItem(env.DB, source, candidate, c);
    if (saved.inserted && saved.id) {
      await registerDiscoveredSource(env.DB, source, candidate, c);
      await noteSourceValue(env.DB, source, c);
      if (c.priority === 'P1') {
        const item = buildItem(source, saved.id, candidate, c);
        if (await pushP1(env, item, c.summaryZh)) await markPushed(env.DB, saved.id);
      }
    }
    await markVerificationResolved(env.DB, row.id, saved.id || null);
    return true;
  } catch (error) {
    await markVerificationRetry(env.DB, row, error);
    return false;
  }
}

export async function processVerificationQueue(env: Env, limit = 5): Promise<{ processed: number; verified: number }> {
  const rows = await getDueVerification(env.DB, limit);
  let verified = 0;
  for (const row of rows) {
    if (await verifyOne(env, row)) verified += 1;
  }
  return { processed: rows.length, verified };
}
