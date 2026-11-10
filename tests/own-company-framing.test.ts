import { describe, expect, it } from 'vitest';
import { ownCompanyMisframed } from '../src/ai/content-quality';
import { REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS, REPORT_SUMMARY_ONLY_INSTRUCTIONS } from '../src/ai/providers/openai-compatible';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';

/** The live CEO at Decathlon case: the Nuremberg stores story is the reader's own company's news. */
const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const OWN_TITLE = 'Decathlon expands footprint in cities with two new stores in Nuremberg';
const stories: Array<[string, string]> = [
  [OWN_TITLE, 'Decathlon is opening two city-centre stores in Nuremberg as part of its store expansion strategy in Germany.'],
  ['Intersport expands store network in Germany', 'Intersport opened 14 stores in Germany this year and plans further retail expansion.'],
  ['JD Sports reports strong store sales growth', 'JD Sports said store sales grew 6% as its retail expansion strategy continued in Europe.'],
  ['Adidas opens flagship stores in Berlin and Munich', 'Adidas is opening flagship stores in Berlin and Munich as retail growth strategy.'],
];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(([title, description], index) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/d-${index}/4200${index}.article</link><guid>https://www.sgieurope.com/retail/d-${index}/4200${index}.article</guid><description>${description}</description><pubDate>Mon, 0${index + 1} Nov 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

const MISFRAMED = 'Investment from a major competitor. Decathlon is opening two stores in Nuremberg, which raises the bar for city formats.';
const FIXED = 'Your city-format plan gains a second German test site: two Nuremberg openings show how your team can expand where footfall is highest.';

interface Captured { system: string; payload: { reader: { company?: string }; articles: Array<{ id: string; title: string; ownCompany?: boolean }> } }

function app(retryStillMisframed: boolean) {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const calls: Captured[] = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-framing-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '500' },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const system = body.messages[0].content as string;
      const { operation, payload } = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const reply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      if (operation === 'subject-vocabulary') return reply({ terms: [] });
      if (operation === 'professional-profile-enrichment') return reply({});
      if (operation !== 'report-content') return new Response('no', { status: 500 });
      calls.push({ system, payload });
      const articles = payload.articles as Array<{ id: string; title: string }>;
      if (system.includes('Do not write explanations')) return reply({ summary: 'Intersport and Adidas both added German stores this year; your Nuremberg openings follow the same city-centre pattern. Watch footfall.', citedArticleIds: articles.slice(0, 2).map((item) => item.id) });
      const retry = system.includes('OWN COMPANY REWRITE');
      return reply({ explanations: articles.map((item, index) => {
        if (item.title === OWN_TITLE) return { articleId: item.id, angle: 'store expansion', explanation: retry && !retryStillMisframed ? FIXED : MISFRAMED };
        return { articleId: item.id, angle: 'competitor benchmark', explanation: `Point ${index}: a benchmark for your German store plans, since ${item.title.split(' ')[0]} is adding doors where your shoppers are.` };
      }) });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Decathlon', industry: 'sporting goods retail', description: 'Decathlon sporting goods retailer', topics: ['retail', 'stores'], entities: ['Decathlon'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const generate = async () => {
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'decathlon.com', jobTitle: 'CEO' }) }));
    const { reportId } = await response.json() as { reportId: string };
    return (await instance.reportStore.get(reportId, 'sgi-europe'))!;
  };
  return { logs, calls, generate };
}

describe('own-company framing', () => {
  it('flags competitor or rival wording, not "ahead of rivals"', () => {
    expect(ownCompanyMisframed(MISFRAMED)).toBe(true);
    expect(ownCompanyMisframed('The rival’s stores now sit next to yours.')).toBe(true);
    expect(ownCompanyMisframed('A competitive threat for your wholesale partners.')).toBe(true);
    expect(ownCompanyMisframed(FIXED)).toBe(false);
    expect(ownCompanyMisframed('Your team can move ahead of rivals and competitors in city formats.')).toBe(false);
  });

  it('tells the summary and explanation calls who the reader works for and which stories are theirs', () => {
    for (const instructions of [REPORT_SUMMARY_ONLY_INSTRUCTIONS, REPORT_EXPLANATIONS_ONLY_INSTRUCTIONS]) {
      expect(instructions).toMatch(/OWN COMPANY: reader\.company is the company the reader works for/);
      expect(instructions).toMatch(/ownCompany:true is about the reader's own company: frame it as news about your company and your team/);
      expect(instructions).toMatch(/never call reader\.company a competitor or rival/);
    }
  });

  it('passes the company and a per-story own-company flag, and regenerates a "why" that calls the reader\'s company a competitor', async () => {
    const target = app(false);
    const report = await target.generate();
    const own = report.recommendations.find((item) => item.article.title === OWN_TITLE)!;
    expect(own).toBeDefined();
    for (const call of target.calls) {
      expect(call.payload.reader.company).toBe('Decathlon');
      for (const article of call.payload.articles) expect(article.ownCompany).toBe(article.title === OWN_TITLE);
    }
    expect(own.explanation).toBe(FIXED);
    expect(own.rankingMetadata.explanationSource).toBe('ai');
    const retries = target.calls.filter((call) => call.system.includes('OWN COMPANY REWRITE'));
    expect(retries).toHaveLength(1);
    expect(retries[0].payload.articles.map((article) => article.title)).toEqual([OWN_TITLE]);
    const misframed = target.logs.filter((entry) => entry.message === 'own_company_misframed');
    expect(misframed).toHaveLength(1);
    expect(misframed[0].fields).toMatchObject({ articleId: own.articleId, outcome: 'regenerated' });
    expect(JSON.stringify(misframed)).not.toMatch(/competitor|Nuremberg/);
    // Other companies' stories may still be benchmarks against competitors: they are not regenerated.
    expect(report.recommendations.filter((item) => item.article.title !== OWN_TITLE).every((item) => item.explanation.startsWith('Point '))).toBe(true);
  });

  it('falls back to the story\'s own first sentence when the one regeneration still calls it a competitor', async () => {
    const target = app(true);
    const report = await target.generate();
    const own = report.recommendations.find((item) => item.article.title === OWN_TITLE)!;
    expect(own.explanation).not.toMatch(/competitor/i);
    expect(own.rankingMetadata.explanationSource).toBe('deterministic');
    expect(target.calls.filter((call) => call.system.includes('OWN COMPANY REWRITE'))).toHaveLength(1);
    expect(target.logs.find((entry) => entry.message === 'own_company_misframed')?.fields).toMatchObject({ outcome: 'fallback' });
    expect(target.logs.find((entry) => entry.message === 'explanation_fallback' && entry.fields.articleId === own.articleId)?.fields).toMatchObject({ rejectReason: 'own_company_misframed' });
  });
});
