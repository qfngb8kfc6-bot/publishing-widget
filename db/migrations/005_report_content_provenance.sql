-- Records whether a report's briefing summary came from AI or the deterministic fallback, and why it fell back.
-- Nullable so reports created before this migration stay readable.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS summary_source TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS summary_fallback_reason TEXT;
