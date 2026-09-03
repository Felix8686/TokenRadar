import type { Candidate, Env, ItemRow, SourceRow, SourceTier } from './types';
import { collectSource } from './collectors';
import { classifyDeterministically, maybeEnrichWithAi } from './rules';
import { enqueueVerification, expireTemporarySources, filterNewCandidates, getDueSources, getRecentItems, hasLinkBaseline, insertItem, markLinkBaseline, markPushed, noteSourceValue, registerDiscoveredSource, rememberSourceEntries, rememberSourceEntry, saveFetchFailure, saveFetchSuccess } from './db';
import { generateDailyReport, getDailyReport, getLatestReport } from './daily';
import { pushP1 } from './telegram';
import { directP1Allowed, needsVerification, processVerificationQueue, verificationSignalScore } from './verification';
import { jsonResponse } from './utils';

async function establishLinkBaseline(env:Env,source:SourceRow,candidates:Candidate[]):Promise<Candidate[]>{
  const links=candidates.filter(candidate=>candidate.observationKind==='linked_page');
  if(!links.length)return candidates;
  if(await hasLinkBaseline(env.DB,source.id))return candidates;
  await rememberSourceEntries(env.DB,source,links);
  await markLinkBaseline(env.DB,source.id);
  return candidates.filter(candidate=>candidate.observationKind!=='linked_page');
}

async function processSource(env:Env,source:SourceRow):Promise<void>{
  const started=Date.now();
  try{
    const result=await collectSource(source);
    const candidatesForRun=result.notModified?result.candidates:await establishLinkBaseline(env,source,result.candidates);
    const changed=!result.notModified&&Boolean(result.contentHash&&result.contentHash!==source.content_hash);
    const isBootstrap=!source.content_hash;
    if(!result.notModified&&changed){
      if(isBootstrap){
        await rememberSourceEntries(env.DB,source,candidatesForRun);
      }else{
        const candidates=await filterNewCandidates(env.DB,source,candidatesForRun);
        const hasNewLinkedPage=candidates.some(candidate=>candidate.observationKind==='linked_page');
        for(const candidate of candidates){
          const deterministic=classifyDeterministically(source,candidate);

          // If a listing page changed because it contains a newly observed content link,
          // verify that exact linked page instead of pushing the generic "xxx changed" observation.
          if(candidate.observationKind==='page_change'&&hasNewLinkedPage){
            await rememberSourceEntry(env.DB,source,candidate);
            continue;
          }

          if(needsVerification(source,candidate,deterministic)){
            await enqueueVerification(env.DB,source,candidate,candidate.observationKind||deterministic.kind,verificationSignalScore(source,candidate));
            await rememberSourceEntry(env.DB,source,candidate);
            continue;
          }

          // A plain catalog observation is internal low-confidence data. It can be retained as P3,
          // but it is never allowed to become an immediate high-value alert without verification.
          const c=deterministic.kind==='discovered_model'
            ? {...deterministic,score:Math.min(39,deterministic.score),priority:'P3' as const}
            : await maybeEnrichWithAi(env,source,candidate,deterministic);
          const saved=await insertItem(env.DB,source,candidate,c);
          await rememberSourceEntry(env.DB,source,candidate);
          if(!saved.inserted||!saved.id)continue;
          await registerDiscoveredSource(env.DB,source,candidate,c);
          await noteSourceValue(env.DB,source,c);
          if(directP1Allowed(candidate,c)){
            const item:ItemRow&{source_name:string}={id:saved.id,source_id:source.id,title:candidate.title,summary:candidate.summary||null,url:candidate.url||null,kind:c.kind,priority:c.priority,score:c.score,source_confidence:c.sourceConfidence,verification_status:c.verificationStatus,vendor:c.vendor||null,product:c.product||null,previous_price:c.previousPrice??null,current_price:c.currentPrice??null,currency:c.currency||null,expires_at:c.expiresAt||null,discovered_at:new Date().toISOString(),published_at:candidate.publishedAt||null,pushed_at:null,source_name:source.name};
            if(await pushP1(env,item,c.summaryZh))await markPushed(env.DB,saved.id);
          }
        }
      }
    }
    await saveFetchSuccess(env.DB,source,{etag:result.etag,lastModified:result.lastModified,contentHash:result.contentHash||source.content_hash||undefined,statusCode:result.statusCode,changed,durationMs:Date.now()-started});
  }catch(error){
    await saveFetchFailure(env.DB,source,error,Date.now()-started);
  }
}

async function harvest(env:Env):Promise<{processed:number;verificationProcessed:number;verificationVerified:number}>{
  await expireTemporarySources(env.DB);
  const limit=Math.max(1,Math.min(50,Number(env.SOURCE_BATCH_SIZE||10)));
  const sources=await getDueSources(env.DB,limit);
  for(const source of sources)await processSource(env,source);
  const verification=await processVerificationQueue(env,5);
  return{processed:sources.length,verificationProcessed:verification.processed,verificationVerified:verification.verified};
}

