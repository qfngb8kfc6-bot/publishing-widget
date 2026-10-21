import { describe, expect, it } from 'vitest';
import { aiResponseDiagnostics, AIProviderError } from '../src/ai/provider';
import { OpenAICompatibleProvider } from '../src/ai/providers/openai-compatible';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { MemoryPublisherStore } from '../src/publishers/store';
import { MemoryAnalyticsStore } from '../src/analytics/store';

const API_KEY = 'sk-test-observability-secret-key';
const AI_ENDPOINT = 'https://ai.example.test/v1/chat/completions';

function completion(content: string | null, finishReason = 'stop', usage: Record<string, unknown> = { prompt_tokens: 1200, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 120 } }) {
  return Response.json({ choices: [{ message: { content }, finish_reason: finishReason }], usage });
}

function provider(response: () => Response | Promise<Response>) {
  return new OpenAICompatibleProvider({ endpoint: AI_ENDPOINT, apiKey: API_KEY, model: 'test-model', timeoutMs: 5_000 }, async () => response());
}

async function providerError(work: Promise<unknown>): Promise<AIProviderError> {
  try { await work; } catch (error) { if (error instanceof AIProviderError) return error; throw error; }
  throw new Error('expected an AIProviderError');
}

describe('OpenAI-compatible provider diagnostics', () => {
  it('attaches HTTP status, finish reason and token usage to a successful response', async () => {
    const raw = await provider(() => completion('{"results":[]}')).rerank({} as never, []);
    expect(aiResponseDiagnostics(raw)).toEqual({ httpStatus: 200, finishReason: 'stop', promptTokens: 1200, completionTokens: 300, reasoningTokens: 120 });
  });

  it('reports output cut off at the token limit as truncated', async () => {
    const error = await providerError(provider(() => completion('{"summary":"The briefing', 'length', { prompt_tokens: 900, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 850 } })).generateReportContent({ publisherId: 'sgi-europe', profile: {} as never, recommendations: [] }));
    expect(error.code).toBe('truncated');
    expect(error.diagnostics).toMatchObject({ httpStatus: 200, finishReason: 'length', completionTokens: 900, reasoningTokens: 850 });
  });

  it('reports null or blank content as empty_response', async () => {
    expect((await providerError(provider(() => completion(null, 'length')).rerank({} as never, []))).code).toBe('empty_response');
    expect((await providerError(provider(() => completion('   ')).rerank({} as never, []))).code).toBe('empty_response');
  });

  it('keeps invalid JSON that was not truncated as invalid-response', async () => {
    expect((await providerError(provider(() => completion('not json')).rerank({} as never, []))).code).toBe('invalid-response');
  });

  it('includes the HTTP status and a sanitized, bounded provider message without secrets', async () => {
    const error = await providerError(provider(() => Response.json({ error: { message: `Unsupported value: 'temperature' does not support 0 with this model. Authorization: Bearer ${API_KEY} ${'x'.repeat(600)}`, type: 'invalid_request_error' } }, { status: 400 })).rerank({} as never, []));
    expect(error.code).toBe('unavailable');
    expect(error.diagnostics.httpStatus).toBe(400);
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('temperature');
    expect(error.message).not.toContain(API_KEY);
    expect(error.message.length).toBeLessThanOrEqual(300);
  });
});

