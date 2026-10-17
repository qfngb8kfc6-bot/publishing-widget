import { describe, expect, it } from 'vitest';
import { PublisherCatalogueCache } from '../src/reports/catalogue-cache';
import { MemoryCatalogueSnapshotStore } from '../src/reports/catalogue-snapshot';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore } from '../src/publishers/store';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import type { FeedSourceConfig } from '../src/publishers/content';
import { MemoryReportStore, ReportGenerationService } from '../src/reports';
import { PublisherRegistry, DeterministicExplanationProvider, type NormalizedArticle, type PublisherAdapter, type Intent } from '../src/core';
import { manifestToPublisherConfig } from '../src/publishers/manifest';
import { demoManifest } from '../src/demo/config';

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
    expect(refreshed.diagnostics).toMatchObject({ catalogueCacheHit: true, catalogueRefreshReason: 'stale', catalogueStale: true });
    expect(loads).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await load('sgi-europe')).diagnostics.catalogueRefreshReason).toBe('warm');
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
    expect(events.filter((event) => event.message === 'report_performance')).toHaveLength(2);
    expect(events.filter((event) => event.message === 'theme_performance')).toHaveLength(1);
    expect(themeResponse.headers.get('Server-Timing')).toContain('catalogue;dur=');
    const secondRecord = await app.reportStore.get(secondReport.reportId, 'sgi-europe');
    expect(secondRecord?.recommendations.map((item) => item.articleId)).toEqual(report?.recommendations.map((item) => item.articleId));

    await app.publisherRuntime.update({ ...sgiEuropeManifest, publisherConfigVersion: '2', contentSource: { ...(sgiEuropeManifest.contentSource as FeedSourceConfig), feedUrl: 'https://www.sgieurope.com/9871.rss?adredir=2' } });
    const afterConfigChange = await generate();
    expect(afterConfigChange.status).toBe(201);
    expect(fetches).toBe(2);
  });

  it('hydrates a new process from a persisted snapshot and refreshes stale data without blocking', async () => {
    let now = 1_000;
    let loads = 0;
    const snapshots = new MemoryCatalogueSnapshotStore();
    const first = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 10_000, now: () => now, snapshotStore: snapshots });
    await first.get('sgi-europe', 'feed-v1', async () => { loads += 1; return { articles: [article('sgi-europe', 'cached')] }; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const warmRestart = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 10_000, now: () => now + 50, snapshotStore: snapshots });
    const hydrated = await warmRestart.get('sgi-europe', 'feed-v1', async () => { loads += 1; return { articles: [article('sgi-europe', 'unexpected-refresh')] }; });
    expect(hydrated.articles[0]?.id).toBe('cached');
    expect(hydrated.diagnostics.catalogueRefreshReason).toBe('snapshot');
    expect(loads).toBe(1);
    const restarted = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 10_000, now: () => now + 500, snapshotStore: snapshots });
    const stale = await restarted.get('sgi-europe', 'feed-v1', async () => { loads += 1; return { articles: [article('sgi-europe', 'refreshed')] }; });
    expect(stale.articles[0]?.id).toBe('cached');
    expect(stale.diagnostics.catalogueRefreshReason).toBe('snapshot');
    expect(stale.diagnostics.catalogueStale).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(2);
    expect((await restarted.get('sgi-europe', 'feed-v1', async () => { loads += 1; return { articles: [] }; })).articles[0]?.id).toBe('refreshed');
  });

  it('keeps last-known-good data when an expired background refresh fails', async () => {
    let now = 1_000;
    const errors: unknown[] = [];
    let shouldFail = false;
    const cache = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 10_000, now: () => now, onRefreshError: (_publisherId, error) => errors.push(error) });
    await cache.get('sgi-europe', 'feed-v1', async () => ({ articles: [article('sgi-europe', 'known-good')] }));
    now += 101;
    shouldFail = true;
    const result = await cache.get('sgi-europe', 'feed-v1', async () => { if (shouldFail) throw new Error('upstream_failed'); return { articles: [] }; });
    expect(result.articles[0]?.id).toBe('known-good');
    expect(result.diagnostics.catalogueStale).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('keeps 11,000-article report/theme work on one bounded normalized catalogue', async () => {
    const articles: NormalizedArticle[] = Array.from({ length: 11_000 }, (_, index) => ({
      id: `scale-${index}`,
      title: index < 200 ? `Software engineering platform article ${index}` : `Archive article ${index}`,
      url: `https://scale.example/articles/${index}`,
      publisherId: 'scale-publisher',
      categories: [],
      tags: [],
      sourceType: 'synthetic',
    }));
    let loads = 0;
    const logs: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const registry = new PublisherRegistry();
    const manifest = { ...demoManifest, publisherId: 'scale-publisher', name: 'Scale Publisher', contentSource: { type: 'static-demo' as const } };
    const scaleAdapter = {
      publisherId: 'scale-publisher',
      loadCatalogue: async () => { loads += 1; return articles; },
      selectCatalogue: (catalogue: NormalizedArticle[], _intent: Intent, options: { limit: number; archiveWide?: boolean }) => options.archiveWide ? catalogue : catalogue.slice(0, 100),
      search: async () => articles.slice(0, 100),
      normalizeArticle: (raw) => raw as NormalizedArticle,
    } as PublisherAdapter & { loadCatalogue: () => Promise<unknown[]>; selectCatalogue: (articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean }) => NormalizedArticle[] };
    registry.register({ config: manifestToPublisherConfig(manifest), manifest, explanationProvider: new DeterministicExplanationProvider(), adapter: scaleAdapter });
    const companyProvider = { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Scale Co', industry: 'technology', description: 'Scale fixture.', topics: ['technology'], entities: ['Scale Co'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) };
    const service = new ReportGenerationService(registry, companyProvider, new MemoryReportStore(), undefined, undefined, { info: (message, fields) => logs.push({ message, fields: fields as Record<string, unknown> }), error: () => undefined }, undefined, undefined, new PublisherCatalogueCache({ ttlMs: 3_600_000 }));
    const report = await service.generate({ publisherId: 'scale-publisher', companyUrl: 'scale.example', jobTitle: 'Software Engineer' });
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(loads).toBe(1);
    const theme = report.professionalProfile.professionalInterests[0] ?? 'technology';
    for (let index = 0; index < 4; index += 1) {
      const recommendations = await service.searchTheme(report, theme);
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.every((item) => !report.recommendations.some((existing) => existing.articleId === item.articleId))).toBe(true);
    }
    expect(loads).toBe(1);
    const themeDiagnostics = logs.filter((entry) => entry.message === 'theme_retrieval_diagnostics');
    expect(themeDiagnostics).toHaveLength(4);
    expect(themeDiagnostics.every((entry) => entry.fields?.catalogueCacheHit === true)).toBe(true);
    expect(themeDiagnostics.every((entry) => Number(entry.fields?.preselectionOutputCount ?? Infinity) <= 100)).toBe(true);
    expect(themeDiagnostics.every((entry) => entry.fields?.catalogueItemCount === 11_000)).toBe(true);
  }, 30_000);
});
