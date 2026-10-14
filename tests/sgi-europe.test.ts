import { describe, expect, it } from 'vitest';
import { createSgiEuropeDefinition, sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createEvent } from '../src/core';
import { ReportGenerationService } from '../src/reports';

const intent = { publisherId: 'sgi-europe', answers: {}, queryText: '', keywords: [], interests: [], personas: [] };

function archiveFixture(): string {
  const newestNoise = Array.from({ length: 120 }, (_, index) => `
    <item>
      <guid>noise-${index}</guid>
      <title>Daily market bulletin ${index}</title>
      <link>https://www.sgieurope.com/market/daily-market-bulletin-${index}.article</link>
      <description>General sporting goods market news and company updates.</description>
      <pubDate>${new Date(Date.UTC(2026, 9, 13, 12, index % 60)).toUTCString()}</pubDate>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${newestNoise}
    <item>
      <guid>adidas-product-platform</guid>
      <title>Adidas product development launches a recycled footwear innovation platform</title>
      <link>https://www.sgieurope.com/innovation/adidas-product-development-footwear-platform/120001.article</link>
      <description>Adidas product strategy connects user needs, materials, design and consumer product launches for athletic apparel.</description>
      <category>Innovation</category><category>Product Development</category>
      <pubDate>Tue, 2 Jan 2024 09:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>nike-retail-strategy</guid>
      <title>Nike retail strategy brings product innovation closer to consumers</title>
      <link>https://www.sgieurope.com/retail/nike-retail-strategy-product-innovation/120002.article</link>
      <description>Nike expands retail operations and consumer product launches through a store and digital experience strategy.</description>
      <category>Retail</category><category>Innovation</category>
      <pubDate>Tue, 2 Jan 2024 08:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>adidas-materials-research</guid>
      <title>Adidas materials research advances footwear design and circular product development</title>
      <link>https://www.sgieurope.com/materials/adidas-materials-footwear-design/120003.article</link>
      <description>New materials support product development, design and sustainability across consumer footwear.</description>
      <category>Materials</category><category>Product Development</category>
      <pubDate>Tue, 2 Jan 2024 07:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
}

function archiveFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
  return Promise.resolve(new Response(archiveFixture(), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }));
}

function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
  return Promise.resolve(new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }));
}

function sizedFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
  return Promise.resolve(new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml', 'Content-Length': '11984097' } }));
}

function oversizedSgiFetch(input: RequestInfo | URL): Promise<Response> {
  expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
  return Promise.resolve(new Response('<rss />', { status: 200, headers: { 'Content-Type': 'application/rss+xml', 'Content-Length': String(20 * 1024 * 1024 + 1) } }));
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
  it('configures the live feed for a bounded 20 MiB response and rejects larger responses', async () => {
    expect(sgiEuropeManifest.contentSource).toMatchObject({ type: 'rss', feedUrl: 'https://www.sgieurope.com/9871.rss?adredir=1', maxBytes: 20 * 1024 * 1024 });
    const allowed = createSgiEuropeDefinition(sizedFixtureFetch);
    await expect(allowed.adapter.search(intent, { limit: 1 })).resolves.toHaveLength(1);
    const oversized = createSgiEuropeDefinition(oversizedSgiFetch);
    await expect(oversized.adapter.search(intent, { limit: 1 })).rejects.toMatchObject({ code: 'source_response_too_large', contentLength: 20 * 1024 * 1024 + 1, maxBytes: 20 * 1024 * 1024 });
  });

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

  it('preselects across the normalized archive instead of hiding older relevant stories behind the newest 100', async () => {
    const definition = createSgiEuropeDefinition(archiveFixtureFetch);
    const productManagerIntent = {
      publisherId: 'sgi-europe',
      answers: { companyUrl: 'https://adidas.com/', jobTitle: 'Product Manager' },
      queryText: 'Product management product strategy product development innovation footwear apparel',
      keywords: ['product', 'strategy', 'development', 'innovation', 'footwear', 'apparel'],
      interests: ['product strategy', 'product development', 'innovation', 'footwear', 'apparel'],
      personas: ['Product management'],
      directInterests: ['product strategy', 'product development', 'innovation', 'design', 'footwear', 'apparel'],
      adjacentInterests: ['marketing', 'sustainability', 'retail'],
      excludedConcepts: ['astronomy'],
    };
    const records = await definition.adapter.search(productManagerIntent, { limit: 100 });
    const articles = records.flatMap((record) => {
      const article = definition.adapter.normalizeArticle(record);
      return article ? [article] : [];
    });
    expect(articles).toHaveLength(100);
    expect(articles.some((article) => article.id === 'adidas-product-platform')).toBe(true);
    expect(articles.some((article) => article.id === 'nike-retail-strategy')).toBe(true);
    expect(definition.adapter.lastDiagnostics?.sourceStats).toMatchObject({ feedItemsFetched: 123, normalizedArticles: 123, preselectionInputCount: 123, preselectionOutputCount: 100 });
  });

  it('generates an archive-aware Adidas Product Manager report while preserving a Nike Head of Retail path', async () => {
    const logEvents: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger = { info: (message: string, fields?: Record<string, unknown>) => logEvents.push({ message, fields }), error: () => undefined };
    const adidasCompany = {
      ...companyContext('adidas.com'),
      name: 'Adidas',
      industry: 'sportswear',
      topics: ['athletic footwear', 'apparel', 'innovation'],
      productsServices: ['consumer products', 'footwear', 'apparel'],
      activities: ['product development', 'design'],
    };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      fetchImpl: archiveFixtureFetch,
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyContextProvider: { getContext: async (domain: string) => domain === 'adidas.com' ? adidasCompany : { ...adidasCompany, domain, canonicalUrl: `https://${domain}/`, name: 'Nike', topics: ['retail', 'consumer products', 'innovation'], productsServices: ['consumer products'] } },
      logger,
    });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'adidas.com', jobTitle: 'Product Manager' }) }));
    expect(generated.status, await generated.clone().text()).toBe(201);
    const payload = await generated.json() as { reportId: string };
    const adidasReport = await app.reportStore.get(payload.reportId, 'sgi-europe');
    expect(adidasReport?.professionalProfile.role.function).toBe('Product management');
    expect(adidasReport?.professionalProfile.directInterests).toEqual(expect.arrayContaining(['product strategy', 'product development', 'innovation']));
    expect(adidasReport?.recommendations.some((recommendation) => recommendation.article.id === 'adidas-product-platform')).toBe(true);

    const service = new ReportGenerationService(app.registry, { getContext: async (domain: string) => domain === 'adidas.com' ? adidasCompany : { ...adidasCompany, domain, canonicalUrl: `https://${domain}/`, name: 'Nike', topics: ['retail', 'consumer products', 'innovation'], productsServices: ['consumer products'] } }, app.reportStore, app.analyticsStore, undefined, logger);
    if (!adidasReport) throw new Error('Adidas report was not persisted.');
    const currentAdidas = adidasReport.recommendations.find((recommendation) => recommendation.article.id === 'adidas-product-platform');
    if (!currentAdidas) throw new Error('Adidas product story was not recommended.');
    const themeResults = await service.searchTheme({ ...adidasReport, recommendations: [currentAdidas] }, 'materials');
    expect(themeResults.some((recommendation) => recommendation.article.id === 'adidas-materials-research')).toBe(true);
    const nikeReport = await service.generate({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' });
    expect(nikeReport.recommendations.some((recommendation) => recommendation.article.id === 'nike-retail-strategy')).toBe(true);
    const diagnostics = logEvents.find((event) => event.message === 'report_retrieval_diagnostics');
    expect(diagnostics?.fields).toMatchObject({ publisherId: 'sgi-europe', normalizedArticleCount: 123, preselectionInputCount: 123, preselectionOutputCount: 100, rankingCandidateCount: 100, retrievalCandidates: 100 });
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
    const sgiSectionIds = report!.sections?.flatMap((section) => section.recommendations.map((recommendation) => recommendation.article.id)) ?? [];
    expect(new Set(sgiSectionIds).size).toBe(sgiSectionIds.length);
    expect(sgiSectionIds).not.toContain(report!.recommendations[0]?.article.id);

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

  it('reports content health success for a live-sized SGI response', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      fetchImpl: sizedFixtureFetch,
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    });
    const login = await app.handle(new Request('https://admin.example/api/admin/login', { method: 'POST', headers: { Origin: 'https://admin.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-password' }) }));
    const cookie = login.headers.get('Set-Cookie')!.split(';', 1)[0];
    const health = await app.handle(new Request('https://admin.example/api/admin/publishers/sgi-europe/content-check', { method: 'POST', headers: { Origin: 'https://admin.example', Cookie: cookie } }));
    expect(health.status).toBe(200);
    expect((await health.json()).reachable).toBe(true);
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
