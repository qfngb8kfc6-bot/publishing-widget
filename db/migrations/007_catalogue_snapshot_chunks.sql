-- Catalogue snapshots are stored as compact chunks of articles instead of one multi-megabyte JSON value, so
-- writing or reading a snapshot never holds the whole catalogue as a single string. The header row in
-- publisher_catalogue_snapshots keeps source_key, item_count and refreshed_at; chunk_count NULL marks a
-- snapshot written before this migration (read once, then replaced by chunks on the next save).
ALTER TABLE publisher_catalogue_snapshots ADD COLUMN IF NOT EXISTS chunk_count INTEGER;

CREATE TABLE IF NOT EXISTS publisher_catalogue_snapshot_chunks (
  publisher_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  articles_json JSONB NOT NULL,
  PRIMARY KEY (publisher_id, chunk_index)
);
