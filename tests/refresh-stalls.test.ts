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

  it('writes snapshots as small chunks, never one catalogue-sized string', async () => {
    const articles = Array.from({ length: 1_200 }, (_, index) => ({ ...article(index), metadata: { quote: 'He said "go"', unicode: 'café 🏃' } }));
    const sent: string[] = [];
    await new PostgresCatalogueSnapshotStore({ query: async (sql: string, parameters?: unknown[]) => { if (sql.startsWith('INSERT INTO publisher_catalogue_snapshot_chunks')) sent.push(String(parameters?.[2])); return { rows: [] }; } }).save({ publisherId: 'sgi-europe', sourceKey: 'k', articles, refreshedAt: '2026-10-20T00:00:00.000Z' });
    expect(sent).toHaveLength(3);
    expect(Math.max(...sent.map((json) => json.length))).toBeLessThan(JSON.stringify(articles).length / 2);
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

describe('report request on an unindexed catalogue', () => {
  it('scores the archive in slices, so a request right after a refresh never blocks the event loop for long', async () => {
    const { createProductionApp } = await import('../src/server/production');
    const { sgiEuropeManifest } = await import('../src/publishers/sgi-europe');
    const { MemoryPublisherStore } = await import('../src/publishers/store');
    const words = 'retail stores omnichannel distribution wholesale footwear apparel running sustainability supply chain sourcing materials consumers growth brand market europe pricing'.split(' ');
    const text = (seed: number, count: number) => Array.from({ length: count }, (_, offset) => words[(seed * 7 + offset * 13) % words.length]).join(' ');
    const items = Array.from({ length: 6_000 }, (_, index) => `<item><title>${text(index, 9)}</title><link>https://www.sgieurope.com/news/s-${index}/${200000 + index}.article</link><guid>https://www.sgieurope.com/news/s-${index}/${200000 + index}.article</guid><description>${text(index + 3, 60)}</description><pubDate>${new Date(Date.UTC(2012 + (index % 14), index % 12, 1 + (index % 28))).toUTCString()}</pubDate></item>`).join('');
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { PUBLISHER_INDEX_PREBUILD: 'false' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    await app.prewarmCatalogues();
    let longestGap = 0;
    let last = performance.now();
    let running = true;
    const tick = () => { const now = performance.now(); longestGap = Math.max(longestGap, now - last); last = now; if (running) setImmediate(tick); };
    setImmediate(tick);
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    running = false;
    // Work that never yields leaves no tick at all: count the stretch since the last tick too.
    longestGap = Math.max(longestGap, performance.now() - last);
    expect(response.status).toBe(201);
    expect(longestGap).toBeLessThan(300);
  }, 60_000);
});
