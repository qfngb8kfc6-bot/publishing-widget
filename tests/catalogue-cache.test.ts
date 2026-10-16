import { describe, expect, it } from 'vitest';
import { PublisherCatalogueCache } from '../src/reports/catalogue-cache';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore } from '../src/publishers/store';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import type { FeedSourceConfig } from '../src/publishers/content';

const article = (publisherId: string, id = 'story') => ({
  id,
  title: `${publisherId} story`,
  url: `https://${publisherId}.example/${id}`,
  publisherId,
  categories: [],
  tags: [],
  sourceType: 'rss',
  searchText: `${publisherId} story`,
});

describe('publisher catalogue cache', () => {
  it('reuses warm catalogues, isolates tenants, and refreshes after TTL', async () => {
    let now = 1_000;
    let loads = 0;
    const cache = new PublisherCatalogueCache({ ttlMs: 100, now: () => now });
    const load = (publisherId: string) => cache.get(publisherId, 'source-v1', async () => { loads += 1; return { articles: [article(publisherId)] }; });

    const cold = await load('sgi-europe');
    const warm = await load('sgi-europe');
    const otherTenant = await load('ibi');
    expect(cold.diagnostics).toMatchObject({ catalogueCacheHit: false, catalogueRefreshReason: 'cold' });
    expect(warm.diagnostics).toMatchObject({ catalogueCacheHit: true, catalogueCacheAgeMs: 0 });
    expect(otherTenant.articles[0].publisherId).toBe('ibi');
    expect(loads).toBe(2);

    now += 101;
    const refreshed = await load('sgi-europe');
    expect(refreshed.diagnostics).toMatchObject({ catalogueCacheHit: false, catalogueRefreshReason: 'expired' });
    expect(loads).toBe(3);
  });

  it('invalidates on source/config key changes and shares concurrent cold refreshes', async () => {
    let loads = 0;
    let release: (() => void) | undefined;
    const cache = new PublisherCatalogueCache({ ttlMs: 10_000 });
    const loader = () => cache.get('sgi-europe', 'feed-v1', async () => {
      loads += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return { articles: [article('sgi-europe', `story-${loads}`)] };
    });
    const first = loader();
    const second = loader();
    expect(loads).toBe(1);
    release?.();
    const [left, right] = await Promise.all([first, second]);
    expect(left.articles).toEqual(right.articles);
    expect(right.diagnostics.catalogueRefreshReason).toBe('shared_refresh');

    const changed = await cache.get('sgi-europe', 'feed-v2', async () => { loads += 1; return { articles: [article('sgi-europe', 'new-story')] }; });
    expect(changed.diagnostics.catalogueRefreshReason).toBe('key_changed');
    expect(loads).toBe(2);
  });

  it('reuses one normalized RSS catalogue for repeated reports and theme searches', async () => {
    let fetches = 0;
    const events: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const app = createProductionApp({
      environment: 'test',
      fetchImpl: async () => { fetches += 1; return new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }); },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Sporting goods company.', topics: ['retail', 'innovation'], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => events.push({ message, fields: fields as Record<string, unknown> }), error: () => undefined },
    });
    const generate = () => app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    const first = await generate();
    expect(first.status).toBe(201);
    const firstReport = await first.json() as { reportId: string };
    const second = await generate();
    expect(second.status).toBe(201);
    const secondReport = await second.json() as { reportId: string };
    const report = await app.reportStore.get(firstReport.reportId, 'sgi-europe');
    const theme = report?.professionalProfile.professionalInterests[0] ?? 'retail';
    const themeResponse = await app.handle(new Request(`https://product.example/api/reports/${firstReport.reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST' }));
    expect(themeResponse.status).toBe(200);
    expect(fetches).toBe(1);
    expect(events.find((event) => event.message === 'report_generation_diagnostics')?.fields).toMatchObject({ publisherId: 'sgi-europe', catalogueItemCount: 6, catalogueCacheHit: false });
    expect(events.find((event) => event.message === 'theme_retrieval_diagnostics')?.fields).toMatchObject({ publisherId: 'sgi-europe', catalogueCacheHit: true, sourceFetchMs: 0, sourceParseMs: 0, normalizationMs: 0 });
    const secondRecord = await app.reportStore.get(secondReport.reportId, 'sgi-europe');
    expect(secondRecord?.recommendations.map((item) => item.articleId)).toEqual(report?.recommendations.map((item) => item.articleId));

    await app.publisherRuntime.update({ ...sgiEuropeManifest, publisherConfigVersion: '2', contentSource: { ...(sgiEuropeManifest.contentSource as FeedSourceConfig), feedUrl: 'https://www.sgieurope.com/9871.rss?adredir=2' } });
    const afterConfigChange = await generate();
    expect(afterConfigChange.status).toBe(201);
    expect(fetches).toBe(2);
  });
});
