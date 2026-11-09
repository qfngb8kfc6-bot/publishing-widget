import { describe, expect, it } from 'vitest';
import { limitOwnCompanyShare, restoreHeldBack, THIN_REPORT_STORIES } from '../src/reports/relationship';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createStructuredLogger } from '../src/server/logging';

const own = (id: string) => ({ id, own: true });
const other = (id: string) => ({ id, own: false });
const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe('own-company cap: held-back stories', () => {
  it('lists the own-company items the cap moved out, best first', () => {
    const ranked = [own('n1'), own('n2'), own('n3'), own('n4'), own('n5'), other('o1'), other('o2')];
    const { selected, heldBack } = limitOwnCompanyShare(ranked, 5, (item) => item.own);
    expect(ids(selected)).toEqual(['n1', 'n2', 'n3', 'o1', 'o2']);
    expect(ids(heldBack)).toEqual(['n4', 'n5']);
  });

  it('restores held-back items only up to five stories, in pool order', () => {
    const pool = [own('n1'), own('n2'), own('n3'), own('n4'), own('n5'), own('n6'), other('o1')];
    const kept = [pool[0], pool[2], pool[6]];
    const { kept: after, restored } = restoreHeldBack(kept, [pool[3], pool[4], pool[5]], pool);
    expect(THIN_REPORT_STORIES).toBe(5);
    expect(ids(restored)).toEqual(['n4', 'n5']);
    expect(ids(after)).toEqual(['n1', 'n3', 'n4', 'n5', 'o1']);
    // A report at five or more stories is left alone.
    expect(restoreHeldBack(pool.slice(0, 5), [pool[5]], pool).restored).toEqual([]);
  });
});

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const nikeTitles = Array.from({ length: 6 }, (_, index) => `Nike expands retail stores and omnichannel distribution in Europe ${index}`);
const otherTitles = ['Adidas expands retail stores and omnichannel distribution in Spain', 'Puma expands retail stores and omnichannel distribution in Italy', 'Asics expands retail stores and omnichannel distribution in France'];
const item = (title: string, index: number) => `<item><title>${title}</title><link>https://www.sgieurope.com/retail/s-${index}/13000${index}.article</link><guid>https://www.sgieurope.com/retail/s-${index}/13000${index}.article</guid><description>${title}: retail stores omnichannel distribution merchandising flagship wholesale sales growth.</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${[...nikeTitles, ...otherTitles].map(item).join('')}</channel></rss>`;
type Call = { operation: string; ids: string[]; titles: string[]; part?: 'S' | 'E' };

