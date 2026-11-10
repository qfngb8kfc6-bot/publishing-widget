import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile, isExecutiveTitle, scoreProfessionalArticle, type NormalizedArticle } from '../src/core';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';
import { EXEC_FIXTURE_STORIES } from './exec-market-fixtures';
import { company } from './ranking-fixtures';

const article = (title: string, description: string, categories: string[] = []): NormalizedArticle => ({ id: title, publisherId: 'sgi-europe', title, description, url: 'https://www.sgieurope.com/x/1.article', categories, tags: [], publishedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() } as unknown as NormalizedArticle);
const ceo = () => buildProfessionalProfile(company('decathlon.com', 'Decathlon', 'sporting goods retail', ['retail', 'sporting goods']), 'CEO');

describe('executive titles', () => {
  it('recognises CEO, MD, GM, founder, president, COO and CFO, not VPs or other directors', () => {
    for (const title of ['CEO', 'Chief Executive Officer', 'Group CEO', 'MD', 'Managing Director', 'GM', 'General Manager', 'Founder', 'Co-founder', 'President', 'COO', 'Chief Operating Officer', 'CFO', 'Chief Financial Officer']) expect(isExecutiveTitle(title), title).toBe(true);
    for (const title of ['VP of Sales', 'Vice President', 'Senior Vice-President Marketing', 'Head of Retail', 'Executive Director', 'Director', 'Product Manager', 'Head of Procurement']) expect(isExecutiveTitle(title), title).toBe(false);
  });

  it('adds market concepts only to executive profiles', () => {
    expect(ceo().role.executive).toBe(true);
    expect(ceo().retrieval.concepts.some((concept) => concept.source === 'market')).toBe(true);
    const retail = buildProfessionalProfile(company('nike.com', 'Nike', 'sporting goods', ['footwear']), 'Head of Retail');
    expect(retail.role.executive).toBeUndefined();
    expect(retail.retrieval.concepts.some((concept) => concept.source === 'market')).toBe(false);
  });
});

describe('executive scoring: competitor and same-sector market stories are direct', () => {
  it('scores JD Sports and Intersport results as direct matches above the threshold for CEO at Decathlon', () => {
    // Before: 10 (weak) / 40 (direct only through "operating" ~ "operations") / 10 (weak).
    const profile = ceo();
    for (const [title, description] of [
      ['JD Sports hosts US investor trip ahead of Q3 update', 'JD Sports Fashion will host investors in the US ahead of its third-quarter trading update.'],
      ['JD Sports H1 operating profit falls 19.5%', 'JD Sports Fashion reported a 19.5% fall in first-half operating profit as trading in North America softened.'],
      ['Intersport posts record revenue as store network grows', 'Intersport International said revenue rose 6% as members opened stores across Europe.'],
    ]) {
      const result = scoreProfessionalArticle(article(title, description, ['Retail']), profile);
      expect(result.relevanceType, title).toBe('direct');
      expect(result.score, title).toBeGreaterThanOrEqual(24);
    }
  });

  it('keeps market words adjacent in a story with no sector evidence', () => {
    const result = scoreProfessionalArticle(article('Bank posts record quarterly profit', 'The lender said profit and revenue rose as loan demand grew.'), ceo());
    expect(result.directMatches).not.toContain('profit');
    expect(result.directMatches).not.toContain('revenue');
  });

  it('treats a named peer as sector evidence', () => {
    const profile = { ...ceo(), entities: ['Decathlon', 'Intersport'] };
    const result = scoreProfessionalArticle(article('Intersport posts record quarterly profit', 'The group said profit rose.'), profile);
    expect(result.directMatches).toContain('profit');
  });
});

describe('executive market balance in the report', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${EXEC_FIXTURE_STORIES.map(([section, title, description], i) => `<item><title>${title}</title><link>https://www.sgieurope.com/${section}/s-${i}/16000${i}.article</link><guid>https://www.sgieurope.com/${section}/s-${i}/16000${i}.article</guid><description>${description}</description><pubDate>Mon, 0${(i % 9) + 1} Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
  const contexts: Record<string, [string, string, string[]]> = { 'decathlon.com': ['Decathlon', 'sporting goods retail', ['retail', 'sporting goods']], 'nike.com': ['Nike', 'sporting goods', ['footwear', 'apparel']] };
  async function generate(domain: string, jobTitle: string, ai = false) {
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const rerankPayloads: Array<{ system: string; payload: { enrichedIntent: { executive?: boolean } } }> = [];
    const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
    const app = createProductionApp({
      environment: 'test',
      ...(ai ? { serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-exec-key', AI_MODEL: 'test-model', AI_ENDPOINT } } : {}),
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async (input, init) => {
        if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        const body = JSON.parse(String(init?.body));
        const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
        if (ref.operation === 'semantic-reranking') rerankPayloads.push({ system: body.messages[0].content, payload: ref.payload });
        return new Response('unavailable', { status: 503 });
      },
      companyContextProvider: { getContext: async (d: string) => ({ domain: d, canonicalUrl: `https://${d}/`, name: contexts[d][0], industry: contexts[d][1], topics: contexts[d][2], entities: [contexts[d][0]], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
    });
    const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: domain, jobTitle }) }));
    const { reportId } = await response.json() as { reportId: string };
    const report = (await app.reportStore.get(reportId, 'sgi-europe'))!;
    return { titles: report.recommendations.map((item) => item.article.title), share: logs.find((entry) => entry.message === 'own_company_share')!.fields, rerankPayloads };
  }

  it('CEO at Decathlon: own-company share at most 60% with competitor results in the report', async () => {
    // Before: 4 of 7 (57%), nonOwnCompanyEligible 3; JD Sports' investor trip, Intersport and Frasers missing.
    const { titles, share } = await generate('decathlon.com', 'CEO');
    expect(share.ownCompanyShare as number).toBeLessThanOrEqual(0.6);
    expect(share.nonOwnCompanyEligible as number).toBeGreaterThanOrEqual(5);
    expect(share).toMatchObject({ nonOwnCompanyRelaxed: 0, ownCompanyCapExceeded: false });
    expect(titles).toEqual(expect.arrayContaining(['JD Sports H1 operating profit falls 19.5%', 'Frasers Group profit rises on strong sports retail trading']));
  });

  it('Head of Retail at Nike: unchanged', async () => {
    const { titles, share } = await generate('nike.com', 'Head of Retail');
    expect(titles).toEqual([
      'Decathlon expands footprint in cities with two new stores in Nuremberg',
      'Nike opens House of Innovation flagship in Paris',
      'Intersport posts record revenue as store network grows',
      'Frasers Group profit rises on strong sports retail trading',
      'Sporting goods market in Germany grows 3%',
      'XXL ASA sales fall as Nordic market weakens',
      'Decathlon invests in circular strategy with second-hand marketplace',
      'Decathlon reports first-half sales growth of 4%',
    ]);
    expect(share).toMatchObject({ ownCompanyCount: 1, recommendationCount: 8 });
  });

  it('tells the reranker the reader is an executive, so competitor results are not weak for that reason', async () => {
    const executive = await generate('decathlon.com', 'CEO', true);
    expect(executive.rerankPayloads[0].payload.enrichedIntent.executive).toBe(true);
    expect(executive.rerankPayloads[0].system).toMatch(/When enrichedIntent\.executive is true, the reader runs the company/);
    const retail = await generate('nike.com', 'Head of Retail', true);
    expect(retail.rerankPayloads[0].payload.enrichedIntent.executive).toBeUndefined();
  });
});
