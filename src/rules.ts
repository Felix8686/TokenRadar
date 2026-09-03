import type { Candidate, Classification, Env, SourceRow } from './types';
import { buildChineseSummary, isHighQualityChineseSummary } from './telegram';

const FREE_PATTERNS = [/free\s*(credit|quota|token|api)/i, /免费.{0,8}(额度|token|api|调用|试用)/i, /赠送.{0,8}(额度|token|代金券)/i, /注册送/i, /兑换码/i];
const LIMITED_PATTERNS = [/限时/i, /首月/i, /折扣/i, /优惠/i, /coupon|promo|promotion|discount|limited[-\s]?time/i, /充值返/i];
const DROP_PATTERNS = [/降价|下调.{0,8}(价格|定价)|价格.{0,8}下降/i, /price.{0,12}(drop|cut|reduc)/i, /cheaper/i];
const PRICE_CHANGE_PATTERNS = [/涨价|提价|价格调整|定价调整|pricing update|price change/i];
const NEW_PLAN_PATTERNS = [/coding\s*plan|token\s*plan|新套餐|新计划|套餐上线|plan launch/i];

// Official / High-trust release semantics
const OFFICIAL_RELEASE_PATTERNS = [
  /\b(?:introducing|announcing|we\s+release|we\s+are\s+releasing|we're\s+releasing|launching|unveiling)\b.{0,60}\b(?:model|weights?|llm|moe|checkpoint|architecture)\b/i,
  /\b(?:model|weights?|llm|moe)\b.{0,40}\b(?:is\s+now\s+available|now\s+available|has\s+been\s+released|officially\s+released|launched\s+today)\b/i,
  /新模型.{0,10}(发布|推出|上线)|发布.{0,10}(大模型|开源模型|全新模型)|正式推出.{0,10}模型/i,
];

const GENERIC_MODEL_PATTERNS = [
  /new\s+(ai\s+)?model/i,
  /new model discovery/i,
  /model\s+(launch|release|released|debut)/i,
  /introduc(?:e|ing).{0,40}model/i,
  /新模型|模型.{0,10}(发布|推出|上线)|发布.{0,10}(大模型|模型)/i,
];

const API_AVAILABLE_PATTERNS = [/available.{0,24}(via|through|on).{0,24}api/i, /api.{0,24}(available|access|endpoint|上线|开放|可用)/i, /开放.{0,10}api/i, /api\s+model observed/i];
const OPEN_SOURCE_PATTERNS = [/open[-\s]?source/i, /open\s+weights?/i, /weights?.{0,20}(released|available)/i, /开源.{0,12}(模型|权重)|开放权重/i];
const BENCHMARK_PATTERNS = [/benchmark|leaderboard|artificial analysis|evaluation|基准测试|评测|榜单/i];
const CODING_AGENT_PATTERNS = [/\bcoding\b|code generation|software engineering|\bagent(s|ic)?\b|智能体|编程|代码/i];
const HIGH_VALUE_NAMES = ['deepseek', 'glm', '智谱', 'minimax', 'kimi', 'moonshot', '火山', '豆包', '百炼', '通义', '腾讯', 'hunyuan', 'opencode', 'cursor', 'claude', 'codex', 'openai', 'anthropic', 'gemini', 'qwen'];
const MODEL_KINDS = new Set<Classification['kind']>(['new_model', 'model_api_available', 'model_open_source', 'model_benchmark', 'discovered_model']);

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function confidenceForTrust(trust: SourceRow['trust_level']): Classification['sourceConfidence'] {
  if (trust === 'A') return 'high';
  if (trust === 'B') return 'medium';
  return 'low';
}

function verificationForTrust(trust: SourceRow['trust_level']): Classification['verificationStatus'] {
  return trust === 'A' ? 'official_confirmed' : 'unverified';
}

export function isRecentRelease(publishedAt?: string, now = new Date()): boolean {
  if (!publishedAt) return false;
  const pubTime = new Date(publishedAt).getTime();
  if (Number.isNaN(pubTime)) return false;
  const ageMs = now.getTime() - pubTime;
  // <= 14 days (and not absurdly in future > 2 days)
  return ageMs >= -2 * 24 * 60 * 60 * 1000 && ageMs <= 14 * 24 * 60 * 60 * 1000;
}

export function classifyDeterministically(source: SourceRow, candidate: Candidate, now = new Date()): Classification {
  const text = `${candidate.title}\n${candidate.summary || ''}\n${candidate.rawExcerpt || ''}`.toLowerCase();
  let kind: Classification['kind'] = candidate.signalKind || 'other';
  let score =
    candidate.signalKind === 'model_api_available'
      ? 60
      : candidate.signalKind === 'model_open_source'
      ? 55
      : candidate.signalKind === 'new_model'
      ? 50
      : candidate.signalKind === 'discovered_model'
      ? 35
      : candidate.signalKind === 'model_benchmark'
      ? 45
      : 0;

  if (!candidate.signalKind) {
    if (matchesAny(text, FREE_PATTERNS)) {
      kind = 'free_credit';
      score += 65;
    } else if (matchesAny(text, LIMITED_PATTERNS)) {
      kind = 'limited_offer';
      score += 50;
    } else if (matchesAny(text, DROP_PATTERNS)) {
      kind = 'price_drop';
      score += 45;
    } else if (matchesAny(text, NEW_PLAN_PATTERNS)) {
      kind = 'new_plan';
      score += 35;
    } else if (matchesAny(text, PRICE_CHANGE_PATTERNS)) {
      kind = 'price_change';
      score += 30;
    } else if (source.trust_level === 'A' && matchesAny(text, OFFICIAL_RELEASE_PATTERNS)) {
      kind = 'new_model';
      score += 55;
    } else if (matchesAny(text, API_AVAILABLE_PATTERNS)) {
      kind = 'model_api_available';
      score += 50;
    } else if (matchesAny(text, OPEN_SOURCE_PATTERNS)) {
      kind = 'model_open_source';
      score += 45;
    } else if (matchesAny(text, BENCHMARK_PATTERNS)) {
      kind = 'model_benchmark';
      score += 35;
    } else if (matchesAny(text, GENERIC_MODEL_PATTERNS)) {
      kind = isRecentRelease(candidate.publishedAt, now) ? 'new_model' : 'discovered_model';
      score += kind === 'new_model' ? 50 : 35;
    }
  }

  // Strict check on new_model classification
  if (kind === 'new_model') {
    const hasRecentDate = isRecentRelease(candidate.publishedAt, now);
    const hasOfficialReleaseWording = source.trust_level === 'A' && matchesAny(text, OFFICIAL_RELEASE_PATTERNS);
    if (!hasRecentDate && !hasOfficialReleaseWording) {
      kind = 'discovered_model';
      score = Math.min(score, 45);
    }
  }

  const isModelEvent = kind === 'new_model' || kind === 'discovered_model';
  const hasApi = candidate.signalKind === 'model_api_available' || matchesAny(text, API_AVAILABLE_PATTERNS);
  const hasOpenSource = candidate.signalKind === 'model_open_source' || matchesAny(text, OPEN_SOURCE_PATTERNS);
  const hasBenchmark = candidate.signalKind === 'model_benchmark' || matchesAny(text, BENCHMARK_PATTERNS);

  if (isModelEvent && hasApi) score += 25;
  if (isModelEvent && hasOpenSource) score += 15;
  if (isModelEvent && hasBenchmark) score += 5;
  if (isModelEvent && matchesAny(text, CODING_AGENT_PATTERNS)) score += 20;

  if (source.trust_level === 'A') score += 20;
  else if (source.trust_level === 'B') score += 10;
  else if (source.trust_level === 'D') score -= 10;

  if (HIGH_VALUE_NAMES.some((name) => text.includes(name))) score += 10;
  if (/绑卡|credit card required|付费后赠|充值后赠/i.test(text)) score -= 15;
  if (/仅限.{0,12}(美国|us|新加坡|日本|地区)|region[-\s]?locked/i.test(text)) score -= 10;

  // Floor rules: verified new_model / API availability gets at least P2 (40).
  // discovered_model (without verified recent release) has no forced high floor.
  if (kind === 'new_model' || kind === 'model_api_available' || kind === 'model_open_source') {
    score = Math.max(score, 40);
  }

  score = Math.max(0, Math.min(100, score));

  return {
    kind,
    priority: score >= 75 ? 'P1' : score >= 40 ? 'P2' : 'P3',
    score,
    vendor: candidate.vendorHint,
    product: candidate.productHint,
    sourceConfidence: confidenceForTrust(source.trust_level),
    verificationStatus: verificationForTrust(source.trust_level),
    aiEnriched: false,
  };
}

interface AiJson {
  kind?: Classification['kind'];
  score?: number;
  vendor?: string;
  product?: string;
  expiresAt?: string;
  previousPrice?: number;
  currentPrice?: number;
  currency?: string;
  summaryZh?: string;
}

const AI_KINDS = new Set<Classification['kind']>([
  'free_credit',
  'limited_offer',
  'price_drop',
  'price_change',
  'new_plan',
  'new_model',
  'model_api_available',
  'model_open_source',
  'model_benchmark',
  'discovered_model',
  'other',
]);

async function reserveAiCall(env: Env): Promise<boolean> {
  const limit = Math.max(0, Math.min(50, Number(env.AI_DAILY_CALL_LIMIT || 50)));
  if (limit === 0) return false;
  const usageDate = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `INSERT INTO ai_daily_usage(usage_date,calls,updated_at) VALUES(?1,1,CURRENT_TIMESTAMP) ON CONFLICT(usage_date) DO UPDATE SET calls=calls+1,updated_at=CURRENT_TIMESTAMP WHERE calls<?2 RETURNING calls`
  )
    .bind(usageDate, limit)
    .first<{ calls: number }>();
  return Boolean(row);
}

