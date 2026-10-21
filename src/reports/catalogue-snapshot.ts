import { mapInSlices, type ArticleProvenance, type NormalizedArticle } from '../core';

export interface CatalogueSnapshot {
  publisherId: string;
  sourceKey: string;
  articles: NormalizedArticle[];
  refreshedAt: string;
  /** 'legacy': stored in the pre-chunking single-row format, so it should be rewritten on the next refresh. */
  format?: 'legacy';
}

export interface CatalogueSnapshotStore {
  get(publisherId: string, sourceKey: string): Promise<CatalogueSnapshot | null>;
  save(snapshot: CatalogueSnapshot): Promise<void>;
}

export interface CatalogueSnapshotSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  /** Present on a pg Pool: checks out one connection so a save can run as a single transaction. */
  connect?(): Promise<CatalogueSnapshotSqlConnection>;
}

export interface CatalogueSnapshotSqlConnection {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  release(error?: Error | boolean): void;
}

export class MemoryCatalogueSnapshotStore implements CatalogueSnapshotStore {
  private readonly snapshots = new Map<string, CatalogueSnapshot>();

  async get(publisherId: string, sourceKey: string): Promise<CatalogueSnapshot | null> {
    const snapshot = this.snapshots.get(publisherId);
    if (!snapshot || snapshot.sourceKey !== sourceKey) return null;
    return structuredClone(snapshot);
  }

  async save(snapshot: CatalogueSnapshot): Promise<void> {
    this.snapshots.set(snapshot.publisherId, structuredClone(snapshot));
  }
}

/**
 * Source-key prefix of a chunked snapshot's header row. Code from before chunking looks up the plain source key,
 * so after a rollback it finds no snapshot and loads the feed, instead of reading the header's empty article
 * list as an empty catalogue.
 */
const CHUNKED_KEY_PREFIX = 'chunks-v1:';

/** Articles per stored chunk: each chunk's JSON is a few hundred kilobytes, never the whole catalogue. */
export const SNAPSHOT_CHUNK_SIZE = 500;

type ArticleKey = keyof NormalizedArticle;
type ProvenanceKey = keyof ArticleProvenance;

/** Fields that commonly repeat another field's value. An alias stores only the name of the field it equals. */
const ALIASABLE_FIELDS: ArticleKey[] = ['externalId', 'canonicalUrl', 'contentSnippet', 'excerpt', 'summary', 'body'];
/** Always stored as is, so an alias can point at them. An aliasable field may also point at an earlier one. */
const BASE_FIELDS: ArticleKey[] = ['id', 'url', 'description', 'title'];
const PROVENANCE_ALIAS_TARGETS: ArticleKey[] = ['id', 'externalId', 'url', 'canonicalUrl'];
/** Fields usually identical for every article of one source, stored once per chunk when they are. */
const SHARED_FIELDS: ArticleKey[] = ['publisherId', 'sourceType', 'sourceName', 'language'];

/** One stored chunk. Decoding it restores articles equal to the ones encoded. */
export interface SnapshotChunk {
  v: 1;
  /** Article fields with the same value on every article of the chunk. */
  shared: Partial<Record<ArticleKey, unknown>>;
  /** Provenance fields with the same value on every article of the chunk. */
  sharedProvenance: Partial<Record<ProvenanceKey, unknown>>;
  articles: EncodedArticle[];
}

type EncodedArticle = Record<string, unknown> & {
  /** field → the field it equals. */
  $alias?: Record<string, string>;
  /** searchText is omitted because it equals the normalizer's join of the article's own fields. */
  $searchText?: 1;
  provenance?: Record<string, unknown> & { $alias?: Record<string, string> };
};

/** The normalizer's searchText: title, text fields, author, categories and tags, joined. */
function derivedSearchText(article: NormalizedArticle): string {
  return [article.title, article.description, article.summary, article.contentSnippet, article.body, article.author, ...article.categories, ...article.tags].filter(Boolean).join(' ');
}

function sharedValues<T extends object>(items: T[], keys: Array<keyof T>): Partial<Record<keyof T, unknown>> {
  const shared: Partial<Record<keyof T, unknown>> = {};
  for (const key of keys) {
    const first = items[0]?.[key];
    if (first !== undefined && typeof first !== 'object' && items.every((item) => Object.prototype.hasOwnProperty.call(item, key) && item[key] === first)) shared[key] = first;
  }
  return shared;
}

/**
 * Encodes a chunk of articles without repeating values: aliases for fields equal to another field, values
 * shared by the whole chunk stored once, and searchText dropped when it can be recomputed exactly. Every
 * rule applies only on strict equality, so decoding gives back equal articles.
 */
