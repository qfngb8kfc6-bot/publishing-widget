import { describe, expect, it } from 'vitest';
import { buildCompanyNameIndex, oneEditApart, suggestCompany } from '../src/reports/company-suggestion';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';

const titles = [
  ...Array.from({ length: 14 }, (_, index) => `Nike opens retail stores in city ${index}`),
  ...Array.from({ length: 6 }, (_, index) => `Adidas and Nike report sales in market ${index}`),
  ...Array.from({ length: 12 }, (_, index) => `Sales rise at sporting goods retailers in region ${index}`),
  ...Array.from({ length: 11 }, (_, index) => `Puma expands its retail stores in country ${index}`),
  'Mike Ashley steps back from Frasers board',
];
const index = buildCompanyNameIndex(titles.map((title) => ({ title })));

describe('company suggestion index', () => {
  it('finds one-edit typos, adjacent swaps included', () => {
    expect(oneEditApart('mike', 'nike')).toBe(true);
    expect(oneEditApart('nkie', 'nike')).toBe(true);
    expect(oneEditApart('nik', 'nike')).toBe(true);
    expect(oneEditApart('nikes', 'nike')).toBe(true);
    expect(oneEditApart('nike', 'nike')).toBe(false);
    expect(oneEditApart('make', 'nike')).toBe(false);
  });

  it('suggests a frequent catalogue company for a weakly named typo', () => {
    expect(suggestCompany(index, 'Mike')).toBe('Nike');
    expect(suggestCompany(index, 'mike')).toBe('Nike');
    expect(suggestCompany(index, 'Pumma')).toBe('Puma');
  });

  it('suggests nothing for the right name, a distant name, a common word or a short input', () => {
    expect(suggestCompany(index, 'Nike')).toBeUndefined();
    expect(suggestCompany(index, 'Decathlon')).toBeUndefined();
    // "Sales" heads 12 headlines but is a common word ("report sales"), never a company name.
    expect(index.frequent.has('sales')).toBe(false);
    expect(suggestCompany(index, 'Sale')).toBeUndefined();
    expect(suggestCompany(index, 'Ni')).toBeUndefined();
  });

  it('keeps a typed company the catalogue names itself', () => {
    const named = buildCompanyNameIndex([...titles, 'Mike Sports opens a store', 'Mike Sports adds padel'].map((title) => ({ title })));
    expect(suggestCompany(named, 'Mike')).toBeUndefined();
  });
});

describe('GET /api/publishers/:publisherId/company-suggestion', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${titles.map((title, i) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${i}/15000${i}.article</link><guid>https://www.sgieurope.com/retail/s-${i}/15000${i}.article</guid><description>${title}: retail stores.</description><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
  function app() {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const instance = createProductionApp({
      environment: 'test',
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const suggest = async (company: string, origin?: string) => instance.handle(new Request(`https://discovery.ldsystems.uk/api/publishers/sgi-europe/company-suggestion?company=${encodeURIComponent(company)}`, { headers: origin ? { Origin: origin } : {} }));
    const warm = () => instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
    return { logs, suggest, warm };
  }

  it('answers "Nike" for "Mike" from the cached catalogue, and nothing for names, websites or before a catalogue is cached', async () => {
    const target = app();
    expect(await (await target.suggest('Mike')).json()).toEqual({});
    await target.warm();
    const response = await target.suggest('Mike');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ suggestion: 'Nike' });
    expect(await (await target.suggest('Nike')).json()).toEqual({});
    expect(await (await target.suggest('mike.com')).json()).toEqual({});
    // The typed company never reaches the logs.
    expect(JSON.stringify(target.logs)).not.toMatch(/Mike|mike/);
  });

  it('applies the origin allowlist and rejects oversized input', async () => {
    const target = app();
    expect((await target.suggest('Mike', 'https://evil.example')).status).toBe(403);
    expect((await target.suggest('Mike', 'https://discovery.ldsystems.uk')).status).toBe(200);
    expect((await target.suggest('x'.repeat(300))).status).toBe(400);
  });
});
