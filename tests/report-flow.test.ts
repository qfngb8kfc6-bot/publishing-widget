import { describe, expect, it } from 'vitest';
import { MemoryReportStore } from '../src/reports';
import { createProductionApp } from '../src/server/production';
import { realPublisherSearchFixture } from '../src/publishers/real-publisher/fixtures';
import { MockAIProvider } from '../src/ai/providers/mock';
import { AIProviderError } from '../src/ai/provider';

type AIFailure = 'profile' | 'rerank' | 'content' | 'invalid-profile' | 'invalid-rerank' | 'invalid-content' | 'timeout-profile' | 'rate-limit-rerank';

class ConfigurableReportAIProvider extends MockAIProvider {
  constructor(private readonly failure?: AIFailure) { super(); }

  override async enhanceProfessionalProfile(input: Parameters<MockAIProvider['enhanceProfessionalProfile']>[0]): Promise<unknown> {
    if (this.failure === 'profile') throw new AIProviderError('unavailable');
    if (this.failure === 'invalid-profile') return { unexpected: true };
    if (this.failure === 'timeout-profile') return new Promise(() => undefined);
    return super.enhanceProfessionalProfile(input);
  }

  override async rerank(intent: Parameters<MockAIProvider['rerank']>[0], candidates: Parameters<MockAIProvider['rerank']>[1]): Promise<unknown> {
    if (this.failure === 'rerank') throw new AIProviderError('unavailable');
    if (this.failure === 'invalid-rerank') return [{ articleId: 'unknown-article', semanticScore: 100, signals: ['invented'] }];
    if (this.failure === 'rate-limit-rerank') throw new AIProviderError('rate-limit');
    return super.rerank(intent, candidates);
  }

  override async generateReportContent(input: Parameters<MockAIProvider['generateReportContent']>[0]): Promise<unknown> {
    if (this.failure === 'content') throw new AIProviderError('unavailable');
    if (this.failure === 'invalid-content') return { summary: 'Safe bounded summary', explanations: [{ articleId: 'unknown-article', explanation: 'Invented article.' }] };
    return super.generateReportContent(input);
  }
}

