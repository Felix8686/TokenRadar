CREATE TABLE IF NOT EXISTS source_entries (
  source_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, external_id),
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_entries_seen ON source_entries(first_seen_at);

UPDATE sources
SET enabled = 0,
    status = 'disabled',
    updated_at = CURRENT_TIMESTAMP
WHERE url = 'https://github.com/cheahjs/free-llm-api-resources';
