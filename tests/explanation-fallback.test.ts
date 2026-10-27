import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const stories = [
  ['Nike relaunches its app and e-commerce platform', 'Nike rebuilt its digital experience with a new e-commerce platform. It merges two apps.'],
  ['Garmin connected fitness revenue jumps 20%', 'Garmin said its fitness segment, including wearables and the Connect app, grew 20%. Margins rose.'],
  ['Whoop raises $200m for wearable health tracking', 'Sports tech start-up Whoop raised funding for its wearable and app. It plans hires.'],
];
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${stories.map(([title, description], index) => `<item><title>${title}</title><link>https://www.sgieurope.com/news/f-${index}/2300${index}.article</link><guid>https://www.sgieurope.com/news/f-${index}/2300${index}.article</guid><description>${description}</description><pubDate>Mon, 0${index + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

/** The E batch explains every article except the Whoop one, which it marks weak (or skips, or the batch fails). */
function app(mode: 'weak' | 'skip' | 'fail') {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-fallback-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '200' },
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const { operation, payload } = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const reply = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
      if (operation === 'subject-vocabulary') return reply({ terms: ['wearables', 'connected fitness', 'e-commerce platform', 'mobile apps'] });
      if (operation === 'professional-profile-enrichment') return reply({ professionalInterests: ['sports tech'] });
      if (operation !== 'report-content') return new Response('no', { status: 500 });
      if (body.messages[0].content.includes('Do not write explanations')) return reply({ summary: 'Garmin and Whoop both grew wearables revenue; watch app subscriptions.', citedArticleIds: ['a1', 'a2'] });
      if (mode === 'fail') return new Response('upstream error', { status: 500 });
      const articles = payload.articles as Array<{ id: string; title: string }>;
      return reply({ explanations: articles.flatMap((article): Array<Record<string, string>> => (article.title.startsWith('Whoop') ? (mode === 'weak' ? [{ articleId: article.id, fit: 'weak' }] : []) : [{ articleId: article.id, angle: 'product innovation', explanation: `${article.title.split(' ')[0]} shipped a new app release, a benchmark for your mobile roadmap and release cadence.` }])) });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'nike', industry: 'sporting goods', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const generate = async () => {
    const response = await instance.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Software Engineer' }) }));
    const { reportId } = await response.json() as { reportId: string };
    return (await instance.reportStore.get(reportId, 'sgi-europe'))!;
  };
  return { logs, generate };
}

describe('explanation fallback', () => {
  it.each(['weak', 'skip', 'fail'] as const)('never uses the "Directly matches ... relevant to your work as" template (%s)', async (mode) => {
    const target = app(mode);
    const report = await target.generate();
    const whoop = report.recommendations.find((item) => item.article.title.startsWith('Whoop'));
    expect(whoop).toBeDefined();
    for (const item of report.recommendations) expect(item.explanation).not.toMatch(/Directly matches|Connects with adjacent themes|relevant to your work as/);
    // The article's own first sentence instead, as theme results do.
    expect(whoop!.explanation).toBe('Sports tech start-up Whoop raised funding for its wearable and app.');
    const fallback = target.logs.find((entry) => entry.message === 'explanation_fallback' && String(entry.fields.articleId).includes('23002'));
    expect(fallback?.fields).toMatchObject({ rejectReason: mode === 'weak' ? 'weak_kept' : mode === 'skip' ? 'not_returned_kept' : 'batch_failed' });
  });
});
