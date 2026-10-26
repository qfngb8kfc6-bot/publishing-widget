import { describe, expect, it } from 'vitest';
import { validateReportContent } from '../src/ai/validation';
import type { ReportContentRequest } from '../src/ai/types';
import { explanationBatches } from '../src/reports/generate';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const items = Array.from({ length: 30 }, (_, index) => `<item><title>Nike expands retail stores and omnichannel distribution in Europe ${index}</title><link>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</link><guid>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</guid><description>Nike retail stores omnichannel distribution merchandising flagship wholesale sales growth ${index}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

type Kind = 'S' | 'E';
type ContentCall = { kind: Kind; ids: string[]; titles: string[]; themes?: string[] };
type Logged = { message: string; fields: Record<string, unknown> };

function manifestWithLimit(limit: number) {
  return { ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, resultLimit: limit }, results: { ...sgiEuropeManifest.results, maximumRecommendations: limit } };
}

function app(limit: number, respond: (call: ContentCall, allCalls: ContentCall[]) => Promise<Response> | Response) {
  const calls: ContentCall[] = [];
  const logs: Logged[] = [];
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-split-key', AI_MODEL: 'test-model', AI_ENDPOINT, AI_TIMEOUT_MS: '2000' },
    publisherStore: new MemoryPublisherStore([manifestWithLimit(limit)]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      if (ref.operation !== 'report-content') return Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] });
      const articles: Array<{ id: string; title: string }> = ref.payload.articles;
      const call: ContentCall = { kind: body.messages[0].content.includes('Do not write explanations') ? 'S' : 'E', ids: articles.map((article) => article.id), titles: articles.map((article) => article.title), themes: ref.payload.themes };
      calls.push(call);
      return respond(call, calls);
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { instance, calls, logs };
}

/** S writes the summary and theme lines only; an E batch writes one explanation per article. */
function content(call: ContentCall) {
  const reply = call.kind === 'S'
    ? { summary: 'Summary from part S.', citedArticleIds: call.ids.slice(0, 2), themeDescriptions: (call.themes ?? []).map((theme) => ({ theme, description: `Line for ${theme}.` })) }
    : { explanations: call.ids.map((articleId, index) => ({ articleId, angle: 'market signal', explanation: `Explains ${call.titles[index]}.` })) };
  return Response.json({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] });
}

async function generate(target: ReturnType<typeof app>['instance']) {
  const response = await target.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return (await target.reportStore.get(reportId, 'sgi-europe'))!;
}

/** Resolves once `count` content calls have arrived; if the calls were sequential this would time out. */
async function allCallsStarted(calls: ContentCall[], count: number): Promise<void> {
  const startedAt = Date.now();
  while (calls.length < count) {
    if (Date.now() - startedAt > 1_000) throw new Error('content calls did not run in parallel');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function contentPerformance(logs: Logged[]) {
  return logs.filter((entry) => entry.message === 'ai_performance' && entry.fields.aiOperation === 'report_content');
}

describe('explanation batches', () => {
  it('splits into even contiguous batches of at most four, never more than four batches', () => {
    const sizes = (count: number) => explanationBatches(Array.from({ length: count }, (_, index) => index)).map((batch) => batch.length);
    expect(sizes(0)).toEqual([]);
    expect(sizes(1)).toEqual([1]);
    expect(sizes(4)).toEqual([4]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(8)).toEqual([4, 4]);
    expect(sizes(9)).toEqual([3, 3, 3]);
    expect(sizes(15)).toEqual([4, 4, 4, 3]);
    expect(sizes(16)).toEqual([4, 4, 4, 4]);
    expect(sizes(20)).toEqual([4, 4, 4, 4]);
    expect(explanationBatches([1, 2, 3, 4, 5, 6, 7]).flat()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('summary-only validation', () => {
  it('accepts a summary with theme lines and ignores explanations on the S call', () => {
    const request = { publisherId: 'p', profile: {}, themes: ['stores'], includeExplanations: false, recommendations: [{ article: { id: 'x' } }, { article: { id: 'y' } }] } as unknown as ReportContentRequest;
    const rejections: unknown[] = [];
    const result = validateReportContent({ summary: 'S.', citedArticleIds: ['x', 'invented'], explanations: [{ articleId: 'x', explanation: 'Ignored.' }], themeDescriptions: [{ theme: 'stores', description: 'Line.' }] }, request, (rejection) => rejections.push(rejection));
    expect(result).toEqual({ summary: 'S.', explanations: [], citedArticleIds: ['x'], themeDescriptions: { stores: 'Line.' } });
    expect(validateReportContent({ summary: 'S.' }, request, (rejection) => rejections.push(rejection))).toMatchObject({ summary: 'S.', explanations: [] });
    expect(rejections).toEqual([]);
    expect(validateReportContent({ explanations: [] }, request)).toBeNull();
  });
});

describe('split report content calls', () => {
  it('runs S (summary + themes) and explanation batches of four in parallel and applies all of them', async () => {
    const { instance, calls, logs } = app(8, async (call, all) => { await allCallsStarted(all, 3); return content(call); });
    const report = await generate(instance);
    expect(report.recommendations).toHaveLength(8);
    expect(calls).toHaveLength(3);
    const summaryCall = calls.find((call) => call.kind === 'S')!;
    expect(summaryCall.ids).toHaveLength(8);
    expect(summaryCall.themes?.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.kind === 'E').map((call) => call.ids.length)).toEqual([4, 4]);
    expect(calls.filter((call) => call.kind === 'E').every((call) => call.themes === undefined)).toBe(true);
    // Explanation batches are contiguous slices of the ranked list, so together they cover each article once.
    expect(calls.filter((call) => call.kind === 'E').flatMap((call) => call.titles).sort()).toEqual(report.recommendations.map((item) => item.article.title).sort());
    expect(report.generatedSummary).toBe('Summary from part S.');
    expect(report.themeDescriptions && Object.keys(report.themeDescriptions)).toEqual(summaryCall.themes);
    expect(report.recommendations.map((item) => item.explanation)).toEqual(report.recommendations.map((item) => `Explains ${item.article.title}.`));
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai' && item.rankingMetadata.angle === 'market signal')).toBe(true);
    expect(report.recommendations.filter((item) => item.rankingMetadata.citedInSummary).map((item) => item.rank)).toEqual([1, 2]);
    expect(contentPerformance(logs).map((entry) => [entry.fields.part, entry.fields.aiSuccess]).sort()).toEqual([['E1', true], ['E2', true], ['S', true]]);
  });

  it('never makes more than five content calls or puts more than four articles in a batch', async () => {
    const { instance, calls, logs } = app(15, (call) => content(call));
    const report = await generate(instance);
    expect(report.recommendations).toHaveLength(15);
    expect(calls).toHaveLength(5);
    expect(calls.filter((call) => call.kind === 'E').map((call) => call.ids.length).sort()).toEqual([3, 4, 4, 4]);
    expect(contentPerformance(logs).map((entry) => entry.fields.part).sort()).toEqual(['E1', 'E2', 'E3', 'E4', 'S']);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
  });

  it('makes one explanation batch when there are four or fewer recommendations', async () => {
    const { instance, calls } = app(3, (call) => content(call));
    const report = await generate(instance);
    expect(report.recommendations).toHaveLength(3);
    expect(calls.map((call) => [call.kind, call.ids.length]).sort()).toEqual([['E', 3], ['S', 3]]);
  });

  it('keeps the summary and the other batch when one explanation batch fails; only its articles fall back', async () => {
    let failedTitles: string[] = [];
    const { instance, logs } = app(8, (call) => {
      if (call.kind === 'E' && failedTitles.length === 0) { failedTitles = call.titles; return new Response('upstream error', { status: 500 }); }
      return content(call);
    });
    const report = await generate(instance);
    expect(failedTitles).toHaveLength(4);
    expect(report.summarySource).toBe('ai');
    expect(report.themeDescriptions).toBeDefined();
    for (const item of report.recommendations) expect(item.rankingMetadata.explanationSource).toBe(failedTitles.includes(item.article.title) ? 'deterministic' : 'ai');
    const failed = contentPerformance(logs).filter((entry) => entry.fields.aiSuccess === false);
    expect(failed).toHaveLength(1);
    expect(failed[0].fields).toMatchObject({ aiErrorCode: 'unavailable', aiHttpStatus: 500, aiFallbackUsed: true });
    expect(String(failed[0].fields.part)).toMatch(/^E[12]$/);
    expect(logs.filter((entry) => entry.message === 'not_returned_treated_as_weak')).toHaveLength(0);
  });

  it('keeps every explanation when S fails; only the summary and theme lines fall back', async () => {
    const { instance, logs } = app(8, (call) => (call.kind === 'S' ? Response.json({ choices: [{ message: { content: '{"summary": "cut off' }, finish_reason: 'length' }] }) : content(call)));
    const report = await generate(instance);
    expect(report.summarySource).toBe('deterministic');
    expect(report.summaryFallbackReason).toBe('truncated');
    expect(report.themeDescriptions).toBeUndefined();
    expect(report.recommendations).toHaveLength(8);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(contentPerformance(logs).find((entry) => entry.fields.part === 'S')?.fields).toMatchObject({ aiSuccess: false, aiErrorCode: 'truncated' });
  });
});
