import type { Env, ItemRow } from './types';

function configured(env: Env): env is Env & { TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string } {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

async function sendTelegramMessage(env: Env, text: string): Promise<boolean> {
  if (!configured(env)) return false;
  const body: Record<string, unknown> = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

function h(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function subject(item: ItemRow): string {
  return [item.vendor, item.product].filter(Boolean).join(' ') || item.title;
}

function price(value: number | null, currency: string | null): string {
  return `${currency ? `${currency} ` : ''}${value ?? ''}`.trim();
}

export function isHighQualityChineseSummary(text?: string): boolean {
  if (!text) return false;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length < 8 || clean.length > 200) return false;

  // Must contain at least some Chinese characters
  const chineseCharCount = (clean.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseCharCount < 6) return false;

  // Reject suspicious instructions, prompt leakage, garbled tokens, or roleplays
  const forbiddenPatterns = [
    /请你|请给我|给我一个|不得偷|扮演|忽略之前|system\s*prompt|assistant|user:|human:/i,
    /作为一个|作为一个AI|作为AI语言模型/i,
    /国度学习模式|不得偷的学习/i,
    /```|<im_start>|<im_end>|\[INST\]|\[\/INST\]/i,
    /translation:|translated:/i,
  ];

  if (forbiddenPatterns.some((pattern) => pattern.test(clean))) {
    return false;
  }

  // Reject nonsensical repetitive characters
  if (/(.)\1{4,}/.test(clean)) return false;

  return true;
}

export function buildChineseSummary(item: ItemRow, aiSummary?: string): string {
  if (aiSummary && isHighQualityChineseSummary(aiSummary)) {
    return aiSummary.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  const name = subject(item);
  const createdDate = item.published_at ? item.published_at.slice(0, 10) : undefined;

  if (item.kind === 'free_credit') return `检测到「${name}」相关免费额度信息。建议查看原文确认可领取额度、适用对象和有效期。`;
  if (item.kind === 'limited_offer') return `检测到「${name}」限时优惠。建议查看原文确认优惠幅度、领取条件和截止时间。`;
  if (item.kind === 'price_drop') {
    if (item.previous_price != null && item.current_price != null)
      return `「${name}」价格由 ${price(item.previous_price, item.currency)} 降至 ${price(item.current_price, item.currency)}，具体适用模型和计费条件请以原文为准。`;
    return `检测到「${name}」价格下调信息，具体降幅、适用模型和生效时间请以原文为准。`;
  }
  if (item.kind === 'price_change') return `检测到「${name}」定价或计费页面发生变化，建议查看原文确认具体价格和生效时间。`;
  if (item.kind === 'new_plan') return `检测到「${name}」推出新套餐或新计划，具体价格、额度和使用限制请查看原文。`;
  if (item.kind === 'new_model') return `发现新发布模型「${name}」${createdDate ? `（发布于 ${createdDate}）` : ''}，已进入 AI-Radar 关注队列。`;
  if (item.kind === 'model_api_available') return `检测到「${name}」已出现 API 可用信号，建议查看原文确认提供方、价格、上下文和调用限制。`;
  if (item.kind === 'model_open_source') return `检测到「${name}」开源或开放权重信号，建议查看原文确认许可证、权重和使用限制。`;
  if (item.kind === 'model_benchmark') return `检测到「${name}」新增评测或榜单信号，建议结合官方资料和其他评测交叉核验。`;
  if (item.kind === 'discovered_model') {
    return `在信源中观测到模型「${name}」${createdDate ? `（创建/历史时间：${createdDate}）` : ''}，已作为信源发现记录收录，非近期新发布模型。`;
  }
  return `检测到「${name}」重要更新，已进入 AI-Radar 高优先级队列，详情请查看原文。`;
}

export async function pushP1(env: Env, item: ItemRow & { source_name?: string }, summaryZh?: string): Promise<boolean> {
  const labels: Record<string, string> = {
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
    other: '重要信息',
  };
  const lines = [
    '🔥 <b>高价值情报</b>',
    `类型：${h(labels[item.kind] || '重要信息')}`,
    '',
    `<b>${h(item.title)}</b>`,
    '',
    '📝 <b>中文摘要</b>',
    h(buildChineseSummary(item, summaryZh)),
  ];
  lines.push('', `来源：${h(item.source_name || 'unknown')}`);
  if (item.verification_status === 'official_confirmed') lines.push('核验：官方确认');
  if (item.expires_at) lines.push(`有效期：${h(item.expires_at)}`);
  if (item.url) lines.push('', `<a href="${h(item.url)}">查看原文</a>`);
  return sendTelegramMessage(env, lines.join('\n'));
}

export async function pushDailyReport(env: Env, reportDate: string, counts: { p2: number; p3: number }): Promise<boolean> {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const url = base ? `${base}/daily/${reportDate}` : '';
  const text = [
    `📋 <b>AI-Radar 日报 · ${h(reportDate)}</b>`,
    '',
    `值得关注：${counts.p2} 条`,
    `其他线索：${counts.p3} 条`,
    url ? '' : undefined,
    url ? `<a href="${h(url)}">打开今日完整日报</a>` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  return sendTelegramMessage(env, text);
}
