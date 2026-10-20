import { describe, expect, it } from 'vitest';
import { FeedContentAdapter, feedSection } from '../src/publishers/content/adapters';

describe('section labels from feed URLs', () => {
  it.each([
    ['https://www.sgieurope.com/retail/decathlon-presents-10-innovation-awards-nominees/123556.article', 'Retail'],
    ['https://www.sgieurope.com/csr-and-sustainability/textile-recycling/123558.article', 'CSR and Sustainability'],
    ['https://www.sgieurope.com/case-studies/misto-holdings/123559.article', 'Case Studies'],
    ['https://www.sgieurope.com/lessons-learnt-from-the-current-corona-crisis-for-the-sporting-goods-industry/121001.article', undefined],
    ['https://www.sgieurope.com/white-house-reports-235bn-in-tariff-revenue/121002.article', undefined],
    ['https://www.sgieurope.com/what-the-tariff-ruling-means-for-brands/long-slug/121003.article', undefined],
    ['https://www.sgieurope.com/121004.article', undefined],
    [undefined, undefined],
  ])('%s → %s', (url, label) => {
    expect(feedSection(url)).toBe(label);
  });

  it('falls back to the feed category, then to no label', async () => {
    const items = [
      ['https://www.sgieurope.com/white-house-reports-235bn-in-tariff-revenue/121002.article', '<category>Business</category>'],
      ['https://www.sgieurope.com/lessons-learnt-from-the-current-corona-crisis/121001.article', ''],
      ['https://www.sgieurope.com/retail/decathlon-presents-nominees/123556.article', '<category>Awards</category>'],
    ];
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>${items.map(([url, category], index) => `<item><title>Story ${index}</title><link>${url}</link><guid>${url}</guid>${category}<description>d</description></item>`).join('')}</channel></rss>`;
    const adapter = new FeedContentAdapter('sgi-europe', { type: 'rss', feedUrl: 'https://www.sgieurope.com/9871.rss', allowedHostnames: ['www.sgieurope.com'], deriveCategoryFromUrl: true }, async () => new Response(rss, { status: 200 }));
    const records = await adapter.search({ publisherId: 'sgi-europe', answers: {}, queryText: '', keywords: [], interests: [], personas: [] }, { limit: 10, archiveWide: true } as never);
    expect(records.map((record) => adapter.normalizeArticle(record)?.categories)).toEqual([['Business'], [], ['Retail', 'Awards']]);
  });
});
