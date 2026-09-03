import type { Candidate, Classification, ItemRow, SourceRow, SourceTier } from './types';
import { addMinutesIso, isoNow, sha256 } from './utils';

const DISCOVERY_KINDS = new Set<Classification['kind']>(['new_model','model_api_available','model_open_source','model_benchmark']);

export async function expireTemporarySources(db:D1Database):Promise<void>{
  await db.prepare(`UPDATE sources SET enabled=0,status='expired',updated_at=?1 WHERE enabled=1 AND source_tier IN ('temporary','candidate') AND expires_at IS NOT NULL AND expires_at<=?1`).bind(isoNow()).run();
}

export async function getDueSources(db: D1Database, limit: number): Promise<SourceRow[]> {
  const now=isoNow();
  const result = await db.prepare(`SELECT * FROM sources WHERE enabled = 1 AND (source_tier NOT IN ('temporary','candidate') OR expires_at IS NULL OR expires_at > ?1) AND (next_fetch_at IS NULL OR next_fetch_at <= ?1) ORDER BY COALESCE(next_fetch_at, created_at) ASC LIMIT ?2`).bind(now, limit).all<SourceRow>();
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
function normalizedModelKey(value:string|undefined):string{return (value||'').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,' ').trim();}
export async function sourceEntryId(candidate: Candidate): Promise<string> { return candidate.externalId || candidate.url || sha256(`${candidate.title}|${candidate.summary || candidate.rawExcerpt || ''}`); }
export async function buildFingerprint(source: SourceRow, candidate: Candidate): Promise<string> {
  if(candidate.signalKind&&candidate.productHint){const vendor=normalizedModelKey(candidate.vendorHint);const product=normalizedModelKey(candidate.productHint);return sha256(`model:${candidate.signalKind}:${vendor}:${product}`);}
  if (source.type === 'web' && candidate.externalId) return sha256(`web:${source.id}:${candidate.externalId}`);
  if (candidate.url) return sha256(`url:${canonicalUrl(candidate.url)}`);
  const title=candidate.title.toLowerCase().replace(/\s+/g,' ').trim(); const summary=(candidate.summary||'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,240); return sha256(`text:${title}|${summary}`);
}
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

export async function registerDiscoveredSource(db:D1Database,source:SourceRow,candidate:Candidate,c:Classification):Promise<boolean>{
  if(source.source_tier!=='discovery'||!DISCOVERY_KINDS.has(c.kind)||c.priority==='P3'||!candidate.url)return false;
  let url:string;
  try{const parsed=new URL(candidate.url);if(!['http:','https:'].includes(parsed.protocol))return false;parsed.hash='';url=parsed.toString();}catch{return false;}
  if(canonicalUrl(url)===canonicalUrl(source.url))return false;
  const existing=await db.prepare(`SELECT id,source_tier FROM sources WHERE url=?1 LIMIT 1`).bind(url).first<{id:number;source_tier:SourceTier}>();
  const expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
  if(existing){
    if(existing.source_tier==='temporary'||existing.source_tier==='candidate')await db.prepare(`UPDATE sources SET enabled=1,expires_at=CASE WHEN expires_at IS NULL OR expires_at<?2 THEN ?2 ELSE expires_at END,updated_at=?3 WHERE id=?1`).bind(existing.id,expiresAt,isoNow()).run();
    return false;
  }
  const count=await db.prepare(`SELECT COUNT(*) AS count FROM sources WHERE enabled=1 AND source_tier IN ('temporary','candidate')`).first<{count:number}>();
  if((count?.count||0)>=100)return false;
  const label=(c.product||candidate.productHint||candidate.title).replace(/\s+/g,' ').trim().slice(0,110);
  const trust=source.trust_level==='A'?'B':source.trust_level==='B'?'B':'C';
  const config=JSON.stringify({sourceTier:'temporary',discoveredFrom:source.id,discoverySignal:c.kind});
  await db.prepare(`INSERT INTO sources(name,url,type,trust_level,enabled,interval_minutes,config_json,next_fetch_at,source_tier,discovered_from_source_id,expires_at,hit_count) VALUES(?1,?2,'web',?3,1,360,?4,CURRENT_TIMESTAMP,'temporary',?5,?6,0)`).bind(`${label} watch`,url,trust,config,source.id,expiresAt).run();
  return true;
}

export async function noteSourceValue(db:D1Database,source:SourceRow,c:Classification):Promise<void>{
  if(!['temporary','candidate'].includes(source.source_tier||'')||c.priority==='P3'||c.kind==='other')return;
  const nextHit=(source.hit_count||0)+1;
  const nextTier:SourceTier=nextHit>=3?'core':source.source_tier==='temporary'?'candidate':'candidate';
  const expiresAt=nextTier==='core'?null:new Date(Date.now()+90*24*60*60*1000).toISOString();
  await db.prepare(`UPDATE sources SET hit_count=hit_count+1,source_tier=?1,expires_at=?2,updated_at=?3 WHERE id=?4`).bind(nextTier,expiresAt,isoNow(),source.id).run();
}

export async function insertItem(db: D1Database, source: SourceRow, candidate: Candidate, c: Classification): Promise<{ inserted: boolean; id?: number }> {
  const fingerprint = await buildFingerprint(source,candidate);
  const result = await db.prepare(`INSERT OR IGNORE INTO items(source_id,external_id,fingerprint,title,summary,url,published_at,kind,priority,score,source_confidence,verification_status,vendor,product,previous_price,current_price,currency,expires_at,raw_excerpt,ai_enriched) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`).bind(source.id,candidate.externalId||null,fingerprint,candidate.title,candidate.summary||null,candidate.url||null,candidate.publishedAt||null,c.kind,c.priority,c.score,c.sourceConfidence,c.verificationStatus,c.vendor||null,c.product||null,c.previousPrice??null,c.currentPrice??null,c.currency||null,c.expiresAt||null,candidate.rawExcerpt||null,c.aiEnriched?1:0).run();
  if (!result.meta.changes) return { inserted:false }; const row = await db.prepare('SELECT id FROM items WHERE fingerprint=?1').bind(fingerprint).first<{id:number}>(); return { inserted:true,id:row?.id };
}
export async function markPushed(db: D1Database,id:number):Promise<void>{await db.prepare('UPDATE items SET pushed_at=?1 WHERE id=?2').bind(isoNow(),id).run();}
export async function getRecentItems(db:D1Database,limit=100):Promise<(ItemRow&{source_name:string;last_verified_at:string|null})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name,s.last_success_at AS last_verified_at FROM items i JOIN sources s ON s.id=i.source_id ORDER BY i.discovered_at DESC LIMIT ?1`).bind(limit).all<ItemRow&{source_name:string;last_verified_at:string|null}>();return r.results||[];}
export async function getReportItems(db:D1Database,start:string,end:string):Promise<(ItemRow&{source_name:string;last_verified_at:string|null})[]>{const r=await db.prepare(`SELECT i.*,s.name AS source_name,s.last_success_at AS last_verified_at FROM items i JOIN sources s ON s.id=i.source_id WHERE i.discovered_at>=?1 AND i.discovered_at<?2 AND i.priority IN ('P2','P3') ORDER BY CASE i.priority WHEN 'P2' THEN 1 ELSE 2 END,i.score DESC,i.discovered_at DESC`).bind(start,end).all<ItemRow&{source_name:string;last_verified_at:string|null}>();return r.results||[];}
