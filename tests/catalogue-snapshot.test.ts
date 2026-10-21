import { describe, expect, it } from 'vitest';
import { decodeSnapshotChunk, encodeSnapshotChunk, PostgresCatalogueSnapshotStore, shareRepeatedStrings, SNAPSHOT_CHUNK_SIZE, type CatalogueSnapshotSqlConnection } from '../src/reports/catalogue-snapshot';
import { FeedContentAdapter } from '../src/publishers/content';
import { sgiEuropeContentSource } from '../src/publishers/sgi-europe/config';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import type { NormalizedArticle } from '../src/core';

const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function fixtureArticles(): Promise<NormalizedArticle[]> {
  const adapter = new FeedContentAdapter('sgi-europe', sgiEuropeContentSource, async () => new Response(sgiEuropeRssFixture, { status: 200 }));
  return await adapter.search({ publisherId: 'sgi-europe', answers: {}, queryText: '', keywords: [], interests: [], personas: [] }, { limit: 100, archiveWide: true } as never) as NormalizedArticle[];
}

/** In-memory stand-in for the two snapshot tables, answering exactly the store's statements. */
class FakeSnapshotDatabase {
  header?: { publisher_id: string; source_key: string; chunk_count: number | null; refreshed_at: string; articles_json: unknown };
  chunks = new Map<number, string>();
  statements: string[] = [];
  failOn?: RegExp;

  async query<Row>(sql: string, parameters: unknown[] = []): Promise<{ rows: Row[] }> {
    this.statements.push(sql.split(' ').slice(0, 3).join(' '));
    if (this.failOn?.test(sql)) throw new Error('write failed');
    if (sql.startsWith('SELECT publisher_id')) return { rows: (this.header && (this.header.source_key === parameters[1] || this.header.source_key === parameters[2]) ? [{ ...this.header, articles_json: this.header.source_key === parameters[1] ? this.header.articles_json : null }] : []) as Row[] };
    if (sql.startsWith('SELECT articles_json::text')) { const chunk = this.chunks.get(Number(parameters[1])); return { rows: (chunk === undefined ? [] : [{ chunk }]) as Row[] }; }
    if (sql.startsWith('DELETE FROM publisher_catalogue_snapshot_chunks')) this.chunks.clear();
    if (sql.startsWith('INSERT INTO publisher_catalogue_snapshot_chunks')) this.chunks.set(Number(parameters[1]), String(parameters[2]));
    if (sql.startsWith('INSERT INTO publisher_catalogue_snapshots')) this.header = { publisher_id: String(parameters[0]), source_key: String(parameters[1]), chunk_count: Number(parameters[3]), refreshed_at: String(parameters[4]), articles_json: [] };
    return { rows: [] };
  }
}

function pooled(database: FakeSnapshotDatabase) {
  const released: unknown[] = [];
  const connection: CatalogueSnapshotSqlConnection = { query: (sql, parameters) => database.query(sql, parameters), release: (error) => { released.push(error ?? 'clean'); } };
  return { client: { query: async () => { throw new Error('saves must use the checked-out connection'); }, connect: async () => connection }, released };
}

describe('compact snapshot chunks', () => {
  it('decode to articles equal to the stored ones, at less than half the size', async () => {
    const articles = await fixtureArticles();
    expect(articles.length).toBeGreaterThan(3);
    const chunk = jsonCopy(encodeSnapshotChunk(articles));
    const decoded = decodeSnapshotChunk(chunk);
    expect(decoded).toStrictEqual(jsonCopy(articles));
    expect(JSON.stringify(chunk).length).toBeLessThan(JSON.stringify(articles).length / 2);
  });

  it('keeps values that only look derivable', () => {
    const base: NormalizedArticle = { id: 'a', url: 'https://x.example/a', title: 'T', description: 'D', summary: 'Different', contentSnippet: 'D', categories: ['C'], tags: [], publisherId: 'p', searchText: 'custom search text', sourceName: 'One' };
    const other: NormalizedArticle = { ...base, id: 'b', url: 'https://x.example/b', sourceName: 'Two', provenance: { publisherId: 'p', sourceArticleId: 'b', sourceUrl: 'https://x.example/feed', retrievalSource: 'feed', originalUrl: 'https://x.example/b' } };
    const articles = [base, other, { ...base, id: 'c', url: 'https://x.example/c', searchText: 'T D Different D C', author: undefined }];
    expect(decodeSnapshotChunk(jsonCopy(encodeSnapshotChunk(articles)))).toStrictEqual(jsonCopy(articles));
  });
});