export function encodeSnapshotChunk(articles: readonly NormalizedArticle[]): SnapshotChunk {
  const json = articles.map((article) => JSON.parse(JSON.stringify(article)) as NormalizedArticle);
  const shared = sharedValues(json, SHARED_FIELDS);
  const provenances = json.map((article) => article.provenance).filter((value): value is ArticleProvenance => Boolean(value));
  const provenanceKeys = [...new Set(provenances.flatMap((value) => Object.keys(value)))] as ProvenanceKey[];
  const sharedProvenance = provenances.length === json.length ? sharedValues(provenances, provenanceKeys) : {};
  return {
    v: 1,
    shared,
    sharedProvenance,
    articles: json.map((article) => {
      const encoded: EncodedArticle = { ...article } as EncodedArticle;
      for (const key of Object.keys(shared)) delete encoded[key];
      const alias: Record<string, string> = {};
      ALIASABLE_FIELDS.forEach((field, position) => {
        const value = article[field];
        if (typeof value !== 'string') return;
        const target = [...BASE_FIELDS, ...ALIASABLE_FIELDS.slice(0, position)].find((candidate) => article[candidate] === value);
        if (target) { alias[field] = target; delete encoded[field]; }
      });
      if (Object.keys(alias).length) encoded.$alias = alias;
      if (typeof article.searchText === 'string' && article.searchText === derivedSearchText(article)) { delete encoded.searchText; encoded.$searchText = 1; }
      if (article.provenance) {
        const provenance: Record<string, unknown> & { $alias?: Record<string, string> } = { ...article.provenance };
        for (const key of Object.keys(sharedProvenance)) delete provenance[key];
        const provenanceAlias: Record<string, string> = {};
        for (const [key, value] of Object.entries(article.provenance)) {
          if (key in sharedProvenance || typeof value !== 'string') continue;
          const target = PROVENANCE_ALIAS_TARGETS.find((candidate) => article[candidate] === value);
          if (target) { provenanceAlias[key] = target; delete provenance[key]; }
        }
        if (Object.keys(provenanceAlias).length) provenance.$alias = provenanceAlias;
        encoded.provenance = provenance;
      }
      return encoded;
    }),
  };
}

/** Restores a chunk's articles. Aliased and shared values become references to one string, not copies. */
export function decodeSnapshotChunk(chunk: SnapshotChunk): NormalizedArticle[] {
  return chunk.articles.map((encoded) => {
    const { $alias, $searchText, provenance, ...fields } = encoded;
    const article = { ...chunk.shared, ...fields } as unknown as NormalizedArticle & Record<string, unknown>;
    // Resolved in encoding order, so an alias may point at an earlier field that was itself aliased.
    for (const field of ALIASABLE_FIELDS) if ($alias?.[field]) (article as Record<string, unknown>)[field] = article[$alias[field] as ArticleKey];
    if ($searchText) article.searchText = derivedSearchText(article);
    if (provenance) {
      const { $alias: provenanceAlias, ...provenanceFields } = provenance;
      const restored: Record<string, unknown> = { ...chunk.sharedProvenance, ...provenanceFields };
      for (const [key, aliasOf] of Object.entries(provenanceAlias ?? {})) restored[key] = article[aliasOf];
      article.provenance = restored as unknown as ArticleProvenance;
    }
    return article;
  });
}

const INTERNED_MAX_LENGTH = 200;

/**
 * Makes equal string values share one string in place, without changing any value: a field equal to an earlier
 * one (contentSnippet equal to description, canonicalUrl equal to url) and short values repeated across articles
 * (feed URL, source name, author, category, ingestion time) become references instead of separate copies.
 * A freshly normalized feed catalogue holds many such copies; a decoded snapshot already shares them.
 */
export async function shareRepeatedStrings(articles: NormalizedArticle[]): Promise<void> {
  const interned = new Map<string, string>();
  const intern = (value: string) => {
    if (value.length > INTERNED_MAX_LENGTH) return value;
    const existing = interned.get(value);
    if (existing !== undefined) return existing;
    interned.set(value, value);
    return value;
  };
  // In slices that yield to the event loop: about 80 ms for 11,500 articles if done in one go.
  await mapInSlices(articles, (article) => {
    const record = article as unknown as Record<string, unknown>;
    ALIASABLE_FIELDS.forEach((field, position) => {
      const value = record[field];
      if (typeof value !== 'string') return;
      const target = [...BASE_FIELDS, ...ALIASABLE_FIELDS.slice(0, position)].find((candidate) => record[candidate] === value);
      if (target) record[field] = record[target];
    });
    for (const field of [...SHARED_FIELDS, 'author', 'category'] as const) if (typeof record[field] === 'string') record[field] = intern(record[field] as string);
    article.categories = article.categories.map(intern);
    article.tags = article.tags.map(intern);
    if (article.provenance) {
      const provenance = article.provenance as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(provenance)) {
        if (typeof value !== 'string') continue;
        const target = PROVENANCE_ALIAS_TARGETS.find((candidate) => record[candidate] === value);
        provenance[key] = target ? record[target] : intern(value);
      }
    }
  });
}

