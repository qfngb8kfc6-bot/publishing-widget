import type { WvcStory } from '../publishers/content';

/**
 * Full-text enrichment store (migration 009). Body text lives only here, in Postgres: never in the catalogue,
 * its snapshot or public report JSON. Callers read short leads (matching ~1,500 chars, AI ~800 chars) for the
 * articles they need, never the whole table.
 */
export interface ArticleLead {
  storyCode: string;
  lead: string;
  isPrivate: boolean;
}

export interface TextSyncState {
  backfillLastPage: number;
  backfillComplete: boolean;
  totalPages?: number;
  totalRecords?: number;
  lastSyncAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  lastErrorAt?: string;
}

export interface ArticleTextStore {
  /** Inserts new stories and updates those whose LASTMODIFIED is newer. Returns the story codes written. */
  upsert(publisherId: string, stories: readonly WvcStory[], fetchedAt: string): Promise<string[]>;
  /** One query for a known set of articles (the report's selected articles). */
  leads(publisherId: string, storyCodes: readonly string[], maxChars: number): Promise<ArticleLead[]>;
  /** Keyset-paged leads in story-code order, for building match indexes in bounded batches. */
  leadPage(publisherId: string, afterStoryCode: string, limit: number, maxChars: number): Promise<ArticleLead[]>;
  count(publisherId: string): Promise<number>;
  syncState(publisherId: string): Promise<TextSyncState | null>;
  saveSyncState(publisherId: string, state: TextSyncState): Promise<void>;
}

/** The first `maxChars` characters, cut back to a word boundary. */
export function leadExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return text.slice(0, cut > maxChars * 0.7 ? cut : maxChars);
}

interface StoredText { text: string; isPrivate: boolean; lastModified?: string }

export class MemoryArticleTextStore implements ArticleTextStore {
  private readonly texts = new Map<string, Map<string, StoredText>>();
  private readonly states = new Map<string, TextSyncState>();

  private publisher(publisherId: string): Map<string, StoredText> {
    let texts = this.texts.get(publisherId);
    if (!texts) { texts = new Map(); this.texts.set(publisherId, texts); }
    return texts;
  }

  async upsert(publisherId: string, stories: readonly WvcStory[], _fetchedAt?: string): Promise<string[]> {
    const texts = this.publisher(publisherId);
    const written: string[] = [];
    for (const story of stories) {
      const existing = texts.get(story.storyCode);
      if (existing && existing.lastModified && story.lastModified && Date.parse(story.lastModified) <= Date.parse(existing.lastModified)) continue;
      texts.set(story.storyCode, { text: story.text, isPrivate: story.isPrivate, lastModified: story.lastModified });
      written.push(story.storyCode);
    }
    return written;
  }

  async leads(publisherId: string, storyCodes: readonly string[], maxChars: number): Promise<ArticleLead[]> {
    const texts = this.publisher(publisherId);
    return [...new Set(storyCodes)].flatMap((storyCode) => {
      const stored = texts.get(storyCode);
      return stored ? [{ storyCode, lead: leadExcerpt(stored.text, maxChars), isPrivate: stored.isPrivate }] : [];
    });
  }

  async leadPage(publisherId: string, afterStoryCode: string, limit: number, maxChars: number): Promise<ArticleLead[]> {
    const texts = this.publisher(publisherId);
    return [...texts.keys()].filter((code) => code > afterStoryCode).sort().slice(0, limit).map((storyCode) => ({ storyCode, lead: leadExcerpt(texts.get(storyCode)!.text, maxChars), isPrivate: texts.get(storyCode)!.isPrivate }));
  }

  async count(publisherId: string): Promise<number> {
    return this.publisher(publisherId).size;
  }

  async syncState(publisherId: string): Promise<TextSyncState | null> {
    const state = this.states.get(publisherId);
    return state ? { ...state } : null;
  }

  async saveSyncState(publisherId: string, state: TextSyncState): Promise<void> {
    this.states.set(publisherId, { ...state });
  }
}

export interface ArticleTextSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

const isoOrUndefined = (value: unknown): string | undefined => (value === null || value === undefined ? undefined : new Date(String(value)).toISOString());

export class PostgresArticleTextStore implements ArticleTextStore {
  constructor(private readonly client: ArticleTextSqlClient) {}