describe('PostgresCatalogueSnapshotStore', () => {
  it('saves in one transaction as chunks and reads the same catalogue back', async () => {
    const articles = await fixtureArticles();
    const many = Array.from({ length: SNAPSHOT_CHUNK_SIZE * 2 + 3 }, (_, index) => ({ ...articles[index % articles.length], id: `id-${index}`, url: `https://www.sgieurope.com/retail/story/${index}.article` }));
    const database = new FakeSnapshotDatabase();
    const { client, released } = pooled(database);
    const store = new PostgresCatalogueSnapshotStore(client);
    await store.save({ publisherId: 'sgi-europe', sourceKey: 'feed-v1', articles: many, refreshedAt: '2026-10-21T00:00:00.000Z' });
    expect(database.statements[0]).toBe('BEGIN');
    expect(database.statements.at(-1)).toBe('COMMIT');
    expect(database.chunks.size).toBe(3);
    expect(released).toEqual(['clean']);
    const readStore = new PostgresCatalogueSnapshotStore({ query: (sql, parameters) => database.query(sql, parameters) });
    const loaded = await readStore.get('sgi-europe', 'feed-v1');
    expect(loaded?.articles).toStrictEqual(jsonCopy(many));
    expect(loaded?.refreshedAt).toBe('2026-10-21T00:00:00.000Z');
    expect(await readStore.get('sgi-europe', 'other-key')).toBeNull();
    // Code from before chunking looks up the plain key and finds nothing, rather than an empty article list.
    expect(database.header?.source_key).toBe('chunks-v1:feed-v1');
  });

  it('rolls back and releases the connection when a chunk write fails', async () => {
    const database = new FakeSnapshotDatabase();
    database.failOn = /INSERT INTO publisher_catalogue_snapshot_chunks/;
    const { client, released } = pooled(database);
    await expect(new PostgresCatalogueSnapshotStore(client).save({ publisherId: 'sgi-europe', sourceKey: 'k', articles: await fixtureArticles(), refreshedAt: '2026-10-21T00:00:00.000Z' })).rejects.toThrow('write failed');
    expect(database.statements.at(-1)).toBe('ROLLBACK');
    expect(released[0]).toBeInstanceOf(Error);
  });

  it('reads a single-row snapshot written before chunking, and treats a missing chunk as no snapshot', async () => {
    const articles = await fixtureArticles();
    const database = new FakeSnapshotDatabase();
    database.header = { publisher_id: 'sgi-europe', source_key: 'k', chunk_count: null, refreshed_at: '2026-10-21T00:00:00.000Z', articles_json: JSON.stringify(articles) };
    const store = new PostgresCatalogueSnapshotStore({ query: (sql, parameters) => database.query(sql, parameters) });
    const legacy = await store.get('sgi-europe', 'k');
    expect(legacy?.articles).toStrictEqual(jsonCopy(articles));
    expect(legacy?.format).toBe('legacy');
    database.header = { ...database.header, source_key: 'chunks-v1:k', chunk_count: 2 };
    database.chunks.set(0, JSON.stringify(encodeSnapshotChunk(articles)));
    expect(await store.get('sgi-europe', 'k')).toBeNull();
  });
});

describe('shareRepeatedStrings', () => {
  it('changes no value', async () => {
    const articles = await fixtureArticles();
    const before = JSON.stringify(articles);
    await shareRepeatedStrings(articles);
    expect(JSON.stringify(articles)).toBe(before);
  });
});

