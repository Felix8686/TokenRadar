export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function stripHtml(input: string): string {
  return input.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}

export function textExcerpt(input: string, max = 1600): string {
  const text = stripHtml(input);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function isoNow(): string { return new Date().toISOString(); }
export function addMinutesIso(from: Date, minutes: number): string { return new Date(from.getTime() + minutes * 60_000).toISOString(); }
export function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function jsonResponse(data: unknown, status = 200): Response { return new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
export function parseJson<T>(value: string | null, fallback: T): T { if (!value) return fallback; try { return JSON.parse(value) as T; } catch { return fallback; } }
