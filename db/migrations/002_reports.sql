CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  company_url TEXT NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  job_title TEXT NOT NULL,
  professional_profile_json JSONB NOT NULL,
  retrieval_context_json JSONB NOT NULL,
  overall_match_score INTEGER NOT NULL,
  generated_summary TEXT NOT NULL,
  generation_version TEXT NOT NULL,
  ranking_version TEXT NOT NULL,
  professional_profile_version TEXT NOT NULL,
  ai_provider_version TEXT NOT NULL,
  publisher_config_version TEXT NOT NULL,
  widget_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_publisher_created_idx ON reports (publisher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_company_domain_idx ON reports (company_domain);

CREATE TABLE IF NOT EXISTS report_recommendations (
  id BIGSERIAL PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  raw_score NUMERIC NOT NULL,
  display_score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  article_json JSONB NOT NULL,
  ranking_metadata_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS report_recommendations_report_rank_idx ON report_recommendations (report_id, rank);
