-- Anonymous briefing feedback: a thumbs up or down on a whole report (article_id NULL) or on one of its stories.
-- Only the report ID, article ID, vote and time are stored: no session, IP address, user agent or other personal
-- data. Rows are removed with their report by the retention cleanup.
CREATE TABLE IF NOT EXISTS report_feedback (
  id BIGSERIAL PRIMARY KEY,
  publisher_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  article_id TEXT,
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_feedback_publisher_idx ON report_feedback (publisher_id, created_at);
CREATE INDEX IF NOT EXISTS report_feedback_report_idx ON report_feedback (report_id);
