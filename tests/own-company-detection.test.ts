import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, type CompanyContext } from '../src/core';
import { articleRelationship, isOwnCompanyStory } from '../src/reports/relationship';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

/**
 * Profiles built the way the live site builds them from a typed name: the resolver's display name overrides the
 * context name; the website context has no entities. `domain` is the resolved domain, or one unrelated to the
 * name (detection must not depend on it).
 */
function fromName(name: string | undefined, domain: string, jobTitle: string) {
  const context: CompanyContext = { domain, canonicalUrl: `https://${domain}/`, name: domain.split('.')[0], topics: [], entities: [], source: 'public-website', fetchedAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-11-02T00:00:00.000Z', analysisVersion: '1.0' };
  return buildProfessionalProfile(name ? { ...context, name } : context, jobTitle);
}

type Story = { title: string; description: string };
const story = (title: string, description: string): Story => ({ title, description });
const ownCount = (stories: Story[], profile: ReturnType<typeof fromName>) => stories.filter((item) => articleRelationship(item, profile) === 'own_company').length;

// Live headlines (exact). Excerpts are illustrative: the live ones are not logged; supplier/partner words in them
// are what hid every own-company story before (supplier_partner was checked first, over title + excerpt).
const decathlon = [
  story('Decathlon uses MediaMarkt to speed up Germany push', 'The sporting goods retailer has partnered with the electronics chain to open shop-in-shops.'),
  story('IKEA pilots store-in-store retail with Decathlon in the UK', 'The furniture retailer is testing a partnership that puts sports areas in its stores.'),
  story('Leadership shift aligns Decathlon UK and Ireland', 'One country leader will run both markets and their franchise partners.'),
  story('Decathlon France outpaces market with sales growth', 'French sales rose faster than the market, helped by own-brand suppliers.'),
  story('Decathlon borrows a page from Aldi for its stores', 'The retailer is copying the discounter’s compact formats and working with fewer vendors.'),
];
const procurement = [
  story('Nike names new chief sustainability officer', 'Nike has appointed a chief sustainability officer who will work with suppliers on emissions.'),
  story('Nike partners with Syre on circular polyester', 'The partnership will supply textile-to-textile recycled polyester.'),
  story('Adidas cuts suppliers in Vietnam', 'Adidas is reducing its supplier base; factories that also make shoes for Nike are affected.'),
  story('Supplier audits tighten after forced labour rules', 'Brands including Nike and Adidas face stricter audits of their factories.'),
  story('Footwear factories in Indonesia raise wages', 'Factory wages rose 6% this year.'),
  story('Brands review vendors as tariffs reshape sourcing', 'Sporting goods brands are reviewing vendors and purchasing contracts.'),
  story('Puma signs recycled polyester deal', 'Puma will buy recycled yarn from a Taiwanese supplier.'),
  story('Footwear exports from Vietnam fall', 'Footwear exports from Vietnam fell 8% in the quarter.'),
];
const retail = [
  story('Nike opens new flagship store in Paris', 'Nike has opened a flagship store on the Champs-Élysées.'),
  story('Dunlop names new head of golf retail', 'Dunlop has appointed Jane Doe, a veteran of Nike Golf, to run its golf stores.'),
  story('JD Sports refits UK stores', 'JD Sports is refitting 40 stores this year.'),
  story('Retailers expand click-and-collect', 'Sports retailers invest in store fulfilment.'),
  story('Foot Locker trials smaller store formats', 'Foot Locker is testing compact stores, a format Nike has also used.'),
];

describe('own-company detection from the company name', () => {
  for (const [label, domain] of [['resolved domain', 'decathlon.com'], ['unrelated domain', 'example-retail.com']] as const) {
    it(`counts the live CEO at Decathlon stories 5/5 (name only, ${label})`, () => {
      // Before (old rule, these excerpts): 1 of 5; four excerpts carry a supplier/partner word ("partnered" did not match).
      expect(ownCount(decathlon, fromName('Decathlon', domain, 'CEO'))).toBe(5);
    });
  }

  it('counts Head of Procurement at Nike 2/8 and Head of Retail at Nike 1/5', () => {
    for (const domain of ['nike.com', 'example-retail.com']) {
      // Before: procurement 0 of 8 (supplier words), retail 3 of 5 (any mention counted, "Nike Golf" included).
      expect(ownCount(procurement, fromName('Nike', domain, 'Head of Procurement'))).toBe(2);
      expect(ownCount(retail, fromName('Nike', domain, 'Head of Retail'))).toBe(1);
    }
    expect(procurement.filter((item) => isOwnCompanyStory(item, fromName('Nike', 'nike.com', 'Head of Procurement'))).map((item) => item.title)).toEqual(['Nike names new chief sustainability officer', 'Nike partners with Syre on circular polyester']);
  });

  it('uses the headline, or the actor of the excerpt’s first sentence; whole word, any case', () => {
    const nike = fromName('Nike', 'nike.com', 'CEO');
    expect(isOwnCompanyStory(story('Retail sales slow in Q3', 'Sportswear giant Nike has cut its outlook. Others followed.'), nike)).toBe(true);
    expect(isOwnCompanyStory(story('NIKE cuts outlook', ''), nike)).toBe(true);
    expect(isOwnCompanyStory(story('Retail sales slow in Q3', 'Orders for Nike fell as retailers cut stock.'), nike)).toBe(false);
    expect(isOwnCompanyStory(story('Retail sales slow in Q3', 'Retailers cut stock. Nike said orders fell.'), nike)).toBe(false);
    expect(isOwnCompanyStory(story('Nikeland opens in Roblox', 'A virtual space opens.'), nike)).toBe(false);
    expect(isOwnCompanyStory(story('Nike supplier adds a factory in Vietnam', ''), nike)).toBe(false);
    expect(isOwnCompanyStory(story('Nike’s factories in Vietnam add shifts', ''), nike)).toBe(false);
    expect(isOwnCompanyStory(story('Nike partners with Syre', ''), nike)).toBe(true);
    // Domain label alone, and a legal form in the entered name.
    expect(isOwnCompanyStory(story('Decathlon opens 50 stores', ''), fromName(undefined, 'decathlon.co.uk', 'CEO'))).toBe(true);
    expect(isOwnCompanyStory(story('Nike opens 50 stores', ''), fromName('Nike, Inc.', 'example-retail.com', 'CEO'))).toBe(true);
  });

  it('still marks supplier stories that do not have the reader’s company as subject', () => {
    expect(articleRelationship(procurement[2], fromName('Nike', 'nike.com', 'Head of Procurement'))).toBe('supplier_partner');
    expect(articleRelationship(retail[1], fromName('Nike', 'nike.com', 'Head of Retail'))).toBe('wider_market');
  });
});

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
// CEO at Decathlon entered as the name "Decathlon": the five live headlines (excerpts with strategy/growth words so
// they pass the threshold, and partner words), plus market stories below the threshold and above the relaxed floor.
const liveDecathlon = [
  story('Decathlon uses MediaMarkt to speed up Germany push', 'The sporting goods retailer has partnered with the electronics chain as part of its growth strategy.'),
  story('IKEA pilots store-in-store retail with Decathlon in the UK', 'The partnership is part of a growth strategy for both retailers.'),
  story('Leadership shift aligns Decathlon UK and Ireland', 'One country leader will run both markets and their franchise partners under a single strategy.'),
  story('Decathlon France outpaces market with sales growth', 'French sales rose faster than the market as the strategy with own-brand suppliers paid off.'),
  story('Decathlon borrows a page from Aldi for its stores', 'The retailer’s growth strategy copies compact formats and fewer vendors.'),
];
const market = [
  story('Intersport sales rise as sporting goods retailers gain share', 'Intersport members sold more across Europe; its leadership expects further gains.'),
  story('European sporting goods sales up 4%, FESI says', 'The sporting goods industry body reported higher sales and flagged tariff risk.'),
];
const item = ({ title, description }: Story, index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${index}/15000${index}.article</link><guid>https://www.sgieurope.com/retail/s-${index}/15000${index}.article</guid><description>${description}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${[...liveDecathlon, ...market].map(item).join('')}</channel></rss>`;

describe('CEO at Decathlon, entered as a name: own-company cap and market context', () => {
  it('detects the five Decathlon stories and shows three of them with two market stories, each with an AI "why"', async () => {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const manifest = { ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, resultLimit: 5 }, results: { ...sgiEuropeManifest.results, maximumRecommendations: 5 } };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-detection-key', AI_MODEL: 'test-model', AI_ENDPOINT },
      publisherStore: new MemoryPublisherStore([manifest]),
      fetchImpl: async (input, init) => {
        const url = String(input);
        // The name resolver's HEAD probe of the candidate domain.
        if (init?.method === 'HEAD') return new Response(null, { status: url === 'https://decathlon.com/' ? 200 : 404 });
        if (url !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const body = JSON.parse(String(init?.body));
        const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
        const list: Array<{ id: string }> = ref.payload.candidates ?? ref.payload.articles ?? [];
        const isSummary = ref.operation === 'report-content' && body.messages[0].content.includes('Do not write explanations');
        const answer = ref.operation === 'semantic-reranking' ? { results: list.map(({ id }, index) => ({ id, score: 90 - index })) }
          : isSummary ? { summary: 'Decathlon is reshaping its stores.', citedArticleIds: list.slice(0, 2).map(({ id }) => id) }
            : ref.operation === 'report-content' ? { explanations: list.map(({ id }, index) => ({ articleId: id, angle: 'competitive move', explanation: `Point ${index} changes how you weigh your next capital decision against rivals.` })) } : {};
        return Response.json({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] });
      },
      // The live context for a resolved site: named after the domain label, no entities (the display name wins).
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: domain.split('.')[0], topics: [], entities: [], source: 'public-website' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: '1.0' }) },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'Decathlon', jobTitle: 'CEO' }) }));
    expect(response.status).toBe(201);
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    const titles = report.recommendations.map((recommendation) => recommendation.article.title);
    expect(report.companyName).toBe('Decathlon');
    expect(titles.filter((title) => liveDecathlon.some((entry) => entry.title === title))).toHaveLength(3);
    expect(titles.filter((title) => market.some((entry) => entry.title === title))).toHaveLength(2);
    expect(logs.find((entry) => entry.message === 'own_company_share')!.fields).toMatchObject({ ownCompanyCount: 3, recommendationCount: 5, nonOwnCompanyRelaxed: 2, ownCompanyCapExceeded: false });
    expect(report.recommendations.every((recommendation) => recommendation.rankingMetadata.explanationSource === 'ai')).toBe(true);
  });
});