export async function maybeEnrichWithAi(env: Env, source: SourceRow, candidate: Candidate, base: Classification): Promise<Classification> {
  if (env.AI_ENABLED !== 'true' || !env.AI) return base;
  if (base.score < 25) return base;
  try {
    if (!(await reserveAiCall(env))) return base;
  } catch {
    return base;
  }

  const prompt = [
    'You are a strict classifier for AI model, API, developer pricing and deal intelligence.',
    'Return JSON only. Do not invent missing facts.',
    'Allowed kind: free_credit, limited_offer, price_drop, price_change, new_plan, new_model, model_api_available, model_open_source, model_benchmark, discovered_model, other.',
    'CRITICAL RULES:',
    '1. first_seen != newly_released. If a model was created in the past or has no explicit release announcement, DO NOT classify as new_model. Use discovered_model instead.',
    '2. expiresAt ONLY represents an explicit expiration or deadline for a limited-time deal, trial offer, discount, or promotion.',
    '   NEVER use model creation date, publishedAt, release date, last modified date, benchmark observation date, or current date as expiresAt. Leave expiresAt null if there is no explicit expiration deadline.',
    '3. summaryZh MUST be 1-2 fluent, factual Simplified Chinese sentences (under 100 Chinese characters) explaining WHAT happened.',
    '   DO NOT translate code blocks, roleplay instructions, chat templates, or prompt examples.',
    '   If no clear event happened, state clearly that the model was observed in the catalog/discovery feed.',
    `Source trust: ${source.trust_level}`,
    `Rule kind: ${base.kind}`,
    `Title: ${candidate.title}`,
    `Published/Created Date: ${candidate.publishedAt || 'unknown'}`,
    `Structured Details: ${(candidate.summary || candidate.rawExcerpt || '').slice(0, 1500)}`,
    'JSON keys: kind, score, vendor, product, expiresAt, previousPrice, currentPrice, currency, summaryZh.',
  ].join('\n');

  try {
    const result = await env.AI.run(env.AI_MODEL, { prompt, max_tokens: 256 });
    const raw =
      typeof result === 'string'
        ? result
        : result && typeof result === 'object' && 'response' in result && typeof result.response === 'string'
        ? result.response
        : JSON.stringify(result);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return base;

    const parsed = JSON.parse(match[0]) as AiJson;
    const aiScore = Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Number(parsed.score))) : base.score;
    const protectedFloor = base.kind === 'new_model' || base.kind === 'model_api_available' || base.kind === 'model_open_source' ? 40 : 0;
    const score = base.priority === 'P1' ? Math.max(base.score, aiScore) : Math.max(protectedFloor, aiScore);
    const parsedKind = parsed.kind && AI_KINDS.has(parsed.kind) ? parsed.kind : base.kind;

    // Guard against AI hallucinating new_model on old/discovered models
    let kind = parsedKind;
    if (base.kind === 'discovered_model' && parsedKind === 'new_model') {
      kind = 'discovered_model';
    } else if (MODEL_KINDS.has(base.kind) && parsedKind === 'other') {
      kind = base.kind;
    }

    // Strict expiresAt guard: if candidate is model-related or matches publishedAt, strip expiresAt
    let expiresAt: string | undefined = undefined;
    if (parsed.expiresAt && typeof parsed.expiresAt === 'string') {
      const isModelDiscovery = kind === 'new_model' || kind === 'discovered_model' || kind === 'model_api_available' || kind === 'model_open_source' || kind === 'model_benchmark';
      const isSameAsPublished = candidate.publishedAt && parsed.expiresAt.startsWith(candidate.publishedAt.slice(0, 10));
      if (!isModelDiscovery && !isSameAsPublished) {
        expiresAt = parsed.expiresAt;
      }
    }

    // Summary quality gate
    let summaryZh = base.summaryZh;
    if (typeof parsed.summaryZh === 'string' && isHighQualityChineseSummary(parsed.summaryZh)) {
      summaryZh = parsed.summaryZh.replace(/\s+/g, ' ').trim().slice(0, 180);
    } else {
      // Deterministic fallback summary
      const dummyItem = {
        id: 0,
        source_id: source.id,
        title: candidate.title,
        summary: candidate.summary || null,
        url: candidate.url || null,
        kind,
        priority: base.priority,
        score,
        source_confidence: base.sourceConfidence,
        verification_status: base.verificationStatus,
        vendor: parsed.vendor || base.vendor || null,
        product: parsed.product || base.product || null,
        previous_price: parsed.previousPrice ?? base.previousPrice ?? null,
        current_price: parsed.currentPrice ?? base.currentPrice ?? null,
        currency: parsed.currency || base.currency || null,
        expires_at: expiresAt || null,
        discovered_at: new Date().toISOString(),
        published_at: candidate.publishedAt || null,
        pushed_at: null,
      };
      summaryZh = buildChineseSummary(dummyItem);
    }

    return {
      ...base,
      kind,
      score,
      priority: base.priority === 'P1' ? 'P1' : score >= 75 ? 'P1' : score >= 40 ? 'P2' : 'P3',
      vendor: parsed.vendor || base.vendor,
      product: parsed.product || base.product,
      expiresAt,
      previousPrice: parsed.previousPrice ?? base.previousPrice,
      currentPrice: parsed.currentPrice ?? base.currentPrice,
      currency: parsed.currency || base.currency,
      summaryZh,
      aiEnriched: true,
    };
  } catch {
    return base;
  }
}
