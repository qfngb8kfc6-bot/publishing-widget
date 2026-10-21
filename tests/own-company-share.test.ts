import { describe, expect, it } from 'vitest';
import { limitOwnCompanyShare } from '../src/reports/relationship';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const own = (id: string) => ({ id, own: true });
const other = (id: string) => ({ id, own: false });
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe('limitOwnCompanyShare', () => {
  it('holds own-company items to about 60% when alternatives exist, keeping rank order', () => {
    const ranked = [own('n1'), own('n2'), own('n3'), own('n4'), own('n5'), own('n6'), own('n7'), own('n8'), other('o1'), other('o2'), other('o3'), other('o4')];
    const { selected, deferred } = limitOwnCompanyShare(ranked, 8, (item) => item.own);
    expect(ids(selected)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'o1', 'o2', 'o3']);
    expect(deferred).toBe(3);
  });

  it('never lowers the bar: own-company items fill slots when there are not enough alternatives', () => {
    const ranked = [own('n1'), own('n2'), own('n3'), own('n4'), own('n5'), own('n6'), own('n7'), own('n8'), other('o1')];
    const { selected, deferred } = limitOwnCompanyShare(ranked, 8, (item) => item.own);
    expect(ids(selected)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'o1']);
    expect(deferred).toBe(1);
    expect(ids(limitOwnCompanyShare([own('n1'), own('n2')], 8, (item) => item.own).selected)).toEqual(['n1', 'n2']);
  });

  it('is a plain top-N when the share is already within the cap', () => {
    const ranked = [other('o1'), own('n1'), other('o2'), own('n2'), other('o3')];
    expect(limitOwnCompanyShare(ranked, 4, (item) => item.own)).toEqual({ selected: ranked.slice(0, 4), deferred: 0 });
  });
});

describe('main report own-company share', () => {
  const item = (title: string, index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${index}/14000${index}.article</link><guid>https://www.sgieurope.com/retail/s-${index}/14000${index}.article</guid><description>${title}: retail stores and omnichannel distribution.</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;
  async function report(titles: string[]) {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map(item).join('')}</channel></rss>`;
    const app = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const stored = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    return { titles: stored.recommendations.map((recommendation) => recommendation.article.title), log: logs.find((entry) => entry.message === 'own_company_share')?.fields };
  }

  it('makes room for qualifying articles about other companies and logs the share', async () => {
    const nike = Array.from({ length: 10 }, (_, index) => `Nike opens retail stores in city ${index}`);
    const others = ['Adidas opens retail stores in Paris', 'JD Sports expands retail stores', 'Puma adds omnichannel retail stores', 'Decathlon tests retail stores lockers'];
    const { titles, log } = await report([...nike, ...others]);
    const ownCount = titles.filter((title) => title.startsWith('Nike')).length;
    expect(titles.length).toBeGreaterThan(4);
    expect(ownCount / titles.length).toBeLessThanOrEqual(0.63);
    expect(titles.filter((title) => others.includes(title))).toHaveLength(titles.length - ownCount);
    expect(titles.length - ownCount).toBeGreaterThanOrEqual(3);
    expect(log).toMatchObject({ ownCompanyCount: ownCount, recommendationCount: titles.length, ownCompanyShare: Number((ownCount / titles.length).toFixed(2)) });
    expect(log!.ownCompanyDeferred).toBeGreaterThan(0);
  });

  it('keeps own-company articles when nothing else qualifies', async () => {
    const { titles, log } = await report(Array.from({ length: 10 }, (_, index) => `Nike opens retail stores in city ${index}`));
    expect(titles.length).toBeGreaterThan(4);
    expect(titles.every((title) => title.startsWith('Nike'))).toBe(true);
    expect(log).toMatchObject({ ownCompanyShare: 1, ownCompanyDeferred: 0 });
  });
});
