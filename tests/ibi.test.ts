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
    if (url.endsWith('/sitemap.xml')) {
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
  it('normalizes stable IDs, canonical URLs, provenance and rejects malformed records', () => {
    const first = normalizeIbiArticle(ibiFixtureArticles[0]);
    const duplicate = normalizeIbiArticle(ibiFixtureArticles.find((article) => article.id === 'ibi-fixture-duplicate'));
    expect(first).toMatchObject({ id: 'ibi-fixture-materials', externalId: 'ibi-fixture-materials', publisherId: 'ibi', sourceType: 'sitemap', canonicalUrl: 'https://www.ibinews.com/ibi-fixture/materials.article' });
    expect(first?.provenance).toMatchObject({ publisherId: 'ibi', sourceArticleId: 'ibi-fixture-materials', retrievalSource: 'IBI News public sitemap' });
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

  it('uses the bounded sitemap source and shared canonical adapter path', async () => {
    let requested = 0;
    const definition = createIbiDefinition(async (input) => {
      requested += 1;
      const url = String(input);
      if (url.endsWith('/sitemap.xml')) return new Response('<urlset><url><loc>https://www.ibinews.com/ibi-fixture/materials.article</loc></url><url><loc>https://www.ibinews.com/ibi-fixture/materials.article?utm_source=fixture</loc></url></urlset>', { status: 200 });
      return new Response('<html><head><meta property="og:title" content="IBI fixture article"><meta property="og:url" content="https://www.ibinews.com/ibi-fixture/materials.article"><meta property="description" content="Materials"></head></html>', { status: 200 });
    });
    const records = await definition.adapter.search({ publisherId: 'ibi', answers: {}, queryText: 'procurement', keywords: ['procurement'], interests: ['procurement'], personas: [] }, { limit: 30 });
    expect(requested).toBe(3);
    expect(records).toHaveLength(1);
    expect(definition.adapter.normalizeArticle(records[0])).toMatchObject({ publisherId: 'ibi', title: 'IBI fixture article' });
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
