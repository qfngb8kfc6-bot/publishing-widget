import type { CompanyContext, NormalizedArticle } from '../src/core';
import { createSgiEuropeDefinition } from '../src/publishers/sgi-europe';

/** Shared fixtures for the ranking equivalence tests. Not a test file itself. */
export function company(domain: string, name: string, industry: string, topics: string[]): CompanyContext {
  return { domain, canonicalUrl: `https://${domain}/`, name, industry, description: `${name} ${industry}`, topics, entities: [name], source: 'submitted-domain', fetchedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.000Z', analysisVersion: 'test' };
}

const VOCABULARY = [
  'retail', 'stores', 'store', 'storefront', 'omnichannel', 'omni-channel', 'distribution', 'distributor', 'distributing', 'wholesale',
  'merchandising', 'merchandise', 'e-commerce', 'ecommerce', 'D2C', 'DTC', 'click-and-collect', 'flagship', 'Nike', 'Adidas', 'Decathlon',
  'footwear', 'apparel', 'running', 'ski-touring', 'café', 'Café', 'AI', 'U.K.', 'EU', 'supply', 'chain', 'logistics', 'esports',
  'fantasy-league', 'product', 'development', 'innovation', 'launch', 'materials', 'technology', 'software', 'pricing', 'consumer',
  'growth', 'Europe', 'markets', 'sales', 'category', 'operations', 'q3', '2026', 'x', 'of', 'the', '&', '—', 'openings',
];

function word(seed: number): string {
  return VOCABULARY[seed % VOCABULARY.length];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Deterministic synthetic archive at production scale, including date ties, missing dates and punctuation. */
export function syntheticArchive(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const title = Array.from({ length: 6 + (index % 5) }, (_, offset) => word(index * 7 + offset * 13)).join(' ');
    const description = Array.from({ length: 25 + (index % 30) }, (_, offset) => word(index * 11 + offset * 17)).join(index % 3 === 0 ? ', ' : ' ');
    const category = word(index * 3);
    const pubDate = index % 97 === 0 ? '' : `<pubDate>${new Date(Date.UTC(2005 + (index % 22), index % 12, 1 + (index % 28))).toUTCString()}</pubDate>`;
    const content = index % 4 === 0 ? `<content:encoded>${escapeXml(Array.from({ length: 40 }, (_, offset) => word(index * 5 + offset * 19)).join(' '))}</content:encoded>` : '';
    return `<item><guid>synthetic-${index}</guid><title>${escapeXml(title)}</title>${content}<link>https://www.sgieurope.com/${category.replace(/[^a-z]/gi, '') || 'news'}/synthetic-${index}.article</link><description>${escapeXml(description)}</description><category>${escapeXml(category)}</category>${pubDate}</item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;
}

export async function normalizedCatalogue(xml: string): Promise<{ definition: ReturnType<typeof createSgiEuropeDefinition>; articles: NormalizedArticle[] }> {
  const definition = createSgiEuropeDefinition(async () => new Response(xml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }));
  const records = await definition.adapter.loadCatalogue!({ limit: 100 });
  const articles = records.flatMap((record) => {
    const article = definition.adapter.normalizeArticle(record);
    return article ? [article] : [];
  });
  return { definition, articles };
}
