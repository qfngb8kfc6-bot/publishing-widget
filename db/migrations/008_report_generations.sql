-- Asynchronous report generation status (POST /api/reports/generate returns 202 and the loading page polls).
-- One row per generation, upserted at each stage. details_json holds only safe display fields (company display
-- name, job title, up to 6 role themes, articles searched); never scores, prompts or AI text. input_json keeps the
-- submitted company, job title and analytics session so a failed generation can be retried server-side; it is
-- never returned by the status endpoint. Rows older than a day are pruned by the application.
CREATE TABLE IF NOT EXISTS report_generations (
  id TEXT PRIMARY KEY,
  publisher_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  completed_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_id TEXT,
  error_code TEXT,
  instance_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  input_json JSONB
);
CREATE INDEX IF NOT EXISTS report_generations_created_at_idx ON report_generations (created_at);
