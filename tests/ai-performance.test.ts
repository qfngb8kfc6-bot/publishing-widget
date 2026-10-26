import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '../src/ai/providers/mock';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';

const companyContext = (domain: string) => ({
  domain,
  canonicalUrl: `https://${domain}/`,
  name: 'Nike',
  industry: 'sporting goods',
  description: 'A sporting goods company.',
  topics: ['retail', 'technology', 'innovation'],
  entities: ['Nike'],
  source: 'submitted-domain' as const,
  fetchedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  analysisVersion: 'test-v1',
});

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CountingAIProvider extends MockAIProvider {
  profileCalls = 0;
  rerankCalls = 0;
  contentCalls = 0;
  explanationCalls = 0;

  override async enhanceProfessionalProfile(input: Parameters<MockAIProvider['enhanceProfessionalProfile']>[0]): Promise<unknown> {
    this.profileCalls += 1;
    return super.enhanceProfessionalProfile(input);
  }

  override async rerank(intent: Parameters<MockAIProvider['rerank']>[0], candidates: Parameters<MockAIProvider['rerank']>[1]): Promise<unknown> {
    this.rerankCalls += 1;
    return super.rerank(intent, candidates);
  }

  override async generateReportContent(input: Parameters<MockAIProvider['generateReportContent']>[0]): Promise<unknown> {
    this.contentCalls += 1;
    return super.generateReportContent(input);
  }

  override async explainMany(requests: Parameters<MockAIProvider['explainMany']>[0]): Promise<unknown> {
    this.explanationCalls += 1;
    return super.explainMany(requests);
  }
}

function aiApp(provider: MockAIProvider, logger?: { info(message: string, fields?: Record<string, unknown>): void; error(message: string, fields?: Record<string, unknown>): void }, timeoutMs = '1000') {
  return createProductionApp({
    environment: 'test',
    serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_TIMEOUT_MS: timeoutMs },
    aiProvider: provider,
    fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
    companyContextProvider: { getContext: async (domain: string) => companyContext(domain) },
    logger,
  });
}

async function generate(app: ReturnType<typeof aiApp>, companyUrl = 'nike.com', jobTitle = 'Product Manager') {
    return app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl, jobTitle }),
  }));
}

describe('production AI performance safeguards', () => {
  it('caches validated role-specific enrichment and keeps explanations batched', async () => {
    const provider = new CountingAIProvider();
    const app = aiApp(provider);
    const first = await generate(app);
    expect(first.status).toBe(201);
    const firstPayload = await first.json() as { reportId: string };
    expect((await generate(app)).status).toBe(201);
    expect(provider.profileCalls).toBe(1);
    expect(provider.rerankCalls).toBe(2);
    // Per report: one summary call (S) plus one explanation batch (E1) for this fixture's recommendations.
    expect(provider.contentCalls).toBe(4);
    expect(provider.explanationCalls).toBe(0);

    const report = await app.reportStore.get(firstPayload.reportId, 'sgi-europe');
    const theme = report?.professionalProfile.professionalInterests[0] ?? 'retail';
    const themeResponse = await app.handle(new Request(`https://product.example/api/reports/${firstPayload.reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`, { method: 'POST' }));
    expect(themeResponse.status).toBe(200);
    expect(provider.profileCalls).toBe(1);
    expect(provider.rerankCalls).toBeGreaterThanOrEqual(2);
    // Per report: one summary call (S) plus one explanation batch (E1) for this fixture's recommendations.
    expect(provider.contentCalls).toBe(4);

    expect((await generate(app, 'nike.com', 'Software Engineer')).status).toBe(201);
    expect(provider.profileCalls).toBe(2);
  });

  it('starts source preparation concurrently with independent profile enrichment', async () => {
    let sourceStarted = false;
    let profileStarted = false;
    let releaseSource!: () => void;
    let releaseProfile!: () => void;
    const sourceGate = new Promise<void>((resolve) => { releaseSource = resolve; });
    const profileGate = new Promise<void>((resolve) => { releaseProfile = resolve; });
    class GatedAIProvider extends CountingAIProvider {
      override async enhanceProfessionalProfile(input: Parameters<MockAIProvider['enhanceProfessionalProfile']>[0]): Promise<unknown> {
        this.profileCalls += 1;
        profileStarted = true;
        await profileGate;
        return super.enhanceProfessionalProfile(input);
      }
    }
    const provider = new GatedAIProvider();
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_TIMEOUT_MS: '1000' },
      aiProvider: provider,
      fetchImpl: async () => { sourceStarted = true; await sourceGate; return new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }); },
      companyContextProvider: { getContext: async (domain: string) => companyContext(domain) },
    });
    const request = app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }),
    }));
    await pause(20);
    const bothStartedBeforeRelease = sourceStarted && profileStarted;
    releaseSource();
    releaseProfile();
    expect((await request).status).toBe(201);
    expect(bothStartedBeforeRelease).toBe(true);
  });

  it('falls back to a valid deterministic report when optional AI stages time out', async () => {
    const events: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    class NeverRespondsAIProvider extends MockAIProvider {
      override async enhanceProfessionalProfile(): Promise<unknown> { return new Promise(() => undefined); }
      override async rerank(): Promise<unknown> { return new Promise(() => undefined); }
      override async generateReportContent(): Promise<unknown> { return new Promise(() => undefined); }
    }
    const app = aiApp(new NeverRespondsAIProvider(), { info: (message, fields) => events.push({ message, fields }), error: () => undefined }, '20');
    const response = await generate(app);
    expect(response.status).toBe(201);
    await app.flushEnrichmentRetries();
    const allAiEvents = events.filter((event) => event.message === 'ai_performance');
    // The failed profile enrichment is retried once in the background and is not cached.
    expect(allAiEvents.filter((event) => event.fields?.aiRetryCount === 1).map((event) => event.fields?.aiOperation)).toEqual(['professional_profile_enrichment']);
    expect(events.find((event) => event.message === 'enrichment_retry')?.fields).toMatchObject({ retryOperations: 'professional_profile_enrichment', retrySuccess: false });
    const aiEvents = allAiEvents.filter((event) => event.fields?.aiRetryCount === 0);
    // Profile enrichment, rerank, and the content calls S and E1.
    expect(aiEvents).toHaveLength(4);
    expect(aiEvents.every((event) => event.fields?.publisherId === 'sgi-europe' && typeof event.fields?.requestId === 'string')).toBe(true);
    expect(aiEvents.every((event) => event.fields?.aiSuccess === false && event.fields?.aiFallbackUsed === true)).toBe(true);
  });

  it('times every awaited generation span and logs any single span over one second', async () => {
    const logs: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger = { info: (message: string, fields?: Record<string, unknown>) => logs.push({ message, fields }), error: () => undefined };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: {},
      fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => { await pause(1_100); return companyContext(domain); } },
      logger,
    });
    const response = await generate(app);
    expect(response.status).toBe(201);
    const serverTiming = response.headers.get('Server-Timing') ?? '';
    for (const span of ['company-context', 'analytics', 'catalogue-select', 'exclusion', 'sections', 'report-lookup']) expect(serverTiming).toContain(`${span};dur=`);
    expect(Number(serverTiming.match(/company-context;dur=(\d+)/)?.[1])).toBeGreaterThanOrEqual(1_000);
    const slow = logs.filter((entry) => entry.message === 'slow_span');
    expect(slow.map((entry) => entry.fields?.stage)).toEqual(['company-context']);
    expect(slow[0]?.fields).toMatchObject({ publisherId: 'sgi-europe', durationMs: expect.any(Number) });
  });
});
