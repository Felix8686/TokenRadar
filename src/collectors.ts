import type { Candidate, CollectResult, SourceConfig, SourceRow } from './types';
import { parseJson, sha256, stripHtml, textExcerpt } from './utils';

function conditionalHeaders(source: SourceRow): Headers {
  const headers = new Headers({ 'user-agent': 'AI-Radar/0.3 (+https://github.com/Felix8686/TokenRadar)', accept: '*/*' });
  if (source.etag) headers.set('if-none-match', source.etag);
  if (source.last_modified) headers.set('if-modified-since', source.last_modified);
  const config = parseJson<SourceConfig>(source.config_json, {});
  if (config.userAgent) headers.set('user-agent', config.userAgent);
  return headers;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function firstTag(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (m?.[1]) return decodeXml(m[1]);
  }
  return undefined;
}

function safeIso(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeUnixIso(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function sanitizeExcerpt(raw?: string): string | undefined {
  if (!raw) return undefined;
  const stripped = stripHtml(raw)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/<(?:system|assistant|user|im_start|im_end)>[\s\S]*?<\/(?:system|assistant|user|im_start|im_end)>/gi, ' ')
    .replace(/^(?:system|assistant|user|human|prompt|instruction):\s*.*$/gim, ' ')
    .replace(/\b(?:please\s+roleplay|you\s+are\s+a|act\s+as|system\s*prompt|chat\s*template)\b[\s\S]*?(?:\n\n|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped ? textExcerpt(stripped, 800) : undefined;
}

function parseFeed(xml: string): Candidate[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return blocks.slice(0, 30).map((block) => {
    const title = firstTag(block, ['title']) || 'Untitled update';
    const id = firstTag(block, ['guid', 'id']);
    const summary = firstTag(block, ['description', 'summary', 'content', 'content:encoded']);
    const publishedAt = firstTag(block, ['pubDate', 'published', 'updated']);
    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    const url = hrefMatch?.[1] || firstTag(block, ['link']);
    const cleanedExcerpt = sanitizeExcerpt(summary);
    return {
      externalId: id || url || `${title}:${publishedAt || ''}`,
      title: textExcerpt(title, 300),
      summary: summary ? textExcerpt(summary, 1400) : undefined,
      rawExcerpt: cleanedExcerpt || textExcerpt(title, 800),
      url,
      publishedAt: safeIso(publishedAt),
    };
  });
}

async function fetchText(source: SourceRow, url: string, accept: string): Promise<{ response: Response; text?: string }> {
  const headers = conditionalHeaders(source);
  headers.set('accept', accept);
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (response.status === 304) return { response };
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return { response, text: await response.text() };
}

async function collectFeed(source: SourceRow, feedUrl = source.url): Promise<CollectResult> {
  const { response, text } = await fetchText(source, feedUrl, 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '';
  return {
    statusCode: response.status,
    notModified: false,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    contentHash: await sha256(body),
    candidates: parseFeed(body),
  };
}

async function collectOpenRouterModels(source: SourceRow): Promise<CollectResult> {
  const { response, text } = await fetchText(source, source.url, 'application/json, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '{}';
  const parsed = JSON.parse(body) as { data?: Array<Record<string, unknown>> };
  const candidates: Candidate[] = (parsed.data || []).slice(0, 300).flatMap((row) => {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return [];
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id;
    const vendor = id.includes('/') ? id.split('/')[0] : undefined;
    const context = Number(row.context_length);
    const pricing = row.pricing && typeof row.pricing === 'object' ? (row.pricing as Record<string, unknown>) : {};
    const promptPrice = typeof pricing.prompt === 'string' ? pricing.prompt : undefined;
    const completionPrice = typeof pricing.completion === 'string' ? pricing.completion : undefined;
    const createdIso = safeUnixIso(row.created);
    const details = [
      `Model ID: ${id}`,
      vendor ? `Vendor: ${vendor}` : '',
      `Display name: ${name}`,
      createdIso ? `Catalog created: ${createdIso.slice(0, 10)}` : '',
      Number.isFinite(context) ? `Context length: ${context}` : '',
      promptPrice ? `Prompt price: ${promptPrice}` : '',
      completionPrice ? `Completion price: ${completionPrice}` : '',
      'Status: API available on OpenRouter',
    ].filter(Boolean).join(' | ');
    return [{
      externalId: `openrouter:${id}`,
      title: `${name} available via API on OpenRouter`,
      summary: details,
      rawExcerpt: details,
      url: `https://openrouter.ai/${id}`,
      publishedAt: createdIso,
      signalKind: 'model_api_available' as const,
      vendorHint: vendor,
      productHint: name,
    }];
  });
  return {
    statusCode: response.status,
    notModified: false,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    contentHash: await sha256(body),
    candidates,
  };
}

async function collectHuggingFaceModels(source: SourceRow): Promise<CollectResult> {
  const { response, text } = await fetchText(source, source.url, 'application/json, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '[]';
  const rows = JSON.parse(body) as Array<Record<string, unknown>>;
  const candidates: Candidate[] = rows.slice(0, 50).flatMap((row) => {
    const id = typeof row.id === 'string' ? row.id : typeof row.modelId === 'string' ? row.modelId : '';
    if (!id) return [];
    const vendor = id.includes('/') ? id.split('/')[0] : undefined;
    const tags = Array.isArray(row.tags) ? row.tags.filter((value): value is string => typeof value === 'string').slice(0, 12) : [];
    const pipeline = typeof row.pipeline_tag === 'string' ? row.pipeline_tag : undefined;
    const library = typeof row.library_name === 'string' ? row.library_name : undefined;
    const createdIso = safeIso(typeof row.createdAt === 'string' ? row.createdAt : undefined);
    const modifiedIso = safeIso(typeof row.lastModified === 'string' ? row.lastModified : undefined);
    const details = [
      `Model ID: ${id}`,
      vendor ? `Vendor: ${vendor}` : '',
      createdIso ? `Created: ${createdIso.slice(0, 10)}` : '',
      modifiedIso ? `Last modified: ${modifiedIso.slice(0, 10)}` : '',
      pipeline ? `Pipeline: ${pipeline}` : '',
      library ? `Library: ${library}` : '',
      tags.length ? `Tags: ${tags.join(', ')}` : '',
      'Status: Observed in Hugging Face trending discovery set',
    ].filter(Boolean).join(' | ');
    return [{
      externalId: `huggingface:${id}`,
      title: `Model discovery: ${id}`,
      summary: details,
      rawExcerpt: details,
      url: `https://huggingface.co/${id}`,
      publishedAt: createdIso,
      signalKind: 'discovered_model' as const,
      vendorHint: vendor,
      productHint: id,
    }];
  });
  return {
    statusCode: response.status,
    notModified: false,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    contentHash: await sha256(body),
    candidates,
  };
}

function artificialAnalysisCandidates(html: string): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const regex = /<a[^>]+href=["'](\/models\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const path = match[1].replace(/\/$/, '');
    if (!path || path === '/models' || seen.has(path)) continue;
    const label = stripHtml(match[2]).replace(/\s+/g, ' ').trim();
    if (!label || label.length > 180) continue;
    seen.add(path);
    const slug = path.split('/').filter(Boolean).pop() || label;
    const details = [
      `Model: ${label}`,
      `Slug: ${slug}`,
      'Indexed by: Artificial Analysis catalog',
      'Note: Discovery signal for model index / benchmarks',
    ].join(' | ');
    candidates.push({
      externalId: `artificial-analysis:${slug}`,
      title: `Model indexed by Artificial Analysis: ${label}`,
      summary: details,
      rawExcerpt: details,
      url: `https://artificialanalysis.ai${path}`,
      signalKind: 'discovered_model',
      productHint: label,
    });
    if (candidates.length >= 300) break;
  }
  return candidates;
}

async function collectArtificialAnalysisModels(source: SourceRow): Promise<CollectResult> {
  const { response, text } = await fetchText(source, source.url, 'text/html, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '';
  return {
    statusCode: response.status,
    notModified: false,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    contentHash: await sha256(body),
    candidates: artificialAnalysisCandidates(body),
  };
}

const LINK_SIGNAL = /\b(?:free|credits?|pricing|price|discount|coupon|promo|api|models?|release|launch|introducing|announcement|open[-\s]?source|benchmark|coding|agent)\b|免费|额度|价格|优惠|折扣|模型|发布|推出|开源|评测|编程|智能体/i;
const CONTENT_PATH = /\/(?:resources?|blog|news|releases?|models?|api|pricing|docs?|changelog)(?:\/|$)/i;

export function extractLinkedPageCandidates(source: SourceRow, html: string): Candidate[] {
  let base: URL;
  try { base = new URL(source.url); } catch { return []; }
  const ranked = new Map<string, { candidate: Candidate; score: number }>();
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const href = match[1].trim();
    if (!href || href.startsWith('#') || /^(?:mailto|javascript|tel):/i.test(href)) continue;
    let target: URL;
    try { target = new URL(href, base); } catch { continue; }
    if (!['http:', 'https:'].includes(target.protocol) || target.origin !== base.origin) continue;
    target.hash = '';
    if (target.pathname === base.pathname && target.search === base.search) continue;
    if (/\.(?:png|jpe?g|gif|svg|webp|css|js|ico|pdf|zip)(?:$|\?)/i.test(target.pathname)) continue;
    if (/\/(?:login|signin|signup|privacy|terms|contact|about)(?:\/|$)/i.test(target.pathname)) continue;
    const label = stripHtml(match[2]).replace(/\s+/g, ' ').trim().slice(0, 220);
    let score = 0;
    if (LINK_SIGNAL.test(label)) score += 45;
    if (LINK_SIGNAL.test(`${target.pathname} ${target.search}`)) score += 35;
    if (CONTENT_PATH.test(target.pathname)) score += 20;
    if (score < 20) continue;
    const url = target.toString();
    const candidate: Candidate = {
      externalId: `linked:${url}`,
      title: label || target.pathname.split('/').filter(Boolean).pop() || url,
      summary: `Linked page observed from ${source.name}`,
      rawExcerpt: label || undefined,
      url,
      observationKind: 'linked_page',
    };
    const previous = ranked.get(url);
    if (!previous || score > previous.score) ranked.set(url, { candidate, score });
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, 60).map((entry) => entry.candidate);
}

async function collectWeb(source: SourceRow): Promise<CollectResult> {
  const config = parseJson<SourceConfig>(source.config_json, {});
  if (config.discoveryProvider === 'openrouter_models') return collectOpenRouterModels(source);
  if (config.discoveryProvider === 'huggingface_models') return collectHuggingFaceModels(source);
  if (config.discoveryProvider === 'artificial_analysis_models') return collectArtificialAnalysisModels(source);

  const { response, text } = await fetchText(source, source.url, 'text/html, text/plain;q=0.9, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '';
  const normalized = sanitizeExcerpt(body) || stripHtml(body).replace(/\s+/g, ' ').trim();
  const contentHash = await sha256(normalized);
  const excerpt = normalized.length <= 1200 ? normalized : `${normalized.slice(0, 1200)}…`;
  const pageChange: Candidate = {
    externalId: contentHash,
    title: `${source.name} changed`,
    summary: excerpt,
    rawExcerpt: excerpt,
    url: source.url,
    observationKind: 'page_change',
  };
  return {
    statusCode: response.status,
    notModified: false,
    etag: response.headers.get('etag') || undefined,
    lastModified: response.headers.get('last-modified') || undefined,
    contentHash,
    candidates: [pageChange, ...extractLinkedPageCandidates(source, body)],
  };
}

async function collectGitHub(source: SourceRow): Promise<CollectResult> {
  const config = parseJson<SourceConfig>(source.config_json, {});
  if (!config.githubOwner || !config.githubRepo) return collectFeed(source);
  const mode = config.githubMode || 'releases';
  const feedUrl =
    mode === 'commits'
      ? `https://github.com/${config.githubOwner}/${config.githubRepo}/commits/${config.githubBranch || 'main'}.atom`
      : `https://github.com/${config.githubOwner}/${config.githubRepo}/releases.atom`;
  return collectFeed(source, feedUrl);
}

export async function collectSource(source: SourceRow): Promise<CollectResult> {
  switch (source.type) {
    case 'rss':
      return collectFeed(source);
    case 'web':
      return collectWeb(source);
    case 'github':
      return collectGitHub(source);
    case 'x':
      throw new Error('X collector adapter is reserved but not implemented; discovery feeds are used as the zero-cost coverage layer');
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}
