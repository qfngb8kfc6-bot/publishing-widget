import { describe, expect, it } from 'vitest';
import { createSgiEuropeDefinition, sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createEvent } from '../src/core';
import { ReportGenerationService } from '../src/reports';

const intent = { publisherId: 'sgi-europe', answers: {}, queryText: '', keywords: [], interests: [], personas: [] };

function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
  return Promise.resolve(new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }));
}

function companyContext(domain: string) {
  return {
    domain,
    canonicalUrl: `https://${domain}/`,
    name: domain.split('.')[0],
    industry: 'sporting goods',
    description: 'A sporting goods company.',
    topics: ['retail', 'sustainability', 'innovation'],
    entities: [domain.split('.')[0]],
    source: 'submitted-domain' as const,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    analysisVersion: 'test',
  };
}

describe('SGI Europe RSS publisher', () => {
  it('normalizes the actual RSS structure and keeps useful searchable metadata', async () => {
    const definition = createSgiEuropeDefinition(fixtureFetch);
    const records = await definition.adapter.search(intent, { limit: 100 });
    const articles = records.flatMap((record) => {
      const article = definition.adapter.normalizeArticle(record);
      return article ? [article] : [];
    });

    expect(records).toHaveLength(6);
    expect(articles).toHaveLength(6);
    expect(definition.adapter.lastDiagnostics).toMatchObject({ accepted: 6, rejected: 1, duplicates: 1, sourceStats: { feedItemsFetched: 8, feedItemsSelected: 6, normalizedArticles: 6 } });
    expect(articles[0]).toMatchObject({
      title: 'Misto Holdings after the FILA rename: case study',
      url: 'https://www.sgieurope.com/case-studies/misto-holdings-after-the-fila-rename-case-study/123559.article',
      publishedAt: '2026-10-13T11:34:00.000Z',
      imageUrl: 'https://cdn.example.test/misto.jpg',
      author: 'Valentina Giannella',
      categories: ['Case Studies'],
    });
    expect(articles[0].searchText).toContain('Misto Holdings after the FILA rename: case study');
    expect(articles[0].searchText).toContain('multi-brand ambitions');
    expect(articles[0].searchText).toContain('Case Studies');
    expect(articles[0].searchText).toContain('Valentina Giannella');
    expect(articles.find((article) => article.title.startsWith('Textile recycling'))?.imageUrl).toBe('https://cdn.example.test/recycling.jpg');
    expect(articles.find((article) => article.title.startsWith('Circular sportswear'))?.imageUrl).toBe('https://cdn.example.test/circular-thumb.jpg');
    expect(articles.find((article) => article.title.startsWith('Supply chain'))?.description).toBeUndefined();
    expect(articles.find((article) => article.title.startsWith('Supply chain'))?.searchText).toContain('Corporate');
  });

  it('normalizes the full feed before applying a bounded newest-first candidate limit', async () => {
    const definition = createSgiEuropeDefinition(fixtureFetch);
    const records = await definition.adapter.search(intent, { limit: 3 });
    const articles = records.flatMap((record) => {
      const article = definition.adapter.normalizeArticle(record);
      return article ? [article] : [];
    });
    expect(articles).toHaveLength(3);
    expect(articles.map((article) => article.title)).toEqual([
      'Misto Holdings after the FILA rename: case study',
      'Textile recycling: The next challenge is scaling up',
      'Circular sportswear: matching construction to recovery',
    ]);
    expect(definition.adapter.lastDiagnostics?.sourceStats).toMatchObject({ feedItemsFetched: 8, feedItemsSelected: 3 });
  });

  it('runs content health, report generation, persistence and theme search through the production path', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      fetchImpl: fixtureFetch,
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyContextProvider: { getContext: async (domain: string) => companyContext(domain) },
    });
    const login = await app.handle(new Request('https://admin.example/api/admin/login', { method: 'POST', headers: { Origin: 'https://admin.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-password' }) }));
    const cookie = login.headers.get('Set-Cookie')!.split(';', 1)[0];
    const health = await app.handle(new Request('https://admin.example/api/admin/publishers/sgi-europe/content-check', { method: 'POST', headers: { Origin: 'https://admin.example', Cookie: cookie } }));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ sourceType: 'rss', reachable: true, recordsFetched: 8, accepted: 6, rejected: 1, duplicates: 1, coverage: { image: 50, publishedAt: 100, description: 67 } });

    const generated = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'example.test', jobTitle: 'Product Manager' }) }));
    expect(generated.status, await generated.clone().text()).toBe(201);
    const payload = await generated.json() as { reportId: string };
    const report = await app.reportStore.get(payload.reportId, 'sgi-europe');
    expect(report).toMatchObject({ id: payload.reportId, publisherId: 'sgi-europe', recommendations: expect.any(Array) });

    const theme = report!.professionalProfile.professionalInterests[0];
    const themeSearch = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST' }));
    expect(themeSearch.status).toBe(200);
    expect((await themeSearch.json()).reportId).toBe(payload.reportId);

    const analytics = await app.handle(new Request('https://product.example/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [createEvent('widget_impression', 'sgi-europe', 'sgi-session-1')] }) }));
    expect(analytics.status).toBe(202);
    const overview = await app.handle(new Request('https://product.example/api/analytics/sgi-europe/overview'));
    expect(overview.status).toBe(200);
    expect((await overview.json()).publisherId).toBe('sgi-europe');
  });

  it('persists an empty SGI report when bounded retrieval has no eligible matches', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyContextProvider: { getContext: async (domain: string) => companyContext(domain) },
    });
    const definition = app.registry.get('sgi-europe');
    if (!definition) throw new Error('SGI Europe definition missing');
    definition.adapter = { publisherId: 'sgi-europe', search: async () => [], normalizeArticle: () => null };
    const service = new ReportGenerationService(app.registry, { getContext: async (domain: string) => companyContext(domain) }, app.reportStore, app.analyticsStore);
    const report = await service.generate({ publisherId: 'sgi-europe', companyUrl: 'example.test', jobTitle: 'Unmatched role' });
    expect(report.recommendations).toEqual([]);
    expect(await app.reportStore.get(report.id, 'sgi-europe')).toMatchObject({ id: report.id, publisherId: 'sgi-europe', recommendations: [] });
  });
});