  async upsert(publisherId: string, stories: readonly WvcStory[], fetchedAt: string): Promise<string[]> {
    if (!stories.length) return [];
    // A page can repeat a story code; keep the last occurrence so one statement never updates a row twice.
    const unique = [...new Map(stories.map((story) => [story.storyCode, story])).values()];
    const result = await this.client.query<{ story_code: string }>(
      `INSERT INTO publisher_article_texts (publisher_id, story_code, plain_text, text_length, is_private, last_modified, fetched_at)
       SELECT $1, story_code, plain_text, char_length(plain_text), is_private, last_modified, $6::timestamptz
       FROM unnest($2::text[], $3::text[], $4::boolean[], $5::timestamptz[]) AS input(story_code, plain_text, is_private, last_modified)
       ON CONFLICT (publisher_id, story_code) DO UPDATE SET plain_text = EXCLUDED.plain_text, text_length = EXCLUDED.text_length, is_private = EXCLUDED.is_private, last_modified = EXCLUDED.last_modified, fetched_at = EXCLUDED.fetched_at
       WHERE EXCLUDED.last_modified IS NULL OR publisher_article_texts.last_modified IS NULL OR EXCLUDED.last_modified > publisher_article_texts.last_modified
       RETURNING story_code`,
      [publisherId, unique.map((story) => story.storyCode), unique.map((story) => story.text), unique.map((story) => story.isPrivate), unique.map((story) => story.lastModified ?? null), fetchedAt],
    );
    return result.rows.map((row) => String(row.story_code));
  }

  async leads(publisherId: string, storyCodes: readonly string[], maxChars: number): Promise<ArticleLead[]> {
    const codes = [...new Set(storyCodes)];
    if (!codes.length) return [];
    const result = await this.client.query<{ story_code: string; lead: string; is_private: boolean }>(
      'SELECT story_code, left(plain_text, $3) AS lead, is_private FROM publisher_article_texts WHERE publisher_id = $1 AND story_code = ANY($2::text[])',
      [publisherId, codes, maxChars + 40],
    );
    return result.rows.map((row) => ({ storyCode: String(row.story_code), lead: leadExcerpt(String(row.lead), maxChars), isPrivate: row.is_private === true }));
  }

  async leadPage(publisherId: string, afterStoryCode: string, limit: number, maxChars: number): Promise<ArticleLead[]> {
    const result = await this.client.query<{ story_code: string; lead: string; is_private: boolean }>(
      'SELECT story_code, left(plain_text, $4) AS lead, is_private FROM publisher_article_texts WHERE publisher_id = $1 AND story_code > $2 ORDER BY story_code LIMIT $3',
      [publisherId, afterStoryCode, limit, maxChars + 40],
    );
    return result.rows.map((row) => ({ storyCode: String(row.story_code), lead: leadExcerpt(String(row.lead), maxChars), isPrivate: row.is_private === true }));
  }

  async count(publisherId: string): Promise<number> {
    const result = await this.client.query<{ count: string | number }>('SELECT count(*) AS count FROM publisher_article_texts WHERE publisher_id = $1', [publisherId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async syncState(publisherId: string): Promise<TextSyncState | null> {
    const row = (await this.client.query<Record<string, unknown>>('SELECT * FROM publisher_text_sync_state WHERE publisher_id = $1', [publisherId])).rows[0];
    if (!row) return null;
    return {
      backfillLastPage: Number(row.backfill_last_page ?? 0),
      backfillComplete: row.backfill_complete === true,
      ...(row.total_pages !== null && row.total_pages !== undefined ? { totalPages: Number(row.total_pages) } : {}),
      ...(row.total_records !== null && row.total_records !== undefined ? { totalRecords: Number(row.total_records) } : {}),
      lastSyncAt: isoOrUndefined(row.last_sync_at),
      lastSuccessAt: isoOrUndefined(row.last_success_at),
      lastErrorCode: row.last_error_code ? String(row.last_error_code) : undefined,
      lastErrorAt: isoOrUndefined(row.last_error_at),
    };
  }

  async saveSyncState(publisherId: string, state: TextSyncState): Promise<void> {
    await this.client.query(
      `INSERT INTO publisher_text_sync_state (publisher_id, backfill_last_page, backfill_complete, total_pages, total_records, last_sync_at, last_success_at, last_error_code, last_error_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (publisher_id) DO UPDATE SET backfill_last_page = EXCLUDED.backfill_last_page, backfill_complete = EXCLUDED.backfill_complete, total_pages = EXCLUDED.total_pages, total_records = EXCLUDED.total_records, last_sync_at = EXCLUDED.last_sync_at, last_success_at = EXCLUDED.last_success_at, last_error_code = EXCLUDED.last_error_code, last_error_at = EXCLUDED.last_error_at, updated_at = NOW()`,
      [publisherId, state.backfillLastPage, state.backfillComplete, state.totalPages ?? null, state.totalRecords ?? null, state.lastSyncAt ?? null, state.lastSuccessAt ?? null, state.lastErrorCode ?? null, state.lastErrorAt ?? null],
    );
  }
}
