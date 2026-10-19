import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, createProfessionalScorer, type Intent, type NormalizedArticle } from '../src/core';
import { feedPreselectionScores } from '../src/publishers/content/adapters';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import { MemoryCatalogueSnapshotStore, profileForTheme, PublisherCatalogueCache } from '../src/reports';
import { company, normalizedCatalogue, syntheticArchive } from './ranking-fixtures';

function article(publisherId: string, id: string): NormalizedArticle {
  return { id, title: `Nike opens retail stores ${id}`, description: 'Omnichannel distribution', url: `https://www.sgieurope.com/${id}.article`, categories: ['Retail'], tags: [], publisherId };
}

/** Each load returns fresh article objects, as a real source refresh does. */
function loader(publisherId: string, ids = ['one', 'two']) {
  let loads = 0;
  return {
    load: async () => { loads += 1; return { articles: ids.map((id) => article(publisherId, id)) }; },
    get loads() { return loads; },
  };
}

describe('catalogue article index', () => {
  it('builds each article index once and reuses it across warm requests', async () => {
    const cache = new PublisherCatalogueCache({ ttlMs: 10_000 });
    const source = loader('sgi-europe');
    const first = await cache.get('sgi-europe', 'key', source.load);
    const second = await cache.get('sgi-europe', 'key', source.load);
    expect(source.loads).toBe(1);
    expect(second.index).toBe(first.index);
    const [target] = first.articles;
    expect(second.index.preselectionFields(target)).toBe(first.index.preselectionFields(target));
    expect(second.index.professionalFields(target)).toBe(first.index.professionalFields(target));
    expect(first.index.indexedCounts).toMatchObject({ preselection: 1, professional: 1 });
  });

  it('drops the index when the catalogue refreshes, the source key changes or the publisher is invalidated', async () => {
    let now = 0;
    const cache = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 1_000, now: () => now });
    const source = loader('sgi-europe');
    const original = await cache.get('sgi-europe', 'key', source.load);

    now = 5_000; // beyond max staleness: foreground refresh
    const refreshed = await cache.get('sgi-europe', 'key', source.load);
    expect(refreshed.index).not.toBe(original.index);
    expect(refreshed.articles[0]).not.toBe(original.articles[0]);

    now = 5_150; // stale: served from the old entry while a background refresh runs
    const stale = await cache.get('sgi-europe', 'key', source.load);
    expect(stale.index).toBe(refreshed.index);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterBackground = await cache.get('sgi-europe', 'key', source.load);
    expect(afterBackground.index).not.toBe(refreshed.index);

    const changedSource = await cache.get('sgi-europe', 'new-source-config', source.load);
    expect(changedSource.index).not.toBe(afterBackground.index);

    cache.invalidatePublisher('sgi-europe');
    const invalidated = await cache.get('sgi-europe', 'new-source-config', source.load);
    expect(invalidated.index).not.toBe(changedSource.index);
  });

  it('builds a fresh index for a catalogue hydrated from a persisted snapshot', async () => {
    const snapshots = new MemoryCatalogueSnapshotStore();
    const first = new PublisherCatalogueCache({ ttlMs: 10_000, snapshotStore: snapshots });
    const source = loader('sgi-europe');
    const original = await first.get('sgi-europe', 'key', source.load);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restarted = new PublisherCatalogueCache({ ttlMs: 10_000, snapshotStore: snapshots });
    const hydrated = await restarted.get('sgi-europe', 'key', source.load);
    expect(hydrated.diagnostics.catalogueRefreshReason).toBe('snapshot');
    expect(hydrated.index).not.toBe(original.index);
    const [target] = hydrated.articles;
    expect(hydrated.index.preselectionFields(target)).toBe(hydrated.index.preselectionFields(target));
  });

  it('keeps indexes tenant-isolated even for identical article content', async () => {
    const cache = new PublisherCatalogueCache({ ttlMs: 10_000 });
    const sgi = await cache.get('sgi-europe', 'key', loader('sgi-europe').load);
    const ibi = await cache.get('ibi', 'key', loader('ibi').load);
    expect(ibi.index).not.toBe(sgi.index);
    const foreign = ibi.articles[0];
    // Another tenant's article is scored correctly but never stored in this tenant's index.
    const intent: Intent = { publisherId: 'sgi-europe', answers: {}, queryText: 'retail stores', keywords: ['retail', 'stores', 'omnichannel'], interests: ['distribution'], personas: [] };
    expect(feedPreselectionScores([foreign], intent, sgi.index.preselectionFields)).toEqual(feedPreselectionScores([foreign], intent, ibi.index.preselectionFields));
    expect(sgi.index.preselectionFields(foreign)).not.toBe(sgi.index.preselectionFields(foreign));
    expect(sgi.index.professionalFields(foreign)).not.toBe(sgi.index.professionalFields(foreign));
    expect(sgi.index.indexedCounts).toEqual({ preselection: 0, professional: 0, dictionary: 0 });
  });

  it('produces exactly the same preselection and professional scores with or without cached indexes', async () => {
    const cache = new PublisherCatalogueCache({ ttlMs: 10_000 });
    for (const xml of [sgiEuropeRssFixture, syntheticArchive(600)]) {
      const { articles } = await normalizedCatalogue(xml);
      cache.invalidatePublisher('sgi-europe');
      const { index } = await cache.get('sgi-europe', 'key', async () => ({ articles }));
      const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', ['retail']), 'Head of Retail');
      const intent: Intent = { publisherId: 'sgi-europe', answers: { companyUrl: profile.companyUrl, jobTitle: profile.jobTitle }, queryText: profile.semanticQueries.join(' '), keywords: profile.searchTerms, interests: profile.professionalInterests, personas: [profile.role.function], directInterests: profile.directInterests, adjacentInterests: profile.adjacentInterests, excludedConcepts: ['esports', 'fantasy'] };
      expect(feedPreselectionScores(articles, intent, index.preselectionFields)).toEqual(feedPreselectionScores(articles, intent));
      for (const scored of [profile, profileForTheme(profile, 'stores')]) {
        const scorer = createProfessionalScorer(scored);
        expect(articles.map((item) => scorer(item, index.professionalFields(item)))).toEqual(articles.map((item) => scorer(item)));
      }
    }
  });
});
