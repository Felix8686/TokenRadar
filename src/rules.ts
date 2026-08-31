import type { Candidate, Classification, Env, SourceRow } from './types';

const FREE_PATTERNS = [/free\s*(credit|quota|token|api)/i,/免费.{0,8}(额度|token|api|调用|试用)/i,/赠送.{0,8}(额度|token|代金券)/i,/注册送/i,/兑换码/i];
const LIMITED_PATTERNS = [/限时/i,/首月/i,/折扣/i,/优惠/i,/coupon|promo|promotion|discount|limited[-\s]?time/i,/充值返/i];
const DROP_PATTERNS = [/降价|下调.{0,8}(价格|定价)|价格.{0,8}下降/i,/price.{0,12}(drop|cut|reduc)/i,/cheaper/i];
const PRICE_CHANGE_PATTERNS = [/涨价|提价|价格调整|定价调整|pricing update|price change/i];
const NEW_PLAN_PATTERNS = [/coding\s*plan|token\s*plan|新套餐|新计划|套餐上线|plan launch/i];
const HIGH_VALUE_NAMES = ['deepseek','glm','智谱','minimax','kimi','moonshot','火山','豆包','百炼','通义','腾讯','hunyuan','opencode','cursor','claude','codex'];
function matchesAny(text: string, patterns: RegExp[]): boolean { return patterns.some((pattern) => pattern.test(text)); }
function confidenceForTrust(trust: SourceRow['trust_level']): Classification['sourceConfidence'] { if (trust === 'A') return 'high'; if (trust === 'B') return 'medium'; return 'low'; }
function verificationForTrust(trust: SourceRow['trust_level']): Classification['verificationStatus'] { return trust === 'A' ? 'official_confirmed' : 'unverified'; }

export function classifyDeterministically(source: SourceRow, candidate: Candidate): Classification {
  const text = `${candidate.title}\n${candidate.summary || ''}\n${candidate.rawExcerpt || ''}`.toLowerCase();
  let kind: Classification['kind'] = 'other'; let score = 0;
  if (matchesAny(text, FREE_PATTERNS)) { kind = 'free_credit'; score += 65; }
  else if (matchesAny(text, LIMITED_PATTERNS)) { kind = 'limited_offer'; score += 50; }
  else if (matchesAny(text, DROP_PATTERNS)) { kind = 'price_drop'; score += 45; }
  else if (matchesAny(text, NEW_PLAN_PATTERNS)) { kind = 'new_plan'; score += 35; }
  else if (matchesAny(text, PRICE_CHANGE_PATTERNS)) { kind = 'price_change'; score += 30; }
  if (source.trust_level === 'A') score += 20; else if (source.trust_level === 'B') score += 10; else if (source.trust_level === 'D') score -= 10;
  if (HIGH_VALUE_NAMES.some((name) => text.includes(name))) score += 10;
  if (/绑卡|credit card required|付费后赠|充值后赠/i.test(text)) score -= 15;
  if (/仅限.{0,12}(美国|us|新加坡|日本|地区)|region[-\s]?locked/i.test(text)) score -= 10;
  score = Math.max(0, Math.min(100, score));
  return { kind, priority: score >= 75 ? 'P1' : score >= 40 ? 'P2' : 'P3', score, sourceConfidence: confidenceForTrust(source.trust_level), verificationStatus: verificationForTrust(source.trust_level), aiEnriched: false };
}

interface AiJson { kind?: Classification['kind']; score?: number; vendor?: string; product?: string; expiresAt?: string; previousPrice?: number; currentPrice?: number; currency?: string; summaryZh?: string; }
const AI_KINDS = new Set<Classification['kind']>(['free_credit','limited_offer','price_drop','price_change','new_plan','other']);
async function reserveAiCall(env:Env):Promise<boolean>{const limit=Math.max(0,Math.min(50,Number(env.AI_DAILY_CALL_LIMIT||50)));if(limit===0)return false;const usageDate=new Date().toISOString().slice(0,10);const row=await env.DB.prepare(`INSERT INTO ai_daily_usage(usage_date,calls,updated_at) VALUES(?1,1,CURRENT_TIMESTAMP) ON CONFLICT(usage_date) DO UPDATE SET calls=calls+1,updated_at=CURRENT_TIMESTAMP WHERE calls<?2 RETURNING calls`).bind(usageDate,limit).first<{calls:number}>();return Boolean(row);}
export async function maybeEnrichWithAi(env: Env, source: SourceRow, candidate: Candidate, base: Classification): Promise<Classification> {
  if (env.AI_ENABLED !== 'true' || !env.AI) return base;
  if (base.score < 25) return base;
  try { if (!await reserveAiCall(env)) return base; } catch { return base; }
  const prompt = [
    'You are a strict classifier for AI developer pricing/deal intelligence.',
    'Return JSON only. Do not invent missing facts.',
    'Allowed kind: free_credit, limited_offer, price_drop, price_change, new_plan, other.',
    'score is 0-100 and reflects practical value/urgency, not source popularity.',
    'summaryZh must be 1-2 concise Simplified Chinese sentences, no Markdown, at most 100 Chinese characters. Explain the actual offer/change and important conditions if known. Ignore navigation menus, documentation indexes, boilerplate and unrelated page text.',
    `Source trust: ${source.trust_level}`,
    `Title: ${candidate.title}`,
    `Text: ${(candidate.summary || candidate.rawExcerpt || '').slice(0, 2500)}`,
    'JSON keys: kind, score, vendor, product, expiresAt, previousPrice, currentPrice, currency, summaryZh.'
  ].join('\n');
  try {
    const result = await env.AI.run(env.AI_MODEL, { prompt, max_tokens: 256 });
    const raw = typeof result === 'string' ? result : result && typeof result === 'object' && 'response' in result && typeof result.response === 'string' ? result.response : JSON.stringify(result); const match = raw.match(/\{[\s\S]*\}/); if (!match) return base;
    const parsed = JSON.parse(match[0]) as AiJson;
    const aiScore = Number.isFinite(parsed.score) ? Math.max(0, Math.min(100, Number(parsed.score))) : base.score;
    const score = base.priority === 'P1' ? Math.max(base.score, aiScore) : aiScore;
    const kind = parsed.kind && AI_KINDS.has(parsed.kind) ? parsed.kind : base.kind;
    const summaryZh = typeof parsed.summaryZh === 'string' ? parsed.summaryZh.replace(/\s+/g, ' ').trim().slice(0, 180) : base.summaryZh;
    return { ...base, kind, score, priority: base.priority === 'P1' ? 'P1' : score >= 75 ? 'P1' : score >= 40 ? 'P2' : 'P3', vendor: parsed.vendor || base.vendor, product: parsed.product || base.product, expiresAt: parsed.expiresAt || base.expiresAt, previousPrice: parsed.previousPrice ?? base.previousPrice, currentPrice: parsed.currentPrice ?? base.currentPrice, currency: parsed.currency || base.currency, summaryZh, aiEnriched: true };
  } catch { return base; }
}