async function generateWithAI(provider: MockAIProvider, timeoutMs = 40) {
  const app = createProductionApp({ environment: 'test', serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_TIMEOUT_MS: String(timeoutMs) }, aiProvider: provider });
  const response = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
  const payload = await response.json() as { reportId: string };
  const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`));
  return { app, response, report: await reportResponse.json() as any };
}

describe('hosted report flow', () => {
  it('generates, persists, reloads and regenerates a tenant-scoped demo report', async () => {
    const reports = new MemoryReportStore();
    const app = createProductionApp({ environment: 'test', reportStore: reports });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'www.ldsystems.uk', jobTitle: 'Software Engineer' }) }));
    expect(generated.status).toBe(201);
    const payload = await generated.json() as { reportId: string; reportUrl: string; statusUrl: string };
    expect(payload.reportUrl).toBe(`/p/demo/${payload.reportId}`);
    expect(payload.statusUrl).toBe(`/api/generations/${payload.reportId}/status?publisherId=demo`);

    const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`));
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as { companyDomain: string; jobTitle: string; recommendations: unknown[]; professionalProfile: { role: { function: string } } };
    expect(report).toMatchObject({ companyDomain: 'ldsystems.uk', jobTitle: 'Software Engineer' });
    expect(report.professionalProfile.role.function).toBe('Engineering');
    expect(report.recommendations.length).toBeGreaterThan(0);
    const status = await app.handle(new Request(`https://product.example${payload.statusUrl}`));
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ companyDomain: 'ldsystems.uk', jobTitle: 'Software Engineer' });
    expect((await app.handle(new Request(`https://product.example/api/generations/${payload.reportId}/status?publisherId=real-publisher`))).status).toBe(404);
    expect((await app.handle(new Request(`https://product.example/api/generations/${payload.reportId}/status`))).status).toBe(400);
    expect((await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}`))).status).toBe(400);
    const funnelEvents = await app.analyticsStore.query({ publisherId: 'demo' });
    expect(funnelEvents.map((event) => event.name)).toEqual(expect.arrayContaining(['generation_started', 'company_analysis_completed', 'profile_generated', 'retrieval_completed', 'ranking_completed', 'report_generated']));
    expect(funnelEvents.every((event) => !JSON.stringify(event.metadata ?? {}).includes('Software Engineer'))).toBe(true);

    const edited = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'microsoft.com', jobTitle: 'Chief Technology Officer' }) }));
    const editedPayload = await edited.json() as { reportId: string };
    expect(editedPayload.reportId).not.toBe(payload.reportId);
    expect((await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`))).status).toBe(200);
  });

  it('rejects private or malformed company input without exposing external fetch details', async () => {
    const app = createProductionApp({ environment: 'test' });
    const response = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'http://localhost:8080', jobTitle: 'Engineer' }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsafe_company_url' });
    const ipv6 = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'http://[::1]/', jobTitle: 'Engineer' }) }));
    expect(ipv6.status).toBe(400);
    expect(await ipv6.json()).toMatchObject({ error: 'unsafe_company_url' });
  });

  it('uses the configured server-side real publisher adapter for report retrieval', async () => {
    let upstreamUrl = '';
    const app = createProductionApp({ environment: 'test', serverEnvironment: { REAL_PUBLISHER_UPSTREAM_BASE_URL: 'https://upstream.example', REAL_PUBLISHER_API_TOKEN: 'server-only-token' }, fetchImpl: async (input) => { upstreamUrl = String(input); return new Response(JSON.stringify(realPublisherSearchFixture), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
    const response = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'real-publisher', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
    expect(response.status).toBe(201);
    expect(upstreamUrl).toContain('upstream.example');
    expect(upstreamUrl).toContain('limit=30');
    expect(upstreamUrl).not.toContain('server-only-token');
  });

  it('keeps demo scenarios isolated and preserves article provenance', async () => {
    const app = createProductionApp({ environment: 'test' });
    const scenarios = [
      ['ldsystems.uk', 'Software Engineer'],
      ['sunseeker.com', 'Head of Procurement'],
      ['microsoft.com', 'Chief Technology Officer'],
      ['jpmorgan.com', 'Investment Analyst'],
    ] as const;
    for (const [companyUrl, jobTitle] of scenarios) {
      const response = await app.handle(new Request('https://product.example/api/reports/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl, jobTitle }) }));
      expect(response.status).toBe(201);
      const { reportId } = await response.json() as { reportId: string };
      const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`));
      const report = await reportResponse.json() as { recommendations: Array<{ article: { id: string; url: string; publisherId: string; provenance?: { publisherId: string; sourceArticleId: string; sourceUrl: string; retrievalSource: string } } }> };
      expect(report.recommendations.length).toBeGreaterThan(0);
      for (const recommendation of report.recommendations) {
        expect(recommendation.article.publisherId).toBe('demo');
        expect(recommendation.article.url).toMatch(/^https:\/\/demo\.publisher\.example\//);
        expect(recommendation.article.provenance).toMatchObject({ publisherId: 'demo', sourceArticleId: recommendation.article.id, sourceUrl: recommendation.article.url, retrievalSource: 'demo-catalogue' });
      }
    }
  });

  it('uses the configured AI provider for the new persisted report pipeline', async () => {
    const { app, response, report } = await generateWithAI(new ConfigurableReportAIProvider());
    expect(response.status).toBe(201);
    expect(report.aiProviderVersion).toBe('mock-semantic:test-model');
    expect(report.professionalProfile.role.seniority).toBe('professional');
    expect(report.professionalProfile.likelyInformationNeeds.length).toBeGreaterThan(0);
    expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'hybrid')).toBe(true);
    expect(report.recommendations.every((item: any) => item.rankingMetadata.deterministicScore !== undefined && item.rankingMetadata.semanticScore !== undefined)).toBe(true);
    expect(report.generatedSummary).toContain('This briefing connects');
    expect(report.recommendations.every((item: any) => item.explanation.startsWith('This story matters'))).toBe(true);
    const events = await app.analyticsStore.query({ publisherId: 'demo' });
    expect(events.find((event) => event.name === 'profile_generated')?.metadata).toMatchObject({ aiProfileUsed: true });
    expect(events.find((event) => event.name === 'ranking_completed')?.metadata).toMatchObject({ rankingMode: 'hybrid', aiRerankUsed: true });
    expect(events.find((event) => event.name === 'report_generated')?.metadata).toMatchObject({ aiProfileUsed: true, aiRerankUsed: true, aiExplanationUsed: true });
  });

  it.each([
    ['profile failure', 'profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['invalid profile output', 'invalid-profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['profile timeout', 'timeout-profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['rerank failure', 'rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    ['invalid rerank output', 'invalid-rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    ['rate-limited rerank', 'rate-limit-rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    ['content failure', 'content', (report: any) => { expect(report.generatedSummary).toContain('Based on your role'); expect(report.recommendations.every((item: any) => !item.explanation.startsWith('This story matters'))).toBe(true); }],
    ['invalid content output', 'invalid-content', (report: any) => { expect(report.generatedSummary).toBe('Safe bounded summary'); expect(report.recommendations.every((item: any) => !item.explanation.includes('Invented article'))).toBe(true); }],
  ] as const)('falls back safely on %s', async (_label, failure, assertion) => {
    const { response, report } = await generateWithAI(new ConfigurableReportAIProvider(failure));
    expect(response.status).toBe(201);
    expect(report.recommendations.length).toBeGreaterThan(0);
    assertion(report);
  });
});