const items = Array.from({ length: 30 }, (_, index) => `<item><title>Nike expands retail stores and omnichannel distribution in Europe ${index}</title><link>https://www.sgieurope.com/retail/nike-${index}.article</link><guid>nike-${index}</guid><description>Nike retail stores omnichannel distribution merchandising flagship wholesale sales growth ${index}</description><pubDate>Mon, 0${(index % 9) + 1} Sep 2026 10:00:00 GMT</pubDate></item>`).join('');
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SGI</title>${items}</channel></rss>`;

function aiApp(content: (operation: string, body: { messages: Array<{ content: string }> }) => Response) {
  const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const analyticsStore = new MemoryAnalyticsStore();
  const app = createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: API_KEY, AI_MODEL: 'test-model', AI_ENDPOINT },
    analyticsStore,
    publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
    fetchImpl: async (input, init) => {
      if (String(input) !== AI_ENDPOINT) return new Response(rss, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
      const body = JSON.parse(String(init?.body));
      const operation = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).operation as string;
      return content(operation, body);
    },
    companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'Nike', topics: [], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined },
  });
  return { app, logs, analyticsStore };
}

async function generate(app: ReturnType<typeof aiApp>['app']) {
  const response = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }));
  expect(response.status).toBe(201);
  const { reportId } = await response.json() as { reportId: string };
  const report = await app.reportStore.get(reportId, 'sgi-europe');
  if (!report) throw new Error('report not persisted');
  return report;
}

function candidateIds(body: { messages: Array<{ content: string }> }): string[] {
  const payload = JSON.parse(body.messages[1].content.replace('BEGIN_REFERENCE_JSON\n', '').replace('\nEND_REFERENCE_JSON', '')).payload;
  return (payload.articles ?? []).map((item: { id: string }) => item.id);
}

describe('report AI provenance and ai_performance diagnostics', () => {
  it('records a truncated content call as a deterministic summary with its reason and logs why', async () => {
    const { app, logs } = aiApp((operation) => operation === 'report-content'
      ? completion('{"summary":"Nike', 'length', { prompt_tokens: 25000, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 880 } })
      : completion('{}'));
    const report = await generate(app);
    expect(report.summarySource).toBe('deterministic');
    expect(report.summaryFallbackReason).toBe('truncated');
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.every((item) => item.rankingMetadata.explanationSource === 'deterministic')).toBe(true);
    const content = logs.find((entry) => entry.message === 'ai_performance' && entry.fields.aiOperation === 'report_content');
    expect(content?.fields).toMatchObject({ aiSuccess: false, aiErrorCode: 'truncated', aiHttpStatus: 200, aiFinishReason: 'length', aiPromptTokens: 25000, aiCompletionTokens: 900, aiReasoningTokens: 880 });
    expect(String(content?.fields.aiErrorMessage).length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(logs)).not.toContain(API_KEY);
    expect(JSON.stringify(logs)).not.toContain('BEGIN_REFERENCE_JSON');
  });

  it('records AI summary and per-article explanation sources when the content call succeeds', async () => {
    const { app, logs, analyticsStore } = aiApp((operation, body) => {
      if (operation !== 'report-content') return completion('{}');
      const [first] = candidateIds(body);
      return completion(JSON.stringify({ summary: 'Nike is widening its owned-store footprint in Europe while tightening wholesale.', explanations: [{ articleId: first, explanation: 'A direct benchmark for the European store rollout.' }] }));
    });
    const report = await generate(app);
    expect(report.summarySource).toBe('ai');
    expect(report.summaryFallbackReason).toBeUndefined();
    // Eight recommendations are split into content calls A (7) and B (1); each explains its first article.
    const contentCalls = logs.filter((entry) => entry.message === 'ai_performance' && entry.fields.aiOperation === 'report_content');
    expect(contentCalls.map((entry) => entry.fields.part).sort()).toEqual(['A', 'B']);
    const sources = report.recommendations.map((item) => item.rankingMetadata.explanationSource);
    expect(sources.filter((source) => source === 'ai')).toHaveLength(contentCalls.length);
    expect(sources.filter((source) => source === 'deterministic')).toHaveLength(report.recommendations.length - contentCalls.length);
    expect(contentCalls.find((entry) => entry.fields.part === 'A')?.fields).toMatchObject({ aiSuccess: true, aiHttpStatus: 200, aiFinishReason: 'stop', aiPromptTokens: 1200, aiCompletionTokens: 300, aiReasoningTokens: 120 });
    await app.flushAnalytics();
    const generated = (await analyticsStore.query({ publisherId: 'sgi-europe' })).find((event) => event.name === 'report_generated');
    expect(generated?.metadata).toMatchObject({ aiSummaryUsed: true, aiExplanationUsed: true });
  });
});