function isSnapshotChunk(value: unknown): value is SnapshotChunk {
  return Boolean(value && typeof value === 'object' && (value as SnapshotChunk).v === 1 && Array.isArray((value as SnapshotChunk).articles));
}

/**
 * Stores a catalogue as a header row plus compact chunks of SNAPSHOT_CHUNK_SIZE articles. Writing and reading
 * one chunk at a time keeps every JSON string small: a single-row snapshot needed the whole catalogue as one
 * string (and pg kept a reference to it after the write) on top of the parsed articles.
 */
export class PostgresCatalogueSnapshotStore implements CatalogueSnapshotStore {
  constructor(private readonly client: CatalogueSnapshotSqlClient) {}

  async get(publisherId: string, sourceKey: string): Promise<CatalogueSnapshot | null> {
    const result = await this.client.query<CatalogueSnapshotRow>('SELECT publisher_id, source_key, chunk_count, refreshed_at, CASE WHEN source_key = $2 THEN articles_json END AS articles_json FROM publisher_catalogue_snapshots WHERE publisher_id = $1 AND source_key IN ($2, $3) LIMIT 1', [publisherId, sourceKey, `${CHUNKED_KEY_PREFIX}${sourceKey}`]);
    const row = result.rows[0];
    if (!row) return null;
    const refreshedAt = new Date(String(row.refreshed_at)).toISOString();
    const chunked = row.source_key === `${CHUNKED_KEY_PREFIX}${sourceKey}` && row.chunk_count !== null && row.chunk_count !== undefined;
    if (!chunked) {
      if (row.source_key !== sourceKey) return null;
      // Single-row snapshot written before chunking; replaced by chunks on the next save.
      const articles = typeof row.articles_json === 'string' ? JSON.parse(row.articles_json) : row.articles_json;
      if (!Array.isArray(articles)) return null;
      return { publisherId: String(row.publisher_id), sourceKey, articles: articles as NormalizedArticle[], refreshedAt, format: 'legacy' };
    }
    const articles: NormalizedArticle[] = [];
    for (let index = 0; index < Number(row.chunk_count); index += 1) {
      const chunkResult = await this.client.query<{ chunk: unknown }>('SELECT articles_json::text AS chunk FROM publisher_catalogue_snapshot_chunks WHERE publisher_id = $1 AND chunk_index = $2', [publisherId, index]);
      const raw = chunkResult.rows[0]?.chunk;
      const chunk = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
      if (!isSnapshotChunk(chunk)) return null;
      for (const article of decodeSnapshotChunk(chunk)) articles.push(article);
    }
    return { publisherId: String(row.publisher_id), sourceKey, articles, refreshedAt };
  }

  /** Replaces the snapshot in one transaction (when the client can check out a connection), chunk by chunk. */
  async save(snapshot: CatalogueSnapshot): Promise<void> {
    const connection = this.client.connect ? await this.client.connect() : undefined;
    const target = connection ?? this.client;
    let failure: Error | undefined;
    try {
      if (connection) await connection.query('BEGIN');
      await target.query('DELETE FROM publisher_catalogue_snapshot_chunks WHERE publisher_id = $1', [snapshot.publisherId]);
      let chunkCount = 0;
      for (let start = 0; start < snapshot.articles.length; start += SNAPSHOT_CHUNK_SIZE) {
        const json = JSON.stringify(encodeSnapshotChunk(snapshot.articles.slice(start, start + SNAPSHOT_CHUNK_SIZE)));
        await target.query('INSERT INTO publisher_catalogue_snapshot_chunks (publisher_id, chunk_index, articles_json) VALUES ($1, $2, $3::jsonb)', [snapshot.publisherId, chunkCount, json]);
        chunkCount += 1;
      }
      await target.query(
        `INSERT INTO publisher_catalogue_snapshots (publisher_id, source_key, articles_json, item_count, chunk_count, refreshed_at, updated_at) VALUES ($1, $2, '[]'::jsonb, $3, $4, $5, NOW()) ON CONFLICT (publisher_id) DO UPDATE SET source_key = EXCLUDED.source_key, articles_json = EXCLUDED.articles_json, item_count = EXCLUDED.item_count, chunk_count = EXCLUDED.chunk_count, refreshed_at = EXCLUDED.refreshed_at, updated_at = NOW()`,
        [snapshot.publisherId, `${CHUNKED_KEY_PREFIX}${snapshot.sourceKey}`, snapshot.articles.length, chunkCount, snapshot.refreshedAt],
      );
      if (connection) await connection.query('COMMIT');
    } catch (error) {
      failure = error instanceof Error ? error : new Error('catalogue_snapshot_save_failed');
      if (connection) await connection.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      connection?.release(failure);
    }
  }
}

interface CatalogueSnapshotRow {
  publisher_id: string;
  source_key: string;
  chunk_count: number | null;
  articles_json: NormalizedArticle[] | string | null;
  refreshed_at: string | Date;
}
