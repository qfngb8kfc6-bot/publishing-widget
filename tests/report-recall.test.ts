import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
// More own-company business stories than the old 100-slot token preselection held, all ranking on the company
// name and leadership words, plus on-subject legal stories about other companies.
const companyStories = Array.from({ length: 120 }, (_, index) => [`Lululemon CEO outlines growth strategy ${index}`, 'Lululemon leadership sets out strategy, growth and market expansion plans.']);
const legalStories = [
  ['Judge vindicates Lululemon in Nike Flyknit lawsuit', 'A US court dismissed patent infringement claims brought by Nike against Lululemon.'],
  ['Gymshark hit with lawsuit over leggings design', 'The British brand faces a trademark lawsuit in a US court over copied designs.'],
  ['Nike and StockX lawsuit heads to trial', 'Nike claims StockX sold counterfeit sneakers and infringed its trademark.'],
  ['Puma wins trademark case against discount retailer', 'The court upheld Puma trademark rights in a dispute over logos.'],
];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${[...companyStories, ...legalStories].map(([title, description], index) => `<item><title>${title}</title><link>https://www.sgieurope.com/business/r-${index}/3${String(index).padStart(5, '0')}.article</link><guid>https://www.sgieurope.com/business/r-${index}/3${String(index).padStart(5, '0')}.article</guid><description>${description}</description><pubDate>${new Date(Date.UTC(2026, 8, 1) - index * 3_600_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const enrichment = { person: { responsibilities: ['strategic planning'], decisionAreas: ['legal strategy'], themes: ['strategy', 'growth'] }, professionalInterests: ['corporate strategy', 'growth'], relevantEntities: ['Lululemon'] };
const vocabulary = { terms: ['litigation', 'lawsuit', 'trademark', 'patent', 'court'] };

describe('main report recall', () => {
  it('includes on-subject stories about other companies that theme search would find', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-recall-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '2000' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const body = JSON.parse(String(init?.body));
        const operation = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).operation as string;
        const content = operation === 'professional-profile-enrichment' ? enrichment : operation === 'subject-vocabulary' ? vocabulary : {};
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Lululemon', industry: 'sporting goods', topics: [], entities: ['Lululemon'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: () => undefined, error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'lululemon.com', jobTitle: 'Head of Legal' }) }));
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    const titles = report.recommendations.map((recommendation) => recommendation.article.title);
    expect(titles.slice(0, 4)).toEqual(expect.arrayContaining(legalStories.map(([title]) => title)));
  });
});
