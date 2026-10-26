import { describe, expect, it } from 'vitest';
import { collapseNearDuplicates, isNearDuplicate } from '../src/reports/near-duplicates';

const item = (id: string, title: string, publishedAt: string, deterministicScore = 50, relevanceType: 'direct' | 'adjacent' = 'direct') => ({ article: { id, title, publishedAt }, deterministicScore, relevanceType });

describe('near-duplicate stories', () => {
  it('matches the same company story and the same recurring series', () => {
    expect(isNearDuplicate("Misto's sustainability report", 'Misto Holdings 2025 sustainability report')).toBe(true);
    expect(isNearDuplicate('Market Analysis: the global athletic apparel market in 2024', 'Market Analysis: athletic apparel market grows 7% in 2025')).toBe(true);
  });

  it('keeps distinct stories apart', () => {
    expect(isNearDuplicate('Nike launches running shoe', 'Nike recalls running shoe')).toBe(false);
    expect(isNearDuplicate('Market Analysis: the global running footwear market', 'Market Analysis: athletic apparel market')).toBe(false);
    expect(isNearDuplicate('Puma sustainability report', 'Adidas sustainability report')).toBe(false);
    expect(isNearDuplicate('Interview: Puma sustainability report', 'Market Analysis: Puma sustainability report')).toBe(false);
    expect(isNearDuplicate('Fabletics opens 20 stores', 'Fabletics store expansion')).toBe(false);
  });

  it('keeps the more recent story in the better-ranked slot unless the older one is clearly stronger', () => {
    const ranked = [
      item('market-2024', 'Market Analysis: the global athletic apparel market', '2025-03-01T00:00:00Z', 62),
      item('fabletics', 'Fabletics opens 20 new stores', '2026-06-01T00:00:00Z', 58),
      item('market-2025', 'Market Analysis: athletic apparel market grows 7%', '2026-03-01T00:00:00Z', 55),
      item('misto-old', "Misto's sustainability report", '2025-05-01T00:00:00Z', 70),
      item('misto-new', 'Misto Holdings 2025 sustainability report', '2026-05-01T00:00:00Z', 40),
    ];
    const result = collapseNearDuplicates(ranked);
    expect(result.kept.map((entry) => entry.article.id)).toEqual(['market-2025', 'fabletics', 'misto-old']);
    expect(result.collapsed).toEqual([{ removedId: 'market-2024', keptId: 'market-2025' }, { removedId: 'misto-new', keptId: 'misto-old' }]);
  });

  it('prefers a direct older story over an adjacent newer one and leaves unique lists unchanged', () => {
    const result = collapseNearDuplicates([item('old', 'Misto sustainability report', '2024-01-01T00:00:00Z', 40, 'direct'), item('new', 'Misto Holdings sustainability report', '2026-01-01T00:00:00Z', 45, 'adjacent')]);
    expect(result.kept.map((entry) => entry.article.id)).toEqual(['old']);
    const unique = [item('a', 'Fabletics opens stores', '2026-01-01T00:00:00Z'), item('b', 'ANTA multi-brand strategy', '2026-01-01T00:00:00Z')];
    expect(collapseNearDuplicates(unique)).toEqual({ kept: unique, collapsed: [] });
  });
});

describe('figures in titles', () => {
  it('treats different non-year figures as different stories', () => {
    expect(isNearDuplicate('Nike opens 12 retail stores in Europe', 'Nike opens 20 retail stores in Europe')).toBe(false);
    expect(isNearDuplicate('Misto 2024 sustainability report', 'Misto 2025 sustainability report')).toBe(true);
  });
});

describe('report generation', () => {
  it('collapses near-duplicates before the AI calls and logs duplicates_collapsed', async () => {
    const { createProductionApp } = await import('../src/server/production');
    const { sgiEuropeManifest } = await import('../src/publishers/sgi-europe');
    const { MemoryPublisherStore } = await import('../src/publishers/store');
    const titles = ['Misto sustainability report sets retail store targets', 'Misto Holdings 2026 sustainability report sets retail store targets', 'Adidas opens retail stores in Paris', 'JD Sports expands retail stores', 'Puma adds omnichannel retail stores'];
    const item = (title: string, index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/d-${index}/15000${index}.article</link><guid>https://www.sgieurope.com/retail/d-${index}/15000${index}.article</guid><description>${title}: retail stores and omnichannel distribution.</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map(item).join('')}</channel></rss>`;
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const app = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const reported = (await app.reportStore.get(reportId, 'sgi-europe'))!.recommendations.map((recommendation) => recommendation.article.title);
    expect(reported.filter((title) => title.startsWith('Misto'))).toEqual(['Misto Holdings 2026 sustainability report sets retail store targets']);
    expect(logs.find((entry) => entry.message === 'duplicates_collapsed')?.fields).toMatchObject({ duplicatesCollapsed: 1 });
  });
});

describe('production false positives', () => {
  it('never collapses stories that name different partner companies', () => {
    expect(isNearDuplicate('Nike and Syre partner on circular polyester', 'Nike and Loop Industries partner on circular polyester')).toBe(false);
    expect(isNearDuplicate('Nike scales circular polyester with Syre', 'Nike scales circular polyester with Loop Industries')).toBe(false);
    // Named in one title only: the counterparty must match when one is named.
    expect(isNearDuplicate('Nike scales circular polyester with Syre', 'Nike scales circular polyester')).toBe(false);
    // The same partner named in both is still one story.
    expect(isNearDuplicate('Nike and Syre partner on circular polyester', 'Nike and Syre extend circular polyester partnership')).toBe(true);
  });

  it('collapses a market series only for the same market noun', () => {
    expect(isNearDuplicate('Market Analysis: the global athletic footwear market', 'Market Analysis: athletic apparel market grows 7% in 2025')).toBe(false);
    expect(isNearDuplicate('Market Analysis: the global athletic footwear market', 'Market Analysis: the global athletic apparel market')).toBe(false);
    expect(isNearDuplicate('Market Analysis: the global athletic footwear market in 2024', 'Market Analysis: the global athletic footwear market in 2025')).toBe(true);
    expect(isNearDuplicate('Market Analysis: the global sports apparel market', 'Market Analysis: athletic apparel market grows 7% in 2025')).toBe(false);
    expect(isNearDuplicate('Market Analysis: the global athletic apparel market', 'Market Analysis: athletic apparel market grows 7% in 2025')).toBe(true);
  });
});
