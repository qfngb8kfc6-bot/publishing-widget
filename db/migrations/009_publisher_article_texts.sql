-- Full-text enrichment (e.g. SGI via the WVC API). Cleaned plain text only (HTML stripped, entities decoded,
-- whitespace collapsed, capped at about 20,000 characters), keyed by the publisher's numeric story code (the id
-- before ".article" in the article URL). The text is used server-side for matching and AI grounding only: it is
-- never returned by any public endpoint, written to catalogue snapshots, analytics or logs.
CREATE TABLE IF NOT EXISTS publisher_article_texts (
  publisher_id TEXT NOT NULL,
  story_code TEXT NOT NULL,
  plain_text TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  last_modified TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (publisher_id, story_code)
);

-- One row per enriched publisher: resumable backfill position and the latest sync outcome (safe codes only).
CREATE TABLE IF NOT EXISTS publisher_text_sync_state (
  publisher_id TEXT PRIMARY KEY,
  backfill_last_page INTEGER NOT NULL DEFAULT 0,
  backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
  total_pages INTEGER,
  total_records INTEGER,
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
