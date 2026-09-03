export interface Env {
  DB: D1Database;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_TIMEZONE: string;
  AI_ENABLED: string;
  AI_MODEL: string;
  AI_DAILY_CALL_LIMIT: string;
  SOURCE_BATCH_SIZE: string;
  PUBLIC_BASE_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ADMIN_TOKEN?: string;
}

export type SourceType = 'rss' | 'web' | 'github' | 'x';
export type SourceTier = 'core' | 'discovery' | 'temporary' | 'candidate';
export type DiscoveryProvider = 'openrouter_models' | 'huggingface_models' | 'artificial_analysis_models';
export type TrustLevel = 'A' | 'B' | 'C' | 'D';
export type Priority = 'P1' | 'P2' | 'P3';
export type ObservationKind = 'page_change' | 'linked_page';
export type VerificationQueueStatus = 'pending' | 'verified' | 'discarded';
export type ItemKind =
  | 'free_credit'
  | 'limited_offer'
  | 'price_drop'
  | 'price_change'
  | 'new_plan'
  | 'new_model'
  | 'model_api_available'
  | 'model_open_source'
  | 'model_benchmark'
  | 'discovered_model'
  | 'other';

export interface SourceConfig {
  userAgent?: string;
  selectorHint?: string;
  githubMode?: 'commits' | 'releases';
  githubOwner?: string;
  githubRepo?: string;
  githubBranch?: string;
  discoveryProvider?: DiscoveryProvider;
  sourceTier?: SourceTier;
  discoveredFrom?: number;
  discoverySignal?: ItemKind;
}

export interface SourceRow {
  id: number; name: string; url: string; type: SourceType; trust_level: TrustLevel;
  enabled: number; interval_minutes: number; config_json: string | null; etag: string | null;
  last_modified: string | null; content_hash: string | null; next_fetch_at: string | null;
  last_fetch_at: string | null; last_success_at: string | null; failure_count: number; status: string;
  source_tier?: SourceTier; discovered_from_source_id?: number | null; expires_at?: string | null; hit_count?: number;
}

export interface Candidate {
  externalId?: string; title: string; summary?: string; url?: string; publishedAt?: string; rawExcerpt?: string;
  signalKind?: Extract<ItemKind, 'new_model' | 'model_api_available' | 'model_open_source' | 'model_benchmark' | 'discovered_model'>;
  vendorHint?: string; productHint?: string;
  observationKind?: ObservationKind;
}

export interface CollectResult {
  statusCode: number; notModified: boolean; etag?: string; lastModified?: string; contentHash?: string; candidates: Candidate[];
}

export interface Classification {
  kind: ItemKind; priority: Priority; score: number; vendor?: string; product?: string; expiresAt?: string;
  previousPrice?: number; currentPrice?: number; currency?: string; summaryZh?: string;
  sourceConfidence: 'high' | 'medium' | 'low';
  verificationStatus: 'official_confirmed' | 'cross_verified' | 'unverified' | 'disputed';
  aiEnriched: boolean;
}

export interface VerificationQueueRow {
  id: number;
  source_id: number;
  external_id: string;
  candidate_json: string;
  reason: string;
  signal_score: number;
  status: VerificationQueueStatus;
  attempts: number;
  first_seen_at: string;
  next_check_at: string;
  expires_at: string;
  last_checked_at: string | null;
  resolved_item_id: number | null;
  last_error: string | null;
}

export interface ItemRow {
  id: number; source_id: number; title: string; summary: string | null; url: string | null;
  kind: ItemKind; priority: Priority; score: number; source_confidence: string; verification_status: string;
  vendor: string | null; product: string | null; previous_price: number | null; current_price: number | null; currency: string | null; expires_at: string | null; discovered_at: string;
  published_at: string | null; pushed_at: string | null;
}
