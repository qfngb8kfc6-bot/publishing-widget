import { describe, expect, it } from 'vitest';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';

const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';
const items = Array.from({ length: 30 }, (_, index) => `<item><title>Nike expands retail stores and omnichannel distribution in Europe ${index}</title><link>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</link><guid>https://www.sgieurope.com/retail/nike-${index}/12000${index}.article</guid><description>Nike retail stores omnichannel distribution merchandising flagship wholesale sales growth ${index}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

type Part = 'A' | 'B';
type ContentCall = { part: Part; ids: string[]; startedAt: number };
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
      const call: ContentCall = { part: body.messages[0].content.includes('Do not write a summary') ? 'B' : 'A', ids: ref.payload.articles.map((article: { id: string }) => article.id), startedAt: Date.now() };
      calls.push(call);
      return respond(call, calls);
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { instance, calls, logs };
}

function content(call: ContentCall, withSummary = call.part === 'A') {
  return Response.json({ choices: [{ message: { content: JSON.stringify({ ...(withSummary ? { summary: `Summary from part ${call.part}.`, citedArticleIds: call.ids.slice(0, 2) } : {}), explanations: call.ids.map((articleId) => ({ articleId, angle: 'market signal', explanation: `Part ${call.part} explanation.` })) }) }, finish_reason: 'stop' }] });
}

async function generate(target: ReturnType<typeof app>['instance']) {
  const response = await target.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  return (await target.reportStore.get(reportId, 'sgi-europe'))!;
}

/** Resolves once both content calls have arrived; if the calls were sequential this would time out. */
async function bothCallsStarted(calls: ContentCall[]): Promise<void> {
  const startedAt = Date.now();
  while (calls.length < 2) {
    if (Date.now() - startedAt > 1_000) throw new Error('content calls did not run in parallel');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('split report content calls', () => {
  it('runs part A (summary + 7) and part B (the rest) in parallel and applies both', async () => {
    const { instance, calls, logs } = app(15, async (call, all) => { await bothCallsStarted(all); return content(call, true); });
    const report = await generate(instance);
    expect(report.recommendations).toHaveLength(15);
    expect(calls.map((call) => [call.part, call.ids.length])).toEqual(expect.arrayContaining([['A', 7], ['B', 8]]));
    expect(calls).toHaveLength(2);
    expect(report.generatedSummary).toBe('Summary from part A.');
    expect(report.recommendations.map((item) => item.explanation)).toEqual([...Array(7).fill('Part A explanation.'), ...Array(8).fill('Part B explanation.')]);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'ai' && item.rankingMetadata.angle === 'market signal')).toBe(true);
    expect(report.recommendations.filter((item) => item.rankingMetadata.citedInSummary).map((item) => item.rank)).toEqual([1, 2]);
    const performance = logs.filter((entry) => entry.message === 'ai_performance' && entry.fields.aiOperation === 'report_content');
    expect(performance.map((entry) => [entry.fields.part, entry.fields.aiSuccess]).sort()).toEqual([['A', true], ['B', true]]);
  });

  it('makes a single call when there are seven or fewer recommendations', async () => {
    const { instance, calls } = app(7, (call) => content(call));
    const report = await generate(instance);
    expect(report.recommendations).toHaveLength(7);
    expect(calls.map((call) => call.part)).toEqual(['A']);
  });

  it('keeps part A when part B fails; B articles fall back individually', async () => {
    const { instance, logs } = app(15, (call) => (call.part === 'B' ? new Response('upstream error', { status: 500 }) : content(call)));
    const report = await generate(instance);
    expect(report.summarySource).toBe('ai');
    expect(report.recommendations.slice(0, 7).every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
    expect(report.recommendations.slice(7).every((item) => item.rankingMetadata.explanationSource === 'deterministic')).toBe(true);
    expect(logs.find((entry) => entry.message === 'ai_performance' && entry.fields.part === 'B')?.fields).toMatchObject({ aiSuccess: false, aiErrorCode: 'unavailable', aiHttpStatus: 500 });
  });

  it('keeps part B explanations when part A fails; the summary falls back', async () => {
    const { instance } = app(15, (call) => (call.part === 'A' ? Response.json({ choices: [{ message: { content: '{"summary": "cut off' }, finish_reason: 'length' }] }) : content(call)));
    const report = await generate(instance);
    expect(report.summarySource).toBe('deterministic');
    expect(report.summaryFallbackReason).toBe('truncated');
    expect(report.recommendations.slice(0, 7).every((item) => item.rankingMetadata.explanationSource === 'deterministic')).toBe(true);
    expect(report.recommendations.slice(7).every((item) => item.rankingMetadata.explanationSource === 'ai')).toBe(true);
  });
});