async function generate(respond: (call: Call, calls: Call[]) => unknown) {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const calls: Call[] = [];
  const manifest = { ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, resultLimit: 5 }, results: { ...sgiEuropeManifest.results, maximumRecommendations: 5 } };
  const app = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-selection-key', AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([manifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const list = ref.payload.candidates ?? ref.payload.articles ?? [];
      const call: Call = { operation: ref.operation, ids: list.map((entry: { id: string }) => entry.id), titles: list.map((entry: { title: string }) => entry.title), ...(ref.operation === 'report-content' ? { part: body.messages[0].content.includes('Do not write explanations') ? 'S' as const : 'E' as const } : {}) };
      calls.push(call);
      return Response.json({ choices: [{ message: { content: JSON.stringify(respond(call, calls)) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return { report: (await app.reportStore.get(reportId, 'sgi-europe'))!, logs, calls };
}

/** The titles sent to the summary call: report stories only (reserves never go there). IDs are aliased per call. */
const summaryTitles = (calls: Call[]) => new Set(calls.find((call) => call.part === 'S')?.titles ?? []);

/** S writes the summary; E batches explain Nike stories and mark every other company's story weak. */
function content(call: Call) {
  if (call.part === 'S') return { summary: 'Nike is adding owned stores across Europe.', citedArticleIds: call.ids.slice(0, 2) };
  return { explanations: call.ids.map((articleId, index) => (call.titles[index].startsWith('Nike') ? { articleId, angle: 'channel shift', explanation: `Store expansion ${index} widens your owned footprint.` } : { articleId, fit: 'weak' })) };
}

describe('own-company cap after weak-fit removal', () => {
  it('restores held-back own-company stories (best first) when content weak fits leave under five', async () => {
    const { report, logs, calls } = await generate((call) => (call.operation === 'semantic-reranking'
      ? { results: call.ids.map((id, index) => ({ id, score: 90 - index })) }
      : call.operation === 'report-content' ? content(call) : {}));
    const titles = report.recommendations.map((recommendation) => recommendation.article.title);
    // Cap: 3 Nike + 2 others; both others are content weak fits (3 left), so two held-back Nike stories return.
    // Before this change the report stopped at 3 stories.
    expect(titles).toHaveLength(5);
    expect(titles.every((title) => title.startsWith('Nike'))).toBe(true);
    const share = logs.find((entry) => entry.message === 'own_company_share')!.fields;
    // Only one other-company story is left eligible, so passing 60% is the logged exception.
    expect(share).toMatchObject({ ownCompanyRestored: 2, ownCompanyDeferred: 0, recommendationCount: 5, nonOwnCompanyEligible: 1, ownCompanyCapExceeded: true });
    // Restored stories went through the normal explanation batches: every card has its AI "why", none the fallback.
    expect(report.recommendations.every((recommendation) => recommendation.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(logs.filter((entry) => entry.message === 'explanation_fallback')).toHaveLength(0);
    // The reserves rode in the E batches only, never in the summary call, and added no more than one batch.
    const reserveTitles = titles.filter((title) => !calls.find((call) => call.part === 'S')!.titles.includes(title));
    expect(reserveTitles).toHaveLength(2);
    expect(calls.filter((call) => call.part === 'E').flatMap((call) => call.titles)).toEqual(expect.arrayContaining(reserveTitles));
    expect(calls.filter((call) => call.part === 'E')).toHaveLength(2);
  });

  it('never restores a reserve whose explanation failed or came back weak', async () => {
    const { report, calls } = await generate((call, seen) => (call.operation === 'semantic-reranking'
      ? { results: call.ids.map((id, index) => ({ id, score: 90 - index })) }
      : call.operation === 'report-content' && call.part === 'S' ? content(call)
        // Report stories: Nike explained, others weak. Reserves (the last two in the batches): weak.
        : call.operation === 'report-content' ? { explanations: call.ids.map((articleId, index) => (call.titles[index].startsWith('Nike') && summaryTitles(seen).has(call.titles[index]) ? { articleId, angle: 'channel shift', explanation: `Store expansion ${index} widens your owned footprint.` } : { articleId, fit: 'weak' })) } : {}));
    // The summary call went out before the explanation batches, so reserves were known when E was answered.
    expect(calls.findIndex((call) => call.part === 'S')).toBeLessThan(calls.findIndex((call) => call.part === 'E'));
    expect(report.recommendations).toHaveLength(3);
    expect(report.recommendations.every((recommendation) => recommendation.rankingMetadata.explanationSource === 'ai')).toBe(true);
  });

  it('fills places freed by rerank weak fits from the pool instead of shrinking the report', async () => {
    const { report, logs } = await generate((call) => (call.operation === 'semantic-reranking'
      ? { results: call.ids.map((id, index) => ({ id, score: 90 - index, ...(index < 2 ? { weak: true } : {}) })) }
      : call.operation === 'report-content' ? { summary: 'Retail stores are growing.', citedArticleIds: call.ids.slice(0, 2), explanations: call.ids.map((articleId, index) => ({ articleId, angle: 'channel shift', explanation: `Store expansion ${index} widens your owned footprint.` })) } : {}));
    expect(report.recommendations).toHaveLength(5);
    const weakRemoved = logs.filter((entry) => entry.message === 'rerank_dropped' && entry.fields.rejectReason === 'weak_removed');
    expect(weakRemoved).toHaveLength(2);
    expect(report.recommendations.some((recommendation) => weakRemoved.some((entry) => entry.fields.articleId === recommendation.articleId))).toBe(false);
  });
});

describe('rerank_dropped log', () => {
  it('logs one line per dropped article with its ID, stage and reason only', async () => {
    const { logs } = await generate((call) => (call.operation === 'semantic-reranking'
      // The first candidate is left out of the response; the second gets a score that blends under the threshold.
      ? { results: call.ids.slice(1).map((id, index) => ({ id, score: index === 0 ? 0 : 90 - index })) }
      : call.operation === 'report-content' ? content(call) : {}));
    const drops = logs.filter((entry) => entry.message === 'rerank_dropped');
    expect(drops.some((entry) => entry.fields.rejectReason === 'not_returned')).toBe(true);
    for (const entry of drops) {
      expect(Object.keys(entry.fields).sort()).toEqual(['articleId', 'publisherId', 'rejectReason', 'requestId', 'stage']);
      expect(entry.fields.stage).toBe('report');
      expect(['not_returned', 'keep_false', 'below_threshold', 'weak_removed']).toContain(entry.fields.rejectReason);
    }
  });

  it('is whitelisted for production logs', () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      createStructuredLogger('production').info('rerank_dropped', { articleId: 'a1', rejectReason: 'not_returned', stage: 'report' });
    } finally {
      console.info = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"rejectReason":"not_returned"');
  });
});
