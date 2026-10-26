import { describe, expect, it } from 'vitest';
import { validateReportContent, validateSemanticResults } from '../src/ai/validation';
import type { ReportContentRequest, SemanticCandidate } from '../src/ai/types';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const items = Array.from({ length: 30 }, (_, index) => `<item><title>Nike expands retail stores and omnichannel distribution in Europe ${index}</title><link>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</link><guid>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</guid><description>Nike retail stores omnichannel distribution merchandising flagship wholesale sales growth ${index}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

type Logged = { message: string; fields: Record<string, unknown> };
type Call = { operation: string; ids: string[]; titles: string[]; part?: 'S' | 'E' };

function app(limit: number, respond: (call: Call) => unknown) {
  const logs: Logged[] = [];
  const calls: Call[] = [];
  const manifest = { ...sgiEuropeManifest, content: { ...sgiEuropeManifest.content, resultLimit: limit }, results: { ...sgiEuropeManifest.results, maximumRecommendations: limit } };
  const instance = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'sk-test-weak-key', AI_MODEL: 'test-model', AI_ENDPOINT },
    publisherStore: new MemoryPublisherStore([manifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const ref = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', ''));
      const list = ref.payload.candidates ?? ref.payload.articles ?? [];
      const call: Call = { operation: ref.operation, ids: list.map((item: { id: string }) => item.id), titles: list.map((item: { title: string }) => item.title), ...(ref.operation === 'report-content' ? { part: body.messages[0].content.includes('Do not write explanations') ? 'S' as const : 'E' as const } : {}) };
      calls.push(call);
      return Response.json({ choices: [{ message: { content: JSON.stringify(respond(call)) }, finish_reason: 'stop' }] });
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { instance, logs, calls };
}

async function generate(target: ReturnType<typeof app>['instance']) {
  const response = await target.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return (await target.reportStore.get(reportId, 'sgi-europe'))!;
}

/** Content reply: S writes the summary; an E batch is weak for the given positions and explains the rest. */
function content(call: Call, weakPositions: number[]) {
  if (call.part === 'S') return { summary: 'Nike is adding owned stores across Europe.', citedArticleIds: call.ids.slice(0, 2) };
  return {
    explanations: call.ids.map((articleId, index) => (weakPositions.includes(index) ? { articleId, fit: 'weak' } : { articleId, angle: 'channel shift', explanation: `Nike store expansion ${index}.` })),
  };
}

describe('weak-fit validation', () => {
  it('passes a boolean rerank weak flag through and ignores anything else', () => {
    const candidates = [{ articleId: 'a1' }, { articleId: 'a2' }, { articleId: 'a3' }] as SemanticCandidate[];
    expect(validateSemanticResults({ results: [{ id: 'a1', score: 20, weak: true }, { id: 'a2', score: 80 }, { id: 'a3', score: 50, weak: 'yes' }] }, candidates)).toEqual([
      { articleId: 'a1', semanticScore: 20, signals: [], weak: true },
      { articleId: 'a2', semanticScore: 80, signals: [] },
      { articleId: 'a3', semanticScore: 50, signals: [] },
    ]);
  });

  it('treats fit:"weak" as an honest answer, not a missing explanation', () => {
    const request = { publisherId: 'p', profile: {}, recommendations: [{ article: { id: 'x' } }, { article: { id: 'y' } }, { article: { id: 'z' } }] } as unknown as ReportContentRequest;
    const rejections: unknown[] = [];
    const result = validateReportContent({ summary: 'S.', explanations: [{ articleId: 'x', fit: 'weak' }, { articleId: 'y', explanation: 'Fact.' }, { articleId: 'unknown', fit: 'weak' }] }, request, (rejection) => rejections.push(rejection));
    expect(result).toMatchObject({ weakArticleIds: ['x'], explanations: [{ articleId: 'y', explanation: 'Fact.' }] });
    // A weak flag for an ID that was never supplied is still rejected as unknown.
    expect(rejections).toEqual([expect.objectContaining({ reason: 'unknown_article_id', articleId: 'unknown' })]);
  });
});

describe('weak-fit removal', () => {
  it('drops rerank weak fits before the content call and content weak fits after it', async () => {
    // The first three explanation entries across the E batches are marked weak.
    let weakBudget = 3;
    const takeWeak = (call: Call) => call.ids.flatMap((_, index) => (weakBudget > 0 ? (weakBudget -= 1, [index]) : []));
    const { instance, logs, calls } = app(15, (call) => (call.operation === 'semantic-reranking'
      ? { results: call.ids.map((id, index) => ({ id, score: 80 - index, ...(index === 1 || index === 4 ? { weak: true } : {}) })) }
      : call.operation === 'report-content' ? content(call, call.part === 'E' ? takeWeak(call) : []) : {}));
    const report = await generate(instance);
    const rerank = calls.find((call) => call.operation === 'semantic-reranking')!;
    const rerankWeakTitles = [rerank.titles[1], rerank.titles[4]];
    const contentTitles = calls.filter((call) => call.operation === 'report-content').flatMap((call) => call.titles);
    expect(contentTitles).not.toEqual(expect.arrayContaining([rerankWeakTitles[0]]));
    expect(contentTitles).not.toEqual(expect.arrayContaining([rerankWeakTitles[1]]));
    // A successful rerank keeps its top AI_RERANK_LIMIT candidates; two are rerank-weak and three content-weak.
    expect(report.recommendations).toHaveLength(rerank.ids.length - 2 - 3);
    expect(report.recommendations.map((item) => item.article.title)).not.toEqual(expect.arrayContaining(rerankWeakTitles));
    expect(report.recommendations.some((item) => item.rankingMetadata.lowerConfidence)).toBe(false);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(logs.find((entry) => entry.message === 'weak_fit_removed')?.fields).toMatchObject({ weakFlagged: 5, weakFromRerank: 2, weakFromContent: 3, weakRemoved: 5, weakKeptLowerConfidence: 0, finalRecommendationCount: rerank.ids.length - 5 });
    expect(logs.filter((entry) => entry.message === 'ai_explanation_rejected')).toHaveLength(0);
  });

  it('keeps the strongest weak fits, marked lower confidence, when fewer than three would remain', async () => {
    const { instance, logs } = app(4, (call) => (call.operation === 'report-content' ? content(call, [0, 1, 3]) : {}));
    const report = await generate(instance);
    expect(report.recommendations.map((item) => [item.rank, Boolean(item.rankingMetadata.lowerConfidence)])).toEqual([[1, true], [2, true], [3, false]]);
    expect(logs.find((entry) => entry.message === 'weak_fit_removed')?.fields).toMatchObject({ weakFromContent: 3, weakRemoved: 1, weakKeptLowerConfidence: 2, finalRecommendationCount: 3 });
  });

  it('treats articles a successful content call skipped as weak, logging not_returned_treated_as_weak', async () => {
    // One explanation batch explains only two of its four articles and silently skips two (the production symptom).
    let skippingCall: Call | undefined;
    const { instance, logs } = app(15, (call) => {
      if (call.operation !== 'report-content') return {};
      const reply = content(call, []);
      if (call.part !== 'E' || skippingCall) return reply;
      skippingCall = call;
      return { ...reply, explanations: reply.explanations!.filter((_, index) => index !== 1 && index !== 2) };
    });
    const report = await generate(instance);
    const skippedTitles = [skippingCall!.titles[1], skippingCall!.titles[2]];
    expect(report.recommendations.map((item) => item.article.title)).not.toEqual(expect.arrayContaining([skippedTitles[0]]));
    expect(report.recommendations.map((item) => item.article.title)).not.toEqual(expect.arrayContaining([skippedTitles[1]]));
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    const treated = logs.filter((entry) => entry.message === 'not_returned_treated_as_weak');
    expect(treated).toHaveLength(2);
    const part = treated[0]?.fields.part;
    expect(String(part)).toMatch(/^E\d$/);
    expect(treated.every((entry) => entry.fields.part === part && entry.fields.operation === 'removed')).toBe(true);
    const notReturned = logs.filter((entry) => entry.message === 'ai_explanation_rejected' && entry.fields.rejectReason === 'not_returned');
    expect(notReturned).toHaveLength(2);
    expect(notReturned.every((entry) => entry.fields.part === part)).toBe(true);
  });

  it('keeps a skipped article with lowerConfidence when removing it would leave fewer than three', async () => {
    const { instance, logs } = app(3, (call) => (call.operation === 'report-content' ? { ...content(call, []), explanations: (content(call, []).explanations ?? []).slice(1) } : {}));
    const report = await generate(instance);
    expect(report.recommendations.map((item) => [item.rank, Boolean(item.rankingMetadata.lowerConfidence)])).toEqual([[1, true], [2, false], [3, false]]);
    expect(logs.find((entry) => entry.message === 'not_returned_treated_as_weak')?.fields).toMatchObject({ operation: 'kept_lower_confidence' });
  });

  it('does not treat a missing or empty explanations list as per-article skips', async () => {
    for (const reply of [{}, { explanations: [] }]) {
      const { instance, logs } = app(10, (call) => (call.operation === 'report-content' ? { summary: 'Nike is adding owned stores across Europe.', ...reply } : {}));
      const report = await generate(instance);
      expect(report.recommendations.length).toBeGreaterThan(3);
      expect(logs.filter((entry) => entry.message === 'not_returned_treated_as_weak')).toHaveLength(0);
    }
  });
});
