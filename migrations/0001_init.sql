PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('rss','web','github','x')),
  trust_level TEXT NOT NULL DEFAULT 'C' CHECK(trust_level IN ('A','B','C','D')),
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 15,
  config_json TEXT,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT,
  next_fetch_at TEXT,
  last_fetch_at TEXT,
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sources_due ON sources(enabled, next_fetch_at);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  external_id TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  published_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind TEXT NOT NULL DEFAULT 'other',
  priority TEXT NOT NULL DEFAULT 'P3' CHECK(priority IN ('P1','P2','P3')),
  score INTEGER NOT NULL DEFAULT 0,
  source_confidence TEXT NOT NULL DEFAULT 'low',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  vendor TEXT,
  product TEXT,
  previous_price REAL,
  current_price REAL,
  currency TEXT,
  expires_at TEXT,
  raw_excerpt TEXT,
  ai_enriched INTEGER NOT NULL DEFAULT 0,
  pushed_at TEXT,
  daily_report_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_discovered ON items(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_priority ON items(priority, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_report ON items(daily_report_date, priority);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  vendor TEXT,
  product TEXT,
  price REAL NOT NULL,
  currency TEXT,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_reports (
  report_date TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  html TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  telegram_pushed_at TEXT
);

CREATE TABLE IF NOT EXISTS fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_code INTEGER,
  changed INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_source ON fetch_logs(source_id, fetched_at DESC);
