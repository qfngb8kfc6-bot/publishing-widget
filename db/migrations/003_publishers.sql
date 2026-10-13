CREATE TABLE IF NOT EXISTS publishers (
  publisher_id TEXT PRIMARY KEY,
  manifest_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS publishers_updated_idx ON publishers (updated_at DESC);
