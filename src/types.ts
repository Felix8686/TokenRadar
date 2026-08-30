export interface Env {
  DB: D1Database;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_TIMEZONE: string;
  AI_ENABLED: string;
  AI_MODEL: string;
  SOURCE_BATCH_SIZE: string;
  PUBLIC_BASE_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_TOPIC_P1?: string;
  TELEGRAM_TOPIC_DAILY?: string;
  ADMIN_TOKEN?: string;
}

export type SourceType = 'rss' | 'web' | 'github' | 'x';
export type TrustLevel = 'A' | 'B' | 'C' | 'D';
export type Priority = 'P1' | 'P2' | 'P3';
export type ItemKind = 'free_credit' | 'limited_offer' | 'price_drop' | 'price_change' | 'new_plan' | 'other';

export interface SourceRow {
  id: number; name: string; url: string; type: SourceType; trust_level: TrustLevel;
  enabled: number; interval_minutes: number; config_json: string | null; etag: string | null;
  last_modified: string | null; content_hash: string | null; next_fetch_at: string | null;
  last_fetch_at: string | null; last_success_at: string | null; failure_count: number; status: string;
}

export interface Candidate {
  externalId?: string; title: string; summary?: string; url?: string; publishedAt?: string; rawExcerpt?: string;
}

export interface CollectResult {
  statusCode: number; notModified: boolean; etag?: string; lastModified?: string; contentHash?: string; candidates: Candidate[];
}

export interface Classification {
  kind: ItemKind; priority: Priority; score: number; vendor?: string; product?: string; expiresAt?: string;
  previousPrice?: number; currentPrice?: number; currency?: string;
  sourceConfidence: 'high' | 'medium' | 'low';
  verificationStatus: 'official_confirmed' | 'cross_verified' | 'unverified' | 'disputed';
  aiEnriched: boolean;
}

export interface ItemRow {
  id: number; source_id: number; title: string; summary: string | null; url: string | null;
  kind: ItemKind; priority: Priority; score: number; source_confidence: string; verification_status: string;
  vendor: string | null; product: string | null; expires_at: string | null; discovered_at: string;
  published_at: string | null; pushed_at: string | null;
}
