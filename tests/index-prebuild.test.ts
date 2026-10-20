import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, createProfessionalScorer, type Intent, type NormalizedArticle } from '../src/core';
import { feedPreselectionScores } from '../src/publishers/content/adapters';
import { CatalogueArticleIndex, MemoryCatalogueSnapshotStore, profileForTheme, PublisherCatalogueCache, type IndexPrebuildStats } from '../src/reports';
import { createProductionApp } from '../src/server/production';
import { company, normalizedCatalogue, syntheticArchive } from './ranking-fixtures';

const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', ['retail']), 'Head of Retail');
const intent: Intent = { publisherId: 'sgi-europe', answers: { companyUrl: profile.companyUrl, jobTitle: profile.jobTitle }, queryText: profile.semanticQueries.join(' '), keywords: profile.searchTerms, interests: profile.professionalInterests, personas: [profile.role.function], directInterests: profile.directInterests, adjacentInterests: profile.adjacentInterests, excludedConcepts: ['esports'] };

/** A clock that advances one millisecond per read, so slices end deterministically. */
function steppingClock(): () => number {
  let now = 0;
  return () => (now += 1);
}

function scores(articles: NormalizedArticle[], index?: CatalogueArticleIndex) {
  const scorer = createProfessionalScorer(profileForTheme(profile, 'stores'));
  return {
    preselection: feedPreselectionScores(articles, intent, index?.preselectionFields),
    professional: articles.map((article) => scorer(article, index?.professionalFields(article))),
  };
}

describe('background index prebuild', () => {
  it('builds both index kinds for every article in slices that yield to the event loop', async () => {
    const { articles } = await normalizedCatalogue(syntheticArchive(300));
    const index = new CatalogueArticleIndex(articles);
    let yields = 0;
    const stats = await index.prebuild({ sliceMs: 10, clock: steppingClock(), yieldToEventLoop: async () => { yields += 1; } });
    expect(stats).toMatchObject({ articleCount: 300, indexedArticles: 300, cancelled: false });
    expect(stats.slices).toBeGreaterThan(10);
    expect(yields).toBe(stats.slices - 1);
    expect(index.indexedCounts).toMatchObject({ preselection: 300, professional: 300 });
  });

  it('gives a request arriving mid-build exactly the results of a fresh computation', async () => {
    const { articles } = await normalizedCatalogue(syntheticArchive(400));
    const expected = scores(articles);
    const index = new CatalogueArticleIndex(articles);
    let releaseFirstYield: () => void = () => undefined;
    let firstYield = true;
    const prebuild = index.prebuild({ sliceMs: 20, clock: steppingClock(), yieldToEventLoop: () => (firstYield ? (firstYield = false, new Promise<void>((resolve) => { releaseFirstYield = resolve; })) : Promise.resolve()) });
    await Promise.resolve();
    const partial = index.indexedCounts.preselection;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(articles.length);
    // A request runs while the prebuild is paused: it reuses built entries and builds the rest itself.
    expect(scores(articles, index)).toEqual(expected);
    releaseFirstYield();
    await prebuild;
    expect(index.indexedCounts).toMatchObject({ preselection: 400, professional: 400 });
    expect(scores(articles, index)).toEqual(expected);
  });

  it('starts after a source load and after snapshot hydration, and reports each completed build', async () => {
    const { articles } = await normalizedCatalogue(syntheticArchive(120));
    const completed: Array<IndexPrebuildStats & { publisherId: string; trigger: string }> = [];
    const snapshots = new MemoryCatalogueSnapshotStore();
    const options = { ttlMs: 60_000, snapshotStore: snapshots, prebuildIndexes: { sliceMs: 2 }, onIndexPrebuilt: (publisherId: string, stats: IndexPrebuildStats & { trigger: string }) => completed.push({ ...stats, publisherId }) };
    const loaded = await new PublisherCatalogueCache(options).get('sgi-europe', 'key', async () => ({ articles }));
    await waitFor(() => completed.length === 1);
    expect(completed[0]).toMatchObject({ publisherId: 'sgi-europe', trigger: 'load', articleCount: 120, indexedArticles: 120 });
    expect(loaded.index.indexedCounts).toMatchObject({ preselection: 120, professional: 120 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hydrated = await new PublisherCatalogueCache(options).get('sgi-europe', 'key', async () => { throw new Error('should hydrate from the snapshot'); });
    await waitFor(() => completed.length === 2);
    expect(hydrated.diagnostics.catalogueRefreshReason).toBe('snapshot');
    expect(completed[1]).toMatchObject({ trigger: 'snapshot', articleCount: 120 });
  });

  it('cancels the prebuild of a catalogue version that has been replaced', async () => {
    const { articles } = await normalizedCatalogue(syntheticArchive(200));
    const completed: string[] = [];
    const cache = new PublisherCatalogueCache({ ttlMs: 60_000, prebuildIndexes: { sliceMs: 1 }, onIndexPrebuilt: (_publisherId, stats) => completed.push(`${stats.trigger}:${stats.articleCount}`) });
    const first = await cache.get('sgi-europe', 'old-source', async () => ({ articles }));
    const replacement = articles.slice(0, 50).map((article) => ({ ...article }));
    await cache.get('sgi-europe', 'new-source', async () => ({ articles: replacement }));
    await waitFor(() => completed.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completed).toEqual(['load:50']);
    expect(first.index.indexedCounts.preselection).toBeLessThan(200);
  });
});

describe('production prebuild and prewarm', () => {
  it('prewarms archive catalogues without a request and logs index_prebuild_complete', async () => {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    let fetches = 0;
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: {},
      fetchImpl: async () => { fetches += 1; return new Response(syntheticArchive(80), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }); },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const warmed = await app.prewarmCatalogues();
    expect(warmed).toContain('sgi-europe');
    expect(fetches).toBeGreaterThan(0);
    await waitFor(() => logs.some((entry) => entry.message === 'index_prebuild_complete' && entry.fields.publisherId === 'sgi-europe'));
    expect(logs.find((entry) => entry.message === 'index_prebuild_complete' && entry.fields.publisherId === 'sgi-europe')?.fields).toMatchObject({ stage: 'load', articleCount: 80, durationMs: expect.any(Number), busyMs: expect.any(Number), slices: expect.any(Number) });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
