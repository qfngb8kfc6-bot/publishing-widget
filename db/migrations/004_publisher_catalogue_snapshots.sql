CREATE TABLE IF NOT EXISTS publisher_catalogue_snapshots (
  publisher_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  articles_json JSONB NOT NULL,
  item_count INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS publisher_catalogue_snapshots_refreshed_idx ON publisher_catalogue_snapshots (refreshed_at DESC);
