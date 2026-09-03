PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  signal_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','discarded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_check_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_checked_at TEXT,
  resolved_item_id INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, external_id),
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE,
  FOREIGN KEY(resolved_item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_verification_queue_due
  ON verification_queue(status, next_check_at, signal_score DESC);

CREATE TABLE IF NOT EXISTS source_link_baselines (
  source_id INTEGER PRIMARY KEY,
  initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- Model dates are publication/observation metadata, never offer expiration dates.
UPDATE items
SET expires_at = NULL
WHERE kind IN ('new_model','model_api_available','model_open_source','model_benchmark','discovered_model')
  AND expires_at IS NOT NULL;

-- Force one full generic-web fetch after deployment so existing links become a baseline
-- instead of being mistaken for newly discovered links. content_hash is deliberately kept.
UPDATE sources
SET etag = NULL,
    last_modified = NULL,
    next_fetch_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE type = 'web'
  AND (config_json IS NULL OR config_json NOT LIKE '%discoveryProvider%');
