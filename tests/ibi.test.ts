import { describe, expect, it } from 'vitest';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import { DeterministicExplanationProvider, PublisherRegistry, type NormalizedArticle, type PublisherAdapter } from '../src/core';
import { deduplicateArticles } from '../src/publishers/content';
import { createIbiDefinition, ibiManifest, normalizeIbiArticle } from '../src/publishers/ibi';
import { ibiFixtureArticles } from '../src/publishers/ibi/fixtures';
import { createProductionApp } from '../src/server/production';
import { MemoryReportStore, ReportGenerationService } from '../src/reports';
import { SafeCompanyContextProvider } from '../src/server/company';

function fixtureArticleAdapter(): PublisherAdapter<NormalizedArticle> {
  const normalized = deduplicateArticles(ibiFixtureArticles.flatMap((raw) => {
    const article = normalizeIbiArticle(raw);
    return article ? [article] : [];
  })).articles;
  return {
    publisherId: 'ibi',
    search: async () => normalized,
    normalizeArticle: (raw) => raw as NormalizedArticle,
  };
}

function fixtureRegistry(): PublisherRegistry {
  const definition = createIbiDefinition(async (input) => {
    const url = String(input);
    if (url.includes('GoogleSiteMapIndex.aspx')) {
      return new Response('<sitemapindex><sitemap><loc>https://www.ibinews.com/googlesitemap.aspx?year=2026</loc></sitemap></sitemapindex>', { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    if (url.includes('googlesitemap.aspx')) {
      const locations = ibiFixtureArticles.filter((article) => article.url?.startsWith('https://www.ibinews.com/')).map((article) => `<url><loc>${article.url}</loc></url>`).join('');
      return new Response(`<urlset>${locations}</urlset>`, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    }
    const article = ibiFixtureArticles.find((candidate) => candidate.url === url);
    return new Response(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', '@id': article?.id, headline: article?.title, description: article?.description, url: article?.url, datePublished: article?.publishedAt, author: { name: article?.author } })}</script></head><body>${article?.description ?? ''}</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  });
  const registry = new PublisherRegistry();
  registry.registerManifest(ibiManifest, definition.adapter, new DeterministicExplanationProvider());
  return registry;
}

function fixtureService(): { service: ReportGenerationService; registry: PublisherRegistry } {
  const registry = fixtureRegistry();
  registry.get('ibi')!.adapter = fixtureArticleAdapter();
  return { registry, service: new ReportGenerationService(registry, new SafeCompanyContextProvider(), new MemoryReportStore()) };
}

describe('IBI News publisher onboarding', () => {
  it('runs both production profile paths, preserves real candidates and persists zero-result reports', async () => {
    const articles = new Map([
      ['https://www.ibinews.com/news/technology-automation/56346.article', { title: 'Marine technology platform adds automation to digital operations', description: 'Software and AI tools improve digital products and operational technology for marine businesses.', section: 'Technology', keywords: ['technology', 'software', 'AI', 'automation', 'digital products'], date: '2026-10-13' }],
      ['https://www.ibinews.com/interactive-digital-editions/ibi-aug-sept-26-digital-issue/55788.article', { title: 'Marine market outlook and company developments', description: 'A wider industry update for marine businesses.', section: 'News', keywords: ['markets'], date: '2026-10-12' }],
    ]);
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('GoogleSiteMapIndex.aspx')) return new Response('<sitemapindex><sitemap><loc>https://www.ibinews.com/googlesitemap.aspx?year=2026</loc></sitemap></sitemapindex>', { status: 200 });
      if (url.includes('googlesitemap.aspx')) return new Response(`<urlset>${[...articles.entries()].map(([articleUrl, article]) => `<url><loc>${articleUrl}</loc><lastmod>${article.date}T12:00:00Z</lastmod></url>`).join('')}</urlset>`, { status: 200 });
      const article = articles.get(url);
      if (!article) return new Response('not found', { status: 404 });
      return new Response(`<html><head><link rel="canonical" href="${url}"><meta property="og:title" content="${article.title}"><meta property="og:description" content="${article.description}"><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: article.title, description: article.description, articleSection: article.section, keywords: article.keywords, datePublished: article.date, url })}</script></head><body><p>${article.description}</p></body></html>`, { status: 200 });
    };
    const logs: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger = { info: (message: string, fields?: Record<string, unknown>) => logs.push({ message, fields }), error: (message: string, fields?: Record<string, unknown>) => logs.push({ message, fields }) };
    const app = createProductionApp({ environment: 'test', fetchImpl, companyContextProvider: new SafeCompanyContextProvider(async () => new Response('unavailable', { status: 503 })), logger });
    const generate = (companyUrl: string, jobTitle: string) => app.handle(new Request('https://local.test/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'ibi', companyUrl, jobTitle }) }));

    const ldResponse = await generate('ldsystems.uk', 'Technology Professional');
    expect(ldResponse.status).toBe(201);
    const ldPayload = await ldResponse.json() as { reportId: string };
    const ld = await app.reportStore.get(ldPayload.reportId, 'ibi');
    expect(ld?.recommendations.length).toBeGreaterThan(0);
    expect(ld).toMatchObject({ id: ldPayload.reportId, recommendations: expect.any(Array) });
    const ibiSectionIds = ld?.sections?.flatMap((section) => section.recommendations.map((recommendation) => recommendation.article.id)) ?? [];
    expect(new Set(ibiSectionIds).size).toBe(ibiSectionIds.length);
    expect(ibiSectionIds).not.toContain(ld?.recommendations[0]?.article.id);

    const burgessResponse = await generate('burgessyachts.com', 'Product Manager');
    expect(burgessResponse.status).toBe(201);
    const burgessPayload = await burgessResponse.json() as { reportId: string };
    const burgess = await app.reportStore.get(burgessPayload.reportId, 'ibi');
    expect(burgess?.recommendations).toEqual([]);
    expect(burgess?.overallMatchScore).toBe(0);
    expect(burgess).toMatchObject({ id: burgessPayload.reportId, recommendations: [] });
    const ldRequestId = ldResponse.headers.get('X-Request-ID');
    const burgessRequestId = burgessResponse.headers.get('X-Request-ID');
    expect(logs.find((entry) => entry.message === 'ibi_generation_content_source' && entry.fields?.requestId === ldRequestId)?.fields).toMatchObject({ publisherId: 'ibi', sitemapUrlsFound: 2, articleUrlsAccepted: 2, articlePagesFetched: 2, normalizedArticles: 2 });
    expect(logs.find((entry) => entry.message === 'ibi_generation_counts' && entry.fields?.requestId === burgessRequestId)?.fields).toMatchObject({ retrievalCandidates: 2, normalizedArticles: 2, deterministicEligible: 0, finalRecommendations: 0 });
  });

  it('normalizes stable IDs, canonical URLs, provenance and rejects malformed records', () => {
    const first = normalizeIbiArticle(ibiFixtureArticles[0]);
    const duplicate = normalizeIbiArticle(ibiFixtureArticles.find((article) => article.id === 'ibi-fixture-duplicate'));
    expect(first).toMatchObject({ id: 'ibi-fixture-materials', externalId: 'ibi-fixture-materials', publisherId: 'ibi', sourceType: 'sitemap', canonicalUrl: 'https://www.ibinews.com/ibi-fixture/materials.article' });
    expect(first?.provenance).toMatchObject({ publisherId: 'ibi', sourceArticleId: 'ibi-fixture-materials', retrievalSource: 'IBI News robots-advertised sitemap index' });
    expect(duplicate?.canonicalUrl).toBe('https://www.ibinews.com/ibi-fixture/suppliers.article');
    expect(normalizeIbiArticle(ibiFixtureArticles.find((article) => article.id === 'ibi-fixture-invalid'))).toBeNull();
    const normalized = ibiFixtureArticles.flatMap((raw) => {
      const article = normalizeIbiArticle(raw);
      return article ? [article] : [];
    });
    expect(normalized).toHaveLength(17);
    expect(deduplicateArticles(normalized)).toMatchObject({ duplicates: 1, articles: expect.any(Array) });
    expect(deduplicateArticles(normalized).articles).toHaveLength(16);
  });

  it('uses the bounded sitemap index source and shared canonical adapter path', async () => {
    const requested: string[] = [];
    const definition = createIbiDefinition(async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes('GoogleSiteMapIndex.aspx')) return new Response('<sitemapindex><sitemap><loc>https://www.ibinews.com/googlesitemap.aspx?year=2026</loc></sitemap><sitemap><loc>https://www.ibinews.com/googlesitemap.aspx?year=2025</loc></sitemap></sitemapindex>', { status: 200 });
      if (url.includes('googlesitemap.aspx?year=2026')) return new Response('<urlset><url><loc>https://www.ibinews.com/news/ibi-relocates/56346.article</loc></url><url><loc>https://www.ibinews.com/news/ibi-relocates/56346.article?utm_source=fixture</loc></url></urlset>', { status: 200 });
      if (url.includes('googlesitemap.aspx?year=2025')) return new Response('<urlset><url><loc>https://www.ibinews.com/interactive-digital-editions/ibi-aug-sept-26-digital-issue/55788.article</loc></url><url><loc>https://www.ibinews.com/news/not-an-article</loc></url></urlset>', { status: 200 });
      const article = url.includes('56346.article') ? { title: 'IBI headquarters move', description: 'Materials', date: '2026-10-10' } : { title: 'IBI digital issue', description: 'Technology', date: '2026-10-09' };
      return new Response(`<html><head><meta property="og:title" content="${article.title}"><meta property="og:url" content="${url}"><meta property="description" content="${article.description}"><meta property="article:published_time" content="${article.date}"></head><body>${article.description}</body></html>`, { status: 200 });
    });
    const records = await definition.adapter.search({ publisherId: 'ibi', answers: {}, queryText: 'procurement', keywords: ['procurement'], interests: ['procurement'], personas: [] }, { limit: 30 });
    expect(requested.filter((url) => url.includes('/sitemap.xml'))).toHaveLength(0);
    expect(requested.filter((url) => url.includes('GoogleSiteMapIndex.aspx') || url.includes('googlesitemap.aspx'))).toHaveLength(3);
    expect(requested).toHaveLength(6);
    expect(requested.every((url) => !url.includes('/sitemap.xml'))).toBe(true);
    expect(records).toHaveLength(2);
    expect(definition.adapter.lastDiagnostics?.duplicates).toBe(1);
    expect(definition.adapter.normalizeArticle(records[0])).toMatchObject({ publisherId: 'ibi', title: 'IBI headquarters move' });
  });

  it('handles malformed, empty and subscriber-only listing/article pages safely', async () => {
    const empty = createIbiDefinition(async (input) => String(input).includes('GoogleSiteMapIndex.aspx') ? new Response('<sitemapindex></sitemapindex>', { status: 200 }) : new Response('<html><body>No stories here</body></html>', { status: 200 }));
    await expect(empty.adapter.search({ publisherId: 'ibi', answers: {}, queryText: '', keywords: [], interests: [], personas: [] }, { limit: 30 })).rejects.toMatchObject({ code: 'empty-source' });
    const subscriber = createIbiDefinition(async (input) => {
      const url = String(input);
      if (url.includes('GoogleSiteMapIndex.aspx')) return new Response('<sitemapindex><sitemap><loc>https://www.ibinews.com/googlesitemap.aspx?year=2026</loc></sitemap></sitemapindex>', { status: 200 });
      if (url.includes('googlesitemap.aspx')) return new Response('<urlset><url><loc>https://www.ibinews.com/news/subscriber-story/56346.article</loc></url></urlset>', { status: 200 });
      return new Response('<html><head><meta property="og:title" content="Subscriber-safe headline"><meta property="og:description" content="Public metadata only"><link rel="canonical" href="https://www.ibinews.com/news/subscriber-story/56346.article"></head><body>Subscriber-only</body></html>', { status: 200 });
    });
    const rows = await subscriber.adapter.search({ publisherId: 'ibi', answers: {}, queryText: '', keywords: [], interests: [], personas: [] }, { limit: 1 });
    expect(subscriber.adapter.normalizeArticle(rows[0])).toMatchObject({ title: 'Subscriber-safe headline', description: 'Public metadata only', url: 'https://www.ibinews.com/news/subscriber-story/56346.article' });
    expect(JSON.stringify(rows)).not.toContain('password');
  });

  it('produces meaningfully different role reports from the same IBI archive and focused theme results', async () => {
    const { service } = fixtureService();
    const procurement = await service.generate({ publisherId: 'ibi', companyUrl: 'sunseeker.com', jobTitle: 'Head of Procurement' });
    const engineering = await service.generate({ publisherId: 'ibi', companyUrl: 'sunseeker.com', jobTitle: 'Marine Engineer' });
    const leadership = await service.generate({ publisherId: 'ibi', companyUrl: 'princessyachts.example', jobTitle: 'Managing Director' });
    const sales = await service.generate({ publisherId: 'ibi', companyUrl: 'marine-industry.example', jobTitle: 'Sales Director' });
    expect(procurement.recommendations.length).toBeGreaterThan(0);
    expect(engineering.recommendations.length).toBeGreaterThan(0);
    expect(leadership.recommendations.length).toBeGreaterThan(0);
    expect(sales.recommendations.length).toBeGreaterThan(0);
    expect(procurement.recommendations[0].articleId).not.toBe(engineering.recommendations[0].articleId);
    expect(new Set(procurement.recommendations.map((item) => item.articleId))).not.toEqual(new Set(leadership.recommendations.map((item) => item.articleId)));
    const theme = procurement.professionalProfile.professionalInterests.find((value) => /supplier|procurement|sourcing|material/i.test(value)) ?? 'suppliers';
    const focused = await service.searchTheme(procurement, theme);
    expect(focused.length).toBeLessThanOrEqual(8);
    expect(focused.every((item) => !procurement.recommendations.some((existing) => existing.articleId === item.articleId))).toBe(true);
    expect(focused.some((item) => /supplier|material|component/i.test(`${item.article.title} ${item.article.description ?? ''}`))).toBe(true);
  });

  it('isolates IBI analytics and blocks generation while disabled without hiding saved reports', async () => {
    const analytics = new MemoryAnalyticsStore();
    const app = createProductionApp({ environment: 'test', analyticsStore: analytics });
    await app.publisherRuntime.ensureLoaded();
    app.registry.get('ibi')!.adapter = fixtureArticleAdapter();
    const generated = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'ibi', companyUrl: 'sunseeker.com', jobTitle: 'Head of Procurement' }) }));
    expect(generated.status).toBe(201);
    const { reportId } = await generated.json() as { reportId: string };
    const before = await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=ibi`));
    expect(before.status).toBe(200);
    app.registry.get('ibi')!.manifest!.enabled = false;
    const blocked = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'ibi', companyUrl: 'sunseeker.com', jobTitle: 'Marine Engineer' }) }));
    expect(blocked.status).toBe(404);
    expect((await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=ibi`))).status).toBe(200);
    const ibiEvents = await analytics.query({ publisherId: 'ibi' });
    const demoEvents = await analytics.query({ publisherId: 'demo' });
    expect(ibiEvents.length).toBeGreaterThan(0);
    expect(demoEvents).toEqual([]);
    app.registry.get('ibi')!.manifest!.enabled = true;
  });

  it('reports source failure without creating fabricated articles', async () => {
    const definition = createIbiDefinition(async () => new Response('upstream unavailable', { status: 503 }));
    const health = await definition.adapter.healthCheck();
    expect(health).toMatchObject({ publisherId: 'ibi', sourceType: 'sitemap', reachable: false, recordsChecked: 0, normalized: 0 });
  });
});
