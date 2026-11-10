import { describe, expect, it } from 'vitest';
import { buildProfessionalProfile } from '../src/core';
import { marketContextTier, MIN_MARKET_CONTEXT_STORIES, namesOwnCompany, orderMarketContext } from '../src/reports/relationship';
import { RELAXED_MARKET_FLOOR } from '../src/reports/generate';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createStructuredLogger } from '../src/server/logging';
import { company } from './ranking-fixtures';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
// Executive Director at Decathlon: a leadership role that is not an executive one, so the relaxed floor is what
// brings market stories in (CEO is covered in exec-market-balance.test.ts). Six Decathlon stories pass the
// threshold; the market stories carry only weak leadership evidence (below the threshold, above the relaxed
// floor); one story has no evidence at all.
const decathlon = [
  ['Decathlon chief executive on leadership and risk in 2027', 'Decathlon CEO discusses leadership, risk and regulation.'],
  ['Decathlon reports record revenue as CEO outlines growth strategy', 'Decathlon said revenue rose and set out a strategy for growth.'],
  ['Decathlon opens 50 new stores as strategy shifts to city formats', 'Decathlon will open smaller stores as part of its growth strategy.'],
  ['Decathlon tests camera self-checkout in its operations strategy', 'Decathlon is expanding self-checkout as part of its operations strategy.'],
  ['Decathlon rebrands with new brand strategy', 'Decathlon unveiled a new brand identity and strategy.'],
  ['Decathlon sells stake to fund growth', 'Decathlon has sold a minority stake to fund growth.'],
];
const market = [
  ['Puma names new chief executive as turnaround begins', 'Puma appointed a new CEO after weak results; leadership changes follow.'],
  ['Intersport sales rise as sporting goods retailers gain share', 'Intersport members sold more across Europe; its leadership expects further gains.'],
  ['European sporting goods sales up 4%, FESI says', 'The sporting goods industry body reported higher sales and flagged tariff risk.'],
];
const unrelated = [['Trail shoe review: five pairs tested', 'We tested five trail shoes on wet rock.']];
const item = ([title, description]: string[], index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${index}/14000${index}.article</link><guid>https://www.sgieurope.com/retail/s-${index}/14000${index}.article</guid><description>${description}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${[...decathlon, ...market, ...unrelated].map(item).join('')}</channel></rss>`;
type Call = { operation: string; ids: string[]; titles: string[]; part?: 'S' | 'E' };

async function generate(respond: (call: Call) => unknown, entities: string[] = ['Decathlon']) {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const calls: Call[] = [];
  const manifest = { ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, resultLimit: 5 }, results: { ...sgiEuropeManifest.results, maximumRecommendations: 5 } };
  const app = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-market-key', AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([manifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const list = ref.payload.candidates ?? ref.payload.articles ?? [];
      const call: Call = { operation: ref.operation, ids: list.map((entry: { id: string }) => entry.id), titles: list.map((entry: { title: string }) => entry.title), ...(ref.operation === 'report-content' ? { part: body.messages[0].content.includes('Do not write explanations') ? 'S' as const : 'E' as const } : {}) };
      calls.push(call);
      return Response.json({ choices: [{ message: { content: JSON.stringify(respond(call)) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Decathlon', industry: 'sporting goods', description: 'Decathlon', topics: [], entities, source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'decathlon.com', jobTitle: 'Executive Director' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return { report: (await app.reportStore.get(reportId, 'sgi-europe'))!, logs, calls };
}

const rerank = (call: Call) => ({ results: call.ids.map((id, index) => ({ id, score: 90 - index })) });
const explainAll = (call: Call) => (call.part === 'S'
  ? { summary: 'Decathlon is reshaping its stores.', citedArticleIds: call.ids.slice(0, 2) }
  : { explanations: call.ids.map((articleId, index) => ({ articleId, angle: 'competitive move', explanation: `Point ${index} changes how you weigh your next capital decision against rivals.` })) });
const isMarket = (title: string) => !title.startsWith('Decathlon');

describe('market context: at least two stories beyond the reader\'s own company', () => {
  it('adds the best market stories above the relaxed floor; own-company share passes 60% only after that', async () => {
    const { report, logs, calls } = await generate((call) => (call.operation === 'semantic-reranking' ? rerank(call) : call.operation === 'report-content' ? explainAll(call) : {}));
    const titles = report.recommendations.map((recommendation) => recommendation.article.title);
    // Before: five of five about Decathlon (cap exception). After: two market stories take the lowest own places.
    expect(titles).toHaveLength(5);
    expect(titles.filter(isMarket)).toHaveLength(MIN_MARKET_CONTEXT_STORIES);
    expect(titles.filter((title) => !isMarket(title))).toHaveLength(3);
    expect(titles).not.toContain(unrelated[0][0]);
    const share = logs.find((entry) => entry.message === 'own_company_share')!.fields;
    expect(share).toMatchObject({ nonOwnCompanyRelaxed: 2, ownCompanyCount: 3, recommendationCount: 5, ownCompanyCapExceeded: false });
    // They went through the normal explanation batches (never the summary call): every card has its AI "why".
    const summaryTitles = calls.find((call) => call.part === 'S')!.titles;
    expect(titles.filter(isMarket).some((title) => summaryTitles.includes(title))).toBe(false);
    expect(calls.filter((call) => call.part === 'E').flatMap((call) => call.titles)).toEqual(expect.arrayContaining(titles.filter(isMarket)));
    expect(report.recommendations.every((recommendation) => recommendation.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(logs.filter((entry) => entry.message === 'explanation_fallback')).toHaveLength(0);
  });

  it('picks named competitors first, then same-sector stories', async () => {
    const { report } = await generate((call) => (call.operation === 'semantic-reranking' ? rerank(call) : call.operation === 'report-content' ? explainAll(call) : {}), ['Decathlon', 'Puma']);
    const added = report.recommendations.map((recommendation) => recommendation.article.title).filter(isMarket);
    expect(added[0]).toBe(market[0][0]);
    expect(added).toHaveLength(2);
  });

  it('never adds a market story without an accepted AI explanation, or one the content call marks weak', async () => {
    const { report, logs } = await generate((call) => (call.operation === 'semantic-reranking' ? rerank(call)
      : call.operation === 'report-content' && call.part === 'E'
        ? { explanations: call.ids.flatMap((articleId, index) => (isMarket(call.titles[index]) ? [] : [{ articleId, angle: 'competitive move', explanation: `Point ${index} changes how you weigh your next capital decision against rivals.` }])), weakArticleIds: call.ids.filter((_, index) => isMarket(call.titles[index])).slice(0, 1) }
        : call.operation === 'report-content' ? explainAll(call) : {}));
    expect(report.recommendations.some((recommendation) => isMarket(recommendation.article.title))).toBe(false);
    expect(logs.find((entry) => entry.message === 'own_company_share')!.fields.nonOwnCompanyRelaxed).toBe(0);
    expect(report.recommendations.every((recommendation) => recommendation.rankingMetadata.explanationSource === 'ai')).toBe(true);
  });

  it('logs nonOwnCompanyRelaxed in production', () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try { createStructuredLogger('production').info('own_company_share', { nonOwnCompanyRelaxed: 2 }); } finally { console.info = original; }
    expect(lines.join('\n')).toContain('"nonOwnCompanyRelaxed":2');
  });
});

describe('market-context helpers', () => {
  const profile = { ...buildProfessionalProfile(company('decathlon.com', 'Decathlon', 'sporting goods', []), 'CEO'), entities: ['Decathlon', 'Puma'] };

  it('uses a floor 15 points under the report threshold', () => {
    expect(RELAXED_MARKET_FLOOR).toBe(9);
  });

  it('tells own-company stories from market stories and ranks competitors, then sector, then the rest', () => {
    expect(namesOwnCompany({ title: 'Decathlon partners with a supplier' }, profile)).toBe(true);
    expect(namesOwnCompany({ title: 'Puma names new CEO' }, profile)).toBe(false);
    expect(marketContextTier({ title: 'Puma names new CEO' }, profile)).toBe(0);
    expect(marketContextTier({ title: 'Sporting goods sales up 4%' }, profile)).toBe(1);
    expect(marketContextTier({ title: 'Ski resorts report a late season' }, profile)).toBe(2);
    const ordered = orderMarketContext([
      { article: { title: 'Ski resorts report a late season' }, finalScore: 30 },
      { article: { title: 'Sporting goods sales up 4%' }, finalScore: 12 },
      { article: { title: 'Puma names new CEO' }, finalScore: 10 },
    ], profile);
    expect(ordered.map((entry) => entry.article.title)).toEqual(['Puma names new CEO', 'Sporting goods sales up 4%', 'Ski resorts report a late season']);
  });
});
