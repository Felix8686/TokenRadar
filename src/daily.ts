import type { Env, ItemRow } from './types';
import { escapeHtml } from './utils';
import { getReportItems } from './db';
import { buildChineseSummary, pushDailyReport } from './telegram';

export function beijingWindow(now = new Date()): { reportDate: string; start: string; end: string } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const endUtc = new Date(Date.UTC(y, m, d, 4, 30, 0));
  const startUtc = new Date(endUtc.getTime() - 24 * 60 * 60 * 1000);
  const reportDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { reportDate, start: startUtc.toISOString(), end: endUtc.toISOString() };
}

function kindLabel(kind: string): string {
  return (
    ({
      free_credit: '免费额度',
      limited_offer: '限时优惠',
      price_drop: '降价',
      price_change: '价格变化',
      new_plan: '新套餐',
      new_model: '新模型',
      model_api_available: 'API 可用',
      model_open_source: '模型开源',
      model_benchmark: '模型评测',
      discovered_model: '模型发现',
      other: '其他',
    } as Record<string, string>)[kind] || '其他'
  );
}

function formatBeijing(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

function itemCard(item: ItemRow & { source_name: string; last_verified_at: string | null }): string {
  const status = item.verification_status === 'official_confirmed' ? '官方确认' : item.verification_status === 'cross_verified' ? '已交叉验证' : '未核实';
  const identity = [item.vendor, item.product].filter(Boolean).join(' · ');
  const price =
    item.current_price != null
      ? `${item.currency || ''} ${item.current_price}${item.previous_price != null ? `（原价 ${item.currency || ''} ${item.previous_price}）` : ''}`
      : '';
  const details = [
    identity ? `厂商 / 产品：${identity}` : '',
    price ? `价格：${price}` : '',
    item.expires_at ? `有效期：${item.expires_at}` : '',
    item.published_at ? `发布/收录：${formatBeijing(item.published_at)}` : '',
    `发现：${formatBeijing(item.discovered_at)}`,
    `最后核验：${formatBeijing(item.last_verified_at)}`,
  ].filter(Boolean);
  const summaryZh = buildChineseSummary(item, item.summary || undefined);
  return `<article class="card"><div class="meta"><span>${escapeHtml(kindLabel(item.kind))}</span><span>${escapeHtml(status)}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(summaryZh.slice(0, 900))}</p><ul>${details.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul><div class="foot"><span>${escapeHtml(item.source_name)}</span>${item.url ? `<a href="${escapeHtml(item.url)}" rel="noopener noreferrer" target="_blank">查看原文</a>` : ''}</div></article>`;
}

function section(title: string, items: (ItemRow & { source_name: string; last_verified_at: string | null })[], empty: string): string {
  return `<section class="section"><h2>${escapeHtml(title)}</h2>${items.length ? items.map(itemCard).join('') : `<div class="empty">${escapeHtml(empty)}</div>`}</section>`;
}

export function renderReport(reportDate: string, items: (ItemRow & { source_name: string; last_verified_at: string | null })[]): string {
  const free = items.filter((x) => x.kind === 'free_credit');
  const offers = items.filter((x) => x.kind === 'limited_offer');
  const drops = items.filter((x) => x.kind === 'price_drop' || x.kind === 'price_change');
  const models = items.filter((x) => ['new_model', 'model_api_available', 'model_open_source', 'model_benchmark', 'discovered_model'].includes(x.kind));
  const highlights = items.filter((x) => x.priority === 'P2' && x.kind === 'new_plan');
  const other = items.filter((x) => x.priority === 'P2' && x.kind === 'other');
  const categorized = new Set([...free, ...offers, ...drops, ...models, ...highlights, ...other].map((x) => x.id));
  const leads = items.filter((x) => x.priority === 'P3' && !categorized.has(x.id));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI-Radar 日报 ${escapeHtml(reportDate)}</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:860px;margin:0 auto;padding:24px;background:#f6f7f9;color:#171717}a{color:inherit}.top{margin-bottom:28px}.sub{color:#666}.section{margin:28px 0}.card{background:white;border:1px solid #e7e7e7;border-radius:14px;padding:18px;margin:12px 0}.card h3{font-size:18px;margin:10px 0}.card p{line-height:1.65;color:#333}.card ul{margin:12px 0;padding-left:20px;color:#555;font-size:13px;line-height:1.65}.meta,.foot{display:flex;justify-content:space-between;gap:12px;color:#6b7280;font-size:13px}.empty{color:#777;padding:16px 0}@media(max-width:600px){body{padding:16px}.card{padding:15px}}</style></head><body><div class="top"><h1>AI-Radar 日报</h1><div class="sub">${escapeHtml(reportDate)} · 统计窗口截至北京时间 12:30</div></div>${section('新模型与 API', models, '今天没有新增模型情报。')}${section('今日重点', highlights, '今天没有新增重点。')}${section('免费额度', free, '今天没有新增免费额度。')}${section('限时优惠', offers, '今天没有新增限时优惠。')}${section('降价与价格变化', drops, '今天没有新增价格变化。')}${section('其他值得关注', other, '今天没有其他值得关注的信息。')}${section('未核实线索', leads, '今天没有未核实线索。')}</body></html>`;
}

export async function generateDailyReport(env: Env, now = new Date()): Promise<{ reportDate: string; itemCount: number; pushed: boolean }> {
  const w = beijingWindow(now);
  const existing = await env.DB.prepare('SELECT telegram_pushed_at FROM daily_reports WHERE report_date=?1').bind(w.reportDate).first<{ telegram_pushed_at: string | null }>();
  const items = await getReportItems(env.DB, w.start, w.end);
  const html = renderReport(w.reportDate, items);
  await env.DB.prepare(
    `INSERT INTO daily_reports(report_date,window_start,window_end,item_count,html,generated_at) VALUES(?1,?2,?3,?4,?5,CURRENT_TIMESTAMP) ON CONFLICT(report_date) DO UPDATE SET window_start=excluded.window_start,window_end=excluded.window_end,item_count=excluded.item_count,html=excluded.html,generated_at=CURRENT_TIMESTAMP`
  )
    .bind(w.reportDate, w.start, w.end, items.length, html)
    .run();
  const counts = {
    p2: items.filter((x) => x.priority === 'P2').length,
    p3: items.filter((x) => x.priority === 'P3').length,
  };
  const pushed = existing?.telegram_pushed_at ? false : await pushDailyReport(env, w.reportDate, counts);
  if (pushed) await env.DB.prepare('UPDATE daily_reports SET telegram_pushed_at=CURRENT_TIMESTAMP WHERE report_date=?1').bind(w.reportDate).run();
  return { reportDate: w.reportDate, itemCount: items.length, pushed };
}

export async function getDailyReport(env: Env, date: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT html FROM daily_reports WHERE report_date=?1').bind(date).first<{ html: string }>();
  if (!row) {
    const fallback = renderReport(date, []);
    return new Response(fallback, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  return new Response(row.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

export async function getLatestReport(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT report_date FROM daily_reports ORDER BY report_date DESC LIMIT 1').first<{ report_date: string }>();
  if (!row) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE || 'Asia/Shanghai' }).format(new Date());
    return new Response(null, { status: 302, headers: { location: `/daily/${today}` } });
  }
  return new Response(null, { status: 302, headers: { location: `/daily/${row.report_date}` } });
}
