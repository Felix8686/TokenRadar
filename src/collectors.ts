import type { Candidate, CollectResult, SourceRow } from './types';
import { parseJson, sha256, stripHtml, textExcerpt } from './utils';

interface SourceConfig { userAgent?: string; selectorHint?: string; githubMode?: 'commits' | 'releases'; githubOwner?: string; githubRepo?: string; githubBranch?: string; }

function conditionalHeaders(source: SourceRow): Headers {
  const headers = new Headers({ 'user-agent': 'AI-Radar/0.1 (+https://github.com/Felix8686/TokenRadar)', accept: '*/*' });
  if (source.etag) headers.set('if-none-match', source.etag);
  if (source.last_modified) headers.set('if-modified-since', source.last_modified);
  const config = parseJson<SourceConfig>(source.config_json, {});
  if (config.userAgent) headers.set('user-agent', config.userAgent);
  return headers;
}

function decodeXml(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }
function firstTag(block: string, names: string[]): string | undefined { for (const name of names) { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); if (m?.[1]) return decodeXml(m[1]); } return undefined; }
function safeIso(value?: string): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }

function parseFeed(xml: string): Candidate[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  return blocks.slice(0, 30).map((block) => {
    const title = firstTag(block, ['title']) || 'Untitled update';
    const id = firstTag(block, ['guid', 'id']);
    const summary = firstTag(block, ['description', 'summary', 'content', 'content:encoded']);
    const publishedAt = firstTag(block, ['pubDate', 'published', 'updated']);
    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    const url = hrefMatch?.[1] || firstTag(block, ['link']);
    return { externalId: id || url || `${title}:${publishedAt || ''}`, title: textExcerpt(title, 300), summary: summary ? textExcerpt(summary, 1400) : undefined, rawExcerpt: summary ? textExcerpt(summary, 1800) : textExcerpt(title, 1800), url, publishedAt: safeIso(publishedAt) };
  });
}

async function fetchText(source: SourceRow, url: string, accept: string): Promise<{ response: Response; text?: string }> {
  const headers = conditionalHeaders(source); headers.set('accept', accept);
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (response.status === 304) return { response };
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return { response, text: await response.text() };
}

async function collectFeed(source: SourceRow, feedUrl = source.url): Promise<CollectResult> {
  const { response, text } = await fetchText(source, feedUrl, 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || '';
  return { statusCode: response.status, notModified: false, etag: response.headers.get('etag') || undefined, lastModified: response.headers.get('last-modified') || undefined, contentHash: await sha256(body), candidates: parseFeed(body) };
}

async function collectWeb(source: SourceRow): Promise<CollectResult> {
  const { response, text } = await fetchText(source, source.url, 'text/html, text/plain;q=0.9, */*;q=0.8');
  if (response.status === 304) return { statusCode: 304, notModified: true, candidates: [] };
  const body = text || ''; const normalized = stripHtml(body); const excerpt = normalized.length <= 1800 ? normalized : `${normalized.slice(0, 1800)}…`;
  return { statusCode: response.status, notModified: false, etag: response.headers.get('etag') || undefined, lastModified: response.headers.get('last-modified') || undefined, contentHash: await sha256(normalized), candidates: [{ externalId: await sha256(`${source.url}:${excerpt}`), title: `${source.name} changed`, summary: excerpt, rawExcerpt: excerpt, url: source.url }] };
}

async function collectGitHub(source: SourceRow): Promise<CollectResult> {
  const config = parseJson<SourceConfig>(source.config_json, {});
  if (!config.githubOwner || !config.githubRepo) return collectFeed(source);
  const mode = config.githubMode || 'releases';
  const feedUrl = mode === 'commits' ? `https://github.com/${config.githubOwner}/${config.githubRepo}/commits/${config.githubBranch || 'main'}.atom` : `https://github.com/${config.githubOwner}/${config.githubRepo}/releases.atom`;
  return collectFeed(source, feedUrl);
}

export async function collectSource(source: SourceRow): Promise<CollectResult> {
  switch (source.type) {
    case 'rss': return collectFeed(source);
    case 'web': return collectWeb(source);
    case 'github': return collectGitHub(source);
    case 'x': throw new Error('X collector adapter is reserved but not implemented in the zero-cost MVP');
    default: throw new Error(`Unsupported source type: ${source.type}`);
  }
}
