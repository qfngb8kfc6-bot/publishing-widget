import { describe, expect, it } from 'vitest';
import * as server from '../src/server/production';
// @ts-expect-error -- plain ESM script without types
import { compare } from '../scripts/wvc-compare.mjs';

const KEY = 'compare-test-key-123456';
const url = (i: number) => `https://www.sgieurope.com/retail/story-${i}/${400000 + i}.article`;
const titles = ['Fabletics opens 30 stores in an omnichannel retail push', 'JD Sports opens 50 retail stores in Europe', 'Intersport expands its retail store network'];

describe('wvc:compare', () => {
  it('renders the current and API-only top stories side by side without body text or the key', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>${titles.map((title, i) => `<item><title>${title}</title><link>${url(i)}</link><guid>${url(i)}</guid><description>${title}: retail stores.</description><enclosure url="https://www.sgieurope.com/feed/${i}.jpg" type="image/jpeg"/><pubDate>Mon, 0${i + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
    const stories = titles.map((title, i) => ({ STORYCODE: String(400000 + i), STORYURL: url(i), HEADLINE: title, DATEPUBLISHED: `2026-09-0${i + 1}T10:00:00Z`, PRIVATE: 'true', STORYTEXT: `<p>${title} with retail stores. Second sentence.</p><p>BODY-ONLY-PARAGRAPH ${i}</p>` }));
    const keys: Array<string | null> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(String(input));
      if (!target.pathname.includes('storylistpagination')) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      keys.push(new Headers(init?.headers).get('API_ACCESS_TOKEN'));
      return Response.json({ ErrorsFound: false, Messages: [], PagedData: { TotalNumberOfPages: 1, TotalNumberOfRecords: 3, Data: stories } });
    }) as typeof fetch;
    const companyContextProvider = { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) };
    const { html, summary } = await compare({ server, fetchImpl, resolveSecret: (reference: string) => (reference === 'env:SGI_WVC_API_KEY' ? KEY : undefined), pages: 0, environment: {}, companyContextProvider, scenarios: [['nike.com', 'Head of Retail']] });
    expect(summary).toMatchObject({ totalPages: 1, storiesStored: 3, current: { articles: 3, image: '100%' }, apiOnly: { articles: 3, image: '0%', description: '100%' } });
    expect(html).toContain('Current: RSS + WVC');
    expect(html).toContain('API only (WVC)');
    expect(html).toContain('Fabletics opens 30 stores in an omnichannel retail push with retail stores. Second sentence.');
    expect(html).not.toContain('BODY-ONLY-PARAGRAPH');
    expect(html).not.toContain(KEY);
    expect(keys.every((key) => key === KEY)).toBe(true);
  });
});
