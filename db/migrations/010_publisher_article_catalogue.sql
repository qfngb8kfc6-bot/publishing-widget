-- WVC API as a catalogue source: the fields a catalogue entry needs, next to the stored text. Filled only for
-- publishers whose content source is the WVC API ("wvc"); enrichment-only publishers (SGI: RSS + WVC full text)
-- leave them NULL and keep building their catalogue from the feed. The description is the story's first one or two
-- sentences (at most ~300 characters); the full text stays in plain_text, server-side only.
ALTER TABLE publisher_article_texts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE publisher_article_texts ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE publisher_article_texts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE publisher_article_texts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE publisher_article_texts ADD COLUMN IF NOT EXISTS image_url TEXT;
