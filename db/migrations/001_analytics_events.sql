CREATE TABLE IF NOT EXISTS analytics_events (
  event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  session_id TEXT NOT NULL,
  widget_version TEXT,
  publisher_config_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_publisher_time_idx ON analytics_events (publisher_id, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_publisher_event_idx ON analytics_events (publisher_id, event_name);
CREATE INDEX IF NOT EXISTS analytics_events_publisher_article_idx ON analytics_events (publisher_id, ((metadata->>'articleId')));

-- Raw event retention and derived aggregate retention can be configured independently later.
