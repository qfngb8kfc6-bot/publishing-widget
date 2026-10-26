import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, createProfessionalScorer, LeadMatchIndex, normalizeToken, professionalFieldIndexes, type NormalizedArticle } from '../src/core';
import { MemoryCatalogueSnapshotStore, PublisherCatalogueCache, type LeadExcerptSource } from '../src/reports';
import { company } from './ranking-fixtures';

const LEAD_MARKER = 'lead-only-marker';

function article(code: number, title: string, description: string): NormalizedArticle {
  return { id: `sgi-${code}`, title, description, url: `https://www.sgieurope.com/business/story/${code}.article`, categories: ['Business'], tags: [], publisherId: 'sgi-europe', publishedAt: '2026-09-01T00:00:00.000Z' };
}

function leadSource(texts: Record<string, string>, calls: string[] = []): LeadExcerptSource {
  return {
    covers: (publisherId) => publisherId === 'sgi-europe',
    page: async (_publisherId, after, limit) => { calls.push(`page:${after}`); return Object.keys(texts).filter((code) => code > after).sort().slice(0, limit).map((storyCode) => ({ storyCode, lead: texts[storyCode] })); },
    forStoryCodes: async (_publisherId, codes) => { calls.push(`codes:${codes.join(',')}`); return codes.filter((code) => texts[code]).map((storyCode) => ({ storyCode, lead: texts[storyCode] })); },
  };
}

describe('lead excerpt match index', () => {
  it('matches tokens, five-character prefixes and adjacent phrases, and keeps no text', () => {
    const index = new LeadMatchIndex(`The retailer said its supply chain for footwear was diversified, with sourcing moved to Vietnam. ${LEAD_MARKER}`);
    expect(index.matches('footwear')).toBe(true);
    expect(index.matches('sourcing')).toBe(true);
    expect(index.matches('diversification')).toBe(true);
    expect(index.matches(normalizeToken('supply chain'))).toBe(true);
    expect(index.matches(normalizeToken('chain supply'))).toBe(false);
    expect(index.matches(normalizeToken('footwear sourcing'))).toBe(false);
    expect(index.matches('apparel')).toBe(false);
    expect(new LeadMatchIndex('Return on investment rose').matches(normalizeToken('return on investment'))).toBe(true);
    expect(JSON.stringify(Object.values(index))).not.toContain('footwear');
    expect(index.size).toBeLessThan(60);
  });

  it('changes nothing without a lead, and a lead only boosts articles that already have evidence', () => {
    const profile = buildProfessionalProfile(company('nike.com', 'Nike', 'sportswear', ['footwear', 'apparel']), 'Head of Procurement');
    const score = createProfessionalScorer(profile);
    const onTopic = article(1, 'Brand reviews supplier base', 'The company outlined procurement changes for next season.');
    const offTopic = article(2, 'Trade fair dates announced', 'Organisers confirmed the venue for the next edition.');
    const lead = new LeadMatchIndex('Procurement teams are consolidating suppliers, renegotiating sourcing contracts and moving manufacturing to reduce supply chain risk and costs for vendors.');
    const plainOnTopic = score(onTopic, professionalFieldIndexes(onTopic));
    expect(score(onTopic)).toEqual(plainOnTopic);
    const boosted = score(onTopic, { ...professionalFieldIndexes(onTopic), lead });
    expect(boosted.score).toBeGreaterThan(plainOnTopic.score);
    expect(boosted.relevanceType).toBe('direct');
    expect(boosted.directMatches).toEqual(expect.arrayContaining([...(plainOnTopic.directMatches ?? []), 'sourcing']));
    // Lead-only evidence adds nothing, so it can never crowd real candidates out of preselection.
    expect(score(offTopic, { ...professionalFieldIndexes(offTopic), lead })).toEqual(score(offTopic, professionalFieldIndexes(offTopic)));
  });
});

describe('catalogue lead loading', () => {
  it('attaches leads in the background from the store, joined on story code, and never writes them to the snapshot', async () => {
    const snapshots = new MemoryCatalogueSnapshotStore();
    const calls: string[] = [];
    const cache = new PublisherCatalogueCache({ ttlMs: 60_000, snapshotStore: snapshots, leadExcerpts: leadSource({ '101': `supply chain sourcing ${LEAD_MARKER}`, '999': 'not in the catalogue' }, calls) });
    const articles = [article(101, 'One', 'First'), article(102, 'Two', 'Second')];
    const loaded = await cache.get('sgi-europe', 'key', async () => ({ articles }));
    await cache.idle();
    expect(loaded.index.leadCount).toBe(1);
    expect(loaded.index.professionalFields(loaded.articles[0]).lead?.matches('sourcing')).toBe(true);
    expect(loaded.index.professionalFields(loaded.articles[1]).lead).toBeUndefined();
    expect(calls).toEqual(['page:']);
    expect(JSON.stringify(await snapshots.get('sgi-europe', 'key'))).not.toContain(LEAD_MARKER);
  });

  it('reuses leads across a refresh, reads only codes without one, and applies sync updates', async () => {
    let now = 0;
    const texts: Record<string, string> = { '101': 'supply chain sourcing' };
    const calls: string[] = [];
    const cache = new PublisherCatalogueCache({ ttlMs: 100, maxStaleMs: 10_000, now: () => now, leadExcerpts: leadSource(texts, calls) });
    const load = (codes: number[]) => async () => ({ articles: codes.map((code) => article(code, `Story ${code}`, 'Description')) });
    await cache.get('sgi-europe', 'key', load([101, 102]));
    await cache.idle();
    texts['102'] = 'tariffs on footwear';
    now = 200;
    await cache.get('sgi-europe', 'key', load([101, 102, 103]));
    await cache.idle();
    const refreshed = await cache.get('sgi-europe', 'key', load([101, 102, 103]));
    expect(calls).toEqual(['page:', 'codes:102,103']);
    expect(refreshed.index.leadCount).toBe(2);
    texts['101'] = 'apparel margins';
    await cache.updateLeads('sgi-europe', ['101', '555']);
    expect(calls.at(-1)).toBe('codes:101');
    expect(refreshed.index.professionalFields(refreshed.articles[0]).lead?.matches('apparel')).toBe(true);
  });

  it('leaves publishers without an enrichment source untouched', async () => {
    const calls: string[] = [];
    const cache = new PublisherCatalogueCache({ leadExcerpts: leadSource({ '101': 'text' }, calls) });
    const loaded = await cache.get('ibi', 'key', async () => ({ articles: [{ ...article(101, 'IBI', 'Boat'), publisherId: 'ibi' }] }));
    await cache.idle();
    expect(calls).toEqual([]);
    expect(loaded.index.leadCount).toBe(0);
  });
});
