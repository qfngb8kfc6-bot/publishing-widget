import type { NormalizedArticle } from '../core';

export interface CatalogueSnapshot {
  publisherId: string;
  sourceKey: string;
  articles: NormalizedArticle[];
  refreshedAt: string;
}

export interface CatalogueSnapshotStore {
  get(publisherId: string, sourceKey: string): Promise<CatalogueSnapshot | null>;
  save(snapshot: CatalogueSnapshot): Promise<void>;
}

export interface CatalogueSnapshotSqlClient {
  query<Row = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
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

export class PostgresCatalogueSnapshotStore implements CatalogueSnapshotStore {
  constructor(private readonly client: CatalogueSnapshotSqlClient) {}

  async get(publisherId: string, sourceKey: string): Promise<CatalogueSnapshot | null> {
    const result = await this.client.query<CatalogueSnapshotRow>('SELECT publisher_id, source_key, articles_json, refreshed_at FROM publisher_catalogue_snapshots WHERE publisher_id = $1 AND source_key = $2 LIMIT 1', [publisherId, sourceKey]);
    const row = result.rows[0];
    if (!row) return null;
    const articles = typeof row.articles_json === 'string' ? JSON.parse(row.articles_json) : row.articles_json;
    if (!Array.isArray(articles)) return null;
    return { publisherId: String(row.publisher_id), sourceKey: String(row.source_key), articles: articles as NormalizedArticle[], refreshedAt: new Date(String(row.refreshed_at)).toISOString() };
  }

  async save(snapshot: CatalogueSnapshot): Promise<void> {
    await this.client.query(
      `INSERT INTO publisher_catalogue_snapshots (publisher_id, source_key, articles_json, item_count, refreshed_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5, NOW()) ON CONFLICT (publisher_id) DO UPDATE SET source_key = EXCLUDED.source_key, articles_json = EXCLUDED.articles_json, item_count = EXCLUDED.item_count, refreshed_at = EXCLUDED.refreshed_at, updated_at = NOW()`,
      [snapshot.publisherId, snapshot.sourceKey, JSON.stringify(snapshot.articles), snapshot.articles.length, snapshot.refreshedAt],
    );
  }
}

interface CatalogueSnapshotRow {
  publisher_id: string;
  source_key: string;
  articles_json: NormalizedArticle[] | string;
  refreshed_at: string | Date;
}
