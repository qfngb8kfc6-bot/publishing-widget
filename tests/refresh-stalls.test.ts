import { describe, expect, it } from 'vitest';
import { mapInSlices, type NormalizedArticle } from '../src/core';
import { catalogueFingerprint, MemoryCatalogueSnapshotStore, PostgresCatalogueSnapshotStore, PublisherCatalogueCache, type CatalogueRefreshReport } from '../src/reports';

function article(index: number, title = `Story ${index}`): NormalizedArticle {
  return { id: `a${index}`, title, description: 'Retail stores and suppliers.', url: `https://www.sgieurope.com/a${index}.article`, categories: ['Retail'], tags: [], publisherId: 'sgi-europe', publishedAt: '2026-09-01T00:00:00.000Z' };
}

describe('sliced work', () => {
  it('returns exactly items.map(...) while letting other callbacks run between slices', async () => {
    const items = Array.from({ length: 2_000 }, (_, index) => index);
    let interleaved = false;
    setImmediate(() => { interleaved = true; });
    const result = await mapInSlices(items, (item) => { const until = performance.now() + 0.01; while (performance.now() < until) { /* work */ } return item * 2; }, 1);
    expect(result).toEqual(items.map((item) => item * 2));
    expect(interleaved).toBe(true);
  });

  it('serializes snapshots exactly as JSON.stringify does', async () => {
    const articles = Array.from({ length: 50 }, (_, index) => ({ ...article(index), metadata: { quote: 'He said "go"', unicode: 'café 🏃' } }));
    let sent = '';
    await new PostgresCatalogueSnapshotStore({ query: async (_sql: string, parameters?: unknown[]) => { sent = String(parameters?.[2]); return { rows: [] }; } }).save({ publisherId: 'sgi-europe', sourceKey: 'k', articles, refreshedAt: '2026-10-20T00:00:00.000Z' });
    expect(sent).toBe(JSON.stringify(articles));
  });
});

describe('catalogue fingerprint', () => {
  it('is stable for identical content and changes when content changes', async () => {
    const articles = Array.from({ length: 100 }, (_, index) => article(index));
    const fingerprint = await catalogueFingerprint(articles);
    expect(await catalogueFingerprint(articles.map((item) => ({ ...item })))).toBe(fingerprint);
    expect(await catalogueFingerprint([...articles.slice(0, 99), article(99, 'Edited headline')])).not.toBe(fingerprint);
    expect(await catalogueFingerprint([...articles, article(100)])).not.toBe(fingerprint);
  });
});

describe('snapshot writes on refresh', () => {
  class CountingStore extends MemoryCatalogueSnapshotStore {
    saves = 0;
    failNext = false;
    override async save(snapshot: Parameters<MemoryCatalogueSnapshotStore['save']>[0]): Promise<void> {
      this.saves += 1;
      if (this.failNext) { this.failNext = false; throw new Error('database unavailable'); }
      return super.save(snapshot);
    }
  }

  async function refresh(cache: PublisherCatalogueCache, articles: NormalizedArticle[], now: { value: number }) {
    now.value += 10_000;
    await cache.get('sgi-europe', 'key', async () => ({ articles: articles.map((item) => ({ ...item })) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it('skips rewriting an unchanged snapshot, writes changes, and retries after a failed write', async () => {
    const store = new CountingStore();
    const reports: CatalogueRefreshReport[] = [];
    const now = { value: 0 };
    const cache = new PublisherCatalogueCache({ ttlMs: 1_000, maxStaleMs: 1_000, now: () => now.value, snapshotStore: store, onRefreshComplete: (_publisherId, report) => reports.push(report) });
    const articles = Array.from({ length: 30 }, (_, index) => article(index));
    await refresh(cache, articles, now);
    await refresh(cache, articles, now);
    expect(store.saves).toBe(1);
    await refresh(cache, [...articles, article(30)], now);
    expect(store.saves).toBe(2);
    store.failNext = true;
    await refresh(cache, [...articles, article(31)], now);
    await refresh(cache, [...articles, article(31)], now);
    expect(store.saves).toBe(4);
    expect(reports.map((report) => report.snapshot)).toEqual(['saved', 'unchanged', 'saved', 'failed', 'saved']);
    expect(reports.every((report) => report.articleCount >= 30)).toBe(true);
  });
});
