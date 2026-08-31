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
export async function sourceEntryId(candidate: Candidate): Promise<string> { return candidate.externalId || candidate.url || sha256(`${candidate.title}|${candidate.summary || candidate.rawExcerpt || ''}`); }
export async function buildFingerprint(source: SourceRow, candidate: Candidate): Promise<string> { if (source.type === 'web' && candidate.externalId) return sha256(`web:${source.id}:${candidate.externalId}`); if (candidate.url) return sha256(`url:${canonicalUrl(candidate.url)}`); const title=candidate.title.toLowerCase().replace(/\s+/g,' ').trim(); const summary=(candidate.summary||'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,240); return sha256(`text:${title}|${summary}`); }
export async function rememberSourceEntry(db:D1Database,source:SourceRow,candidate:Candidate):Promise<void>{const externalId=await sourceEntryId(candidate);await db.prepare('INSERT OR IGNORE INTO source_entries(source_id,external_id) VALUES(?1,?2)').bind(source.id,externalId).run();}
export async function rememberSourceEntries(db:D1Database,source:SourceRow,candidates:Candidate[]):Promise<void>{if(!candidates.length)return;const statements=[];for(const candidate of candidates){const externalId=await sourceEntryId(candidate);statements.push(db.prepare('INSERT OR IGNORE INTO source_entries(source_id,external_id) VALUES(?1,?2)').bind(source.id,externalId));}await db.batch(statements);}
export async function filterNewCandidates(db:D1Database,source:SourceRow,candidates:Candidate[]):Promise<Candidate[]>{
  if(!candidates.length)return[];
  const entryIds=await Promise.all(candidates.map(sourceEntryId));
  const entryPlaceholders=entryIds.map((_,index)=>`?${index+2}`).join(',');
  const seenRows=await db.prepare(`SELECT external_id FROM source_entries WHERE source_id=?1 AND external_id IN (${entryPlaceholders})`).bind(source.id,...entryIds).all<{external_id:string}>();
  const seen=new Set((seenRows.results||[]).map(row=>row.external_id));
  const unseen=candidates.filter((_,index)=>!seen.has(entryIds[index]));
  if(!unseen.length)return[];
  const fingerprints=await Promise.all(unseen.map(candidate=>buildFingerprint(source,candidate)));
  const fingerprintPlaceholders=fingerprints.map((_,index)=>`?${index+1}`).join(',');
  const duplicateRows=await db.prepare(`SELECT fingerprint FROM items WHERE fingerprint IN (${fingerprintPlaceholders})`).bind(...fingerprints).all<{fingerprint:string}>();
  const duplicates=new Set((duplicateRows.results||[]).map(row=>row.fingerprint));
  const crossSourceDuplicates=unseen.filter((_,index)=>duplicates.has(fingerprints[index]));
  await rememberSourceEntries(db,source,crossSourceDuplicates);
  return unseen.filter((_,index)=>!duplicates.has(fingerprints[index]));
}

export async function insertItem(db: D1Database, source: SourceRow, candidate: Candidate, c: Classification): Promise<{ inserted: boolean; id?: number }> {
  const fingerprint = await buildFingerprint(source,candidate);
  const result = await db.prepare(`INSERT OR IGNORE INTO items(source_id,external_id,fingerprint,title,summary,url,published_at,kind,priority,score,source_confidence,verification_status,vendor,product,previous_price,current_price,currency,expires_at,raw_excerpt,ai_enriched) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`).bind(source.id,candidate.externalId||null,fingerprint,candidate.title,candidate.summary||null,candidate.url||null,candidate.publishedAt||null,c.kind,c.priority,c.score,c.sourceConfidence,c.verificationStatus,c.vendor||null,c.product||null,c.previousPrice??null,c.currentPrice??null,c.currency||null,c.expiresAt||null,candidate.rawExcerpt||null,c.aiEnriched?1:0).run();
  if (!result.meta.changes) return { inserted:false }; const row = await db.prepare('SELECT id FROM items WHERE fingerprint=?1').bind(fingerprint).first<{id:number}>(); return { inserted:true,id:row?.id };
}
export async function markPushed(db: D1Database,id:number):Promise<void>{await db.prepare('UPDATE items SET pushed_at=?1 WHERE id=?2').bind(isoNow(),id).run();}
export async function getRecentItems(db:D1Database,limit=100):Promise<(ItemRow&{source_name:string;last_verified_at:string|null})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name,s.last_success_at AS last_verified_at FROM items i JOIN sources s ON s.id=i.source_id ORDER BY i.discovered_at DESC LIMIT ?1`).bind(limit).all<ItemRow&{source_name:string;last_verified_at:string|null}>();return r.results||[];}
export async function getReportItems(db:D1Database,start:string,end:string):Promise<(ItemRow&{source_name:string;last_verified_at:string|null})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name,s.last_success_at AS last_verified_at FROM items i JOIN sources s ON s.id=i.source_id WHERE i.discovered_at>=?1 AND i.discovered_at<?2 AND i.priority IN ('P2','P3') ORDER BY CASE i.priority WHEN 'P2' THEN 1 ELSE 2 END,i.score DESC,i.discovered_at DESC`).bind(start,end).all<ItemRow&{source_name:string;last_verified_at:string|null}>();return r.results||[];}
