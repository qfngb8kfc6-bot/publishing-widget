-- One AI-written line per theme card, keyed by theme. Nullable so reports created before this migration stay
-- readable and fall back to the standard theme card text.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS theme_descriptions_json JSONB;
