import type { Candidate, Classification, ItemRow, SourceRow } from './types';
import { addMinutesIso, isoNow, sha256 } from './utils';

export async function getDueSources(db: D1Database, limit: number): Promise<SourceRow[]> {
  const result = await db.prepare(`SELECT * FROM sources WHERE enabled = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?1) ORDER BY COALESCE(next_fetch_at, created_at) ASC LIMIT ?2`).bind(isoNow(), limit).all<SourceRow>();
  return result.results || [];
}

export async function saveFetchSuccess(db: D1Database, source: SourceRow, state: { etag?: string; lastModified?: string; contentHash?: string; statusCode: number; changed: boolean; durationMs: number }): Promise<void> {
  const now = new Date();
  await db.batch([
    db.prepare(`UPDATE sources SET etag=COALESCE(?1,etag),last_modified=COALESCE(?2,last_modified),content_hash=COALESCE(?3,content_hash),next_fetch_at=?4,last_fetch_at=?5,last_success_at=?5,failure_count=0,status='ok',updated_at=?5 WHERE id=?6`).bind(state.etag || null,state.lastModified || null,state.contentHash || null,addMinutesIso(now,source.interval_minutes),now.toISOString(),source.id),
    db.prepare(`INSERT INTO fetch_logs(source_id,status_code,changed,duration_ms) VALUES(?1,?2,?3,?4)`).bind(source.id,state.statusCode,state.changed ? 1 : 0,state.durationMs),
  ]);
}

export async function saveFetchFailure(db: D1Database, source: SourceRow, error: unknown, durationMs: number): Promise<void> {
  const now = new Date(); const failureCount = source.failure_count + 1; const backoff = Math.min(source.interval_minutes * Math.max(2, 2 ** Math.min(failureCount, 5)), 360); const message = error instanceof Error ? error.message : String(error);
  await db.batch([
    db.prepare(`UPDATE sources SET next_fetch_at=?1,last_fetch_at=?2,failure_count=?3,status='error',updated_at=?2 WHERE id=?4`).bind(addMinutesIso(now,backoff),now.toISOString(),failureCount,source.id),
    db.prepare(`INSERT INTO fetch_logs(source_id,duration_ms,error) VALUES(?1,?2,?3)`).bind(source.id,durationMs,message.slice(0,800)),
  ]);
}

function canonicalUrl(value: string): string { try { const url = new URL(value); for (const key of [...url.searchParams.keys()]) { if (key.toLowerCase().startsWith('utm_') || ['ref','source','campaign'].includes(key.toLowerCase())) url.searchParams.delete(key); } url.hash=''; return url.toString(); } catch { return value.trim(); } }
export async function buildFingerprint(_source: SourceRow, candidate: Candidate): Promise<string> { if (candidate.url) return sha256(`url:${canonicalUrl(candidate.url)}`); const title=candidate.title.toLowerCase().replace(/\s+/g,' ').trim(); const summary=(candidate.summary||'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,240); return sha256(`text:${title}|${summary}`); }

export async function insertItem(db: D1Database, source: SourceRow, candidate: Candidate, c: Classification): Promise<{ inserted: boolean; id?: number }> {
  const fingerprint = await buildFingerprint(source,candidate);
  const result = await db.prepare(`INSERT OR IGNORE INTO items(source_id,external_id,fingerprint,title,summary,url,published_at,kind,priority,score,source_confidence,verification_status,vendor,product,previous_price,current_price,currency,expires_at,raw_excerpt,ai_enriched) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`).bind(source.id,candidate.externalId||null,fingerprint,candidate.title,candidate.summary||null,candidate.url||null,candidate.publishedAt||null,c.kind,c.priority,c.score,c.sourceConfidence,c.verificationStatus,c.vendor||null,c.product||null,c.previousPrice??null,c.currentPrice??null,c.currency||null,c.expiresAt||null,candidate.rawExcerpt||null,c.aiEnriched?1:0).run();
  if (!result.meta.changes) return { inserted:false }; const row = await db.prepare('SELECT id FROM items WHERE fingerprint=?1').bind(fingerprint).first<{id:number}>(); return { inserted:true,id:row?.id };
}
export async function markPushed(db: D1Database,id:number):Promise<void>{await db.prepare('UPDATE items SET pushed_at=?1 WHERE id=?2').bind(isoNow(),id).run();}
export async function getRecentItems(db:D1Database,limit=100):Promise<(ItemRow&{source_name:string})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name FROM items i JOIN sources s ON s.id=i.source_id ORDER BY i.discovered_at DESC LIMIT ?1`).bind(limit).all<ItemRow&{source_name:string}>();return r.results||[];}
export async function getReportItems(db:D1Database,start:string,end:string):Promise<(ItemRow&{source_name:string})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name FROM items i JOIN sources s ON s.id=i.source_id WHERE i.discovered_at>=?1 AND i.discovered_at<?2 AND i.priority IN ('P2','P3') ORDER BY CASE i.priority WHEN 'P2' THEN 1 ELSE 2 END,i.score DESC,i.discovered_at DESC`).bind(start,end).all<ItemRow&{source_name:string}>();return r.results||[];}