function isAdmin(request:Request,env:Env):boolean{if(!env.ADMIN_TOKEN)return false;return request.headers.get('authorization')===`Bearer ${env.ADMIN_TOKEN}`;}
export function toPublicItem(row:ItemRow&{source_name:string;last_verified_at:string|null}){return{id:row.id,title:row.title,summary:row.summary,url:row.url,kind:row.kind,vendor:row.vendor,product:row.product,previous_price:row.previous_price,current_price:row.current_price,currency:row.currency,expires_at:row.expires_at,discovered_at:row.discovered_at,published_at:row.published_at,source_name:row.source_name,verification_status:row.verification_status,last_verified_at:row.last_verified_at};}
async function listSources(env:Env):Promise<Response>{const rows=await env.DB.prepare(`SELECT id,name,url,type,trust_level,enabled,interval_minutes,source_tier,discovered_from_source_id,expires_at,hit_count,next_fetch_at,last_fetch_at,last_success_at,failure_count,status FROM sources ORDER BY id DESC`).all();return jsonResponse(rows.results||[]);}
async function createSource(request:Request,env:Env):Promise<Response>{const body=(await request.json())as Record<string,unknown>;const name=String(body.name||'').trim(),url=String(body.url||'').trim(),type=String(body.type||'web'),trust=String(body.trust_level||'C'),interval=Math.max(5,Math.min(1440,Number(body.interval_minutes||15))),tier=String(body.source_tier||'core') as SourceTier;if(!name||!url||!['rss','web','github','x'].includes(type)||!['A','B','C','D'].includes(trust)||!['core','discovery','temporary','candidate'].includes(tier))return jsonResponse({error:'invalid source payload'},400);const config=body.config&&typeof body.config==='object'?JSON.stringify(body.config):null;const expiresAt=typeof body.expires_at==='string'?body.expires_at:null;const result=await env.DB.prepare(`INSERT INTO sources(name,url,type,trust_level,interval_minutes,config_json,next_fetch_at,source_tier,expires_at) VALUES(?1,?2,?3,?4,?5,?6,CURRENT_TIMESTAMP,?7,?8)`).bind(name,url,type,trust,interval,config,tier,expiresAt).run();return jsonResponse({ok:true,id:result.meta.last_row_id},201);}
async function testTelegramP1(env:Env):Promise<Response>{const now=new Date().toISOString();const item:ItemRow&{source_name:string}={id:0,source_id:0,title:'AI-Radar P1 端到端测试',summary:'这是一条由 Cloudflare Worker 发出的上线验收消息。',url:env.PUBLIC_BASE_URL||null,kind:'limited_offer',priority:'P1',score:100,source_confidence:'high',verification_status:'official_confirmed',vendor:'AI-Radar',product:'Telegram 通知链路',previous_price:null,current_price:null,currency:null,expires_at:null,discovered_at:now,published_at:now,pushed_at:null,source_name:'AI-Radar 系统验收'};const sent=await pushP1(env,item,'这是一条 AI-Radar 中文摘要链路测试，用于确认专用 Bot 可以正常发送结构化中文情报。');return jsonResponse({ok:sent,channel:'telegram_single_group'},sent?200:502);}
async function handleApi(request:Request,env:Env,url:URL):Promise<Response>{if(url.pathname==='/api/health')return jsonResponse({ok:true,app:env.APP_NAME||'AI-Radar',time:new Date().toISOString()});if(url.pathname==='/api/items'&&request.method==='GET'){const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit')||100)));const rows=await getRecentItems(env.DB,limit);return jsonResponse(rows.map(toPublicItem));}if(url.pathname==='/api/admin/sources'){if(!isAdmin(request,env))return jsonResponse({error:'unauthorized'},401);if(request.method==='GET')return listSources(env);if(request.method==='POST')return createSource(request,env);return jsonResponse({error:'method not allowed'},405);}if(url.pathname==='/api/admin/test-telegram-p1'&&request.method==='POST'){if(!isAdmin(request,env))return jsonResponse({error:'unauthorized'},401);return testTelegramP1(env);}if(url.pathname==='/api/admin/run-harvest'&&request.method==='POST'){if(!isAdmin(request,env))return jsonResponse({error:'unauthorized'},401);return jsonResponse(await harvest(env));}if(url.pathname==='/api/admin/run-daily'&&request.method==='POST'){if(!isAdmin(request,env))return jsonResponse({error:'unauthorized'},401);return jsonResponse(await generateDailyReport(env));}return jsonResponse({error:'not found'},404);}
export default{async fetch(request:Request,env:Env):Promise<Response>{const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return handleApi(request,env,url);if(url.pathname.startsWith('/daily/')){const date=url.pathname.split('/').filter(Boolean)[1];if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return new Response('Bad date',{status:400});return getDailyReport(env,date);}if(url.pathname==='/latest')return getLatestReport(env);return env.ASSETS.fetch(request);},async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void>{if(controller.cron==='30 4 * * *'){ctx.waitUntil(generateDailyReport(env));return;}ctx.waitUntil(harvest(env));}} satisfies ExportedHandler<Env>;
