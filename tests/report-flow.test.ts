import { describe, expect, it } from 'vitest';
import { MemoryReportStore, ReportGenerationService } from '../src/reports';
import { PublisherRegistry, type NormalizedArticle, type PublisherAdapter } from '../src/core';
import { createProductionApp } from '../src/server/production';
import { realPublisherSearchFixture } from '../src/publishers/real-publisher/fixtures';
import { MockAIProvider } from '../src/ai/providers/mock';
import { AIProviderError } from '../src/ai/provider';
import { createDemoDefinition } from '../src/demo/definition';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { demoArticles } from '../src/demo/articles';
import { SafeCompanyContextProvider } from '../src/server/company';
import type { ServerLogFields } from '../src/server/logging';

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

class InflatedAdjacentAIProvider extends MockAIProvider {
  override async rerank(_intent: Parameters<MockAIProvider['rerank']>[0], candidates: Parameters<MockAIProvider['rerank']>[1]): Promise<unknown> {
    return candidates.map((candidate) => ({ articleId: candidate.articleId, semanticScore: 100, relevanceType: 'adjacent', confidence: 100, keep: true, rationale: 'Synthetic inflated adjacency test.', signals: ['generic overlap'] }));
  }
}

class RejectingAIProvider extends MockAIProvider {
  override async rerank(_intent: Parameters<MockAIProvider['rerank']>[0], candidates: Parameters<MockAIProvider['rerank']>[1]): Promise<unknown> {
    return candidates.map((candidate) => ({ articleId: candidate.articleId, semanticScore: 0, keep: false, signals: ['synthetic rejection'] }));
  }
}

async function generateWithAI(provider: MockAIProvider, timeoutMs = 40) {
  const app = createProductionApp({ environment: 'test', serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_TIMEOUT_MS: String(timeoutMs) }, aiProvider: provider });
  const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
  const payload = await response.json() as { reportId: string };
  const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`));
  return { app, response, report: await reportResponse.json() as any };
}

describe('hosted report flow', () => {
  it('reproduces the live widget request for LD Systems without a generation failure', async () => {
    const app = createProductionApp({ environment: 'development' });
    const response = await app.handle(new Request('http://localhost:5173/api/reports/generate?mode=sync', {
      method: 'POST',
      headers: { 'Origin': 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Request-ID': 'regression-live-demo-1' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'https://ldsystems.uk/', jobTitle: 'Software Engineer', sessionId: 'session-regression-live-demo' }),
    }));
    const payload = await response.json() as { reportId?: string; error?: string; requestId?: string };
    expect(response.status, JSON.stringify(payload)).toBe(201);
    expect(payload.reportId).toBeTruthy();
    expect(payload.error).toBeUndefined();
  });

  it.each([0, 1, 3, 6] as const)('persists a valid report with exactly %s eligible recommendations', async (count) => {
    const adapter = new DemoPublisherAdapter();
    const relevant = adapter.normalizeArticle(demoArticles[5]);
    const unrelated = adapter.normalizeArticle(demoArticles[16]);
    const articles = count === 0 ? [unrelated] : Array.from({ length: count }, (_, index) => ({ ...relevant, id: `${relevant.id}-${index}`, url: `${relevant.url}?variant=${index}`, title: `${relevant.title} ${index + 1}` }));
    const reports = new MemoryReportStore();
    const service = new ReportGenerationService((() => {
      const base = createDemoDefinition();
      const limited: PublisherAdapter<NormalizedArticle> = { publisherId: 'demo', search: async () => articles, normalizeArticle: (article) => article };
      const registry = new PublisherRegistry();
      registry.register({ ...base, adapter: limited });
      return registry;
    })(), new SafeCompanyContextProvider(), reports);
    const report = await service.generate({ publisherId: 'demo', companyUrl: 'https://ldsystems.uk/', jobTitle: 'Software Engineer' });
    expect(report.recommendations).toHaveLength(count);
    expect(await reports.get(report.id, 'demo')).toMatchObject({ id: report.id, recommendations: expect.any(Array) });
  });

  it('generates, persists, reloads and regenerates a tenant-scoped demo report', async () => {
    const reports = new MemoryReportStore();
    const app = createProductionApp({ environment: 'test', reportStore: reports });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'www.ldsystems.uk', jobTitle: 'Software Engineer' }) }));
    expect(generated.status).toBe(201);
    const payload = await generated.json() as { reportId: string; reportUrl: string; statusUrl: string };
    expect(payload.reportUrl).toBe(`/p/demo/${payload.reportId}`);
    expect(payload.statusUrl).toBe(`/api/generations/${payload.reportId}/status?publisherId=demo`);

    const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`));
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as { companyDomain: string; jobTitle: string; recommendations: Array<{ article: { id: string }; rankingMetadata: { relevanceType?: string } }>; professionalProfile: { role: { function: string } } };
    expect(report).toMatchObject({ companyDomain: 'ldsystems.uk', jobTitle: 'Software Engineer' });
    expect(report.professionalProfile.role.function).toBe('Engineering');
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeLessThanOrEqual(6);
    expect(report.recommendations.map((item) => item.article.id)).not.toContain('open-source-observatories');
    expect(report.recommendations.every((item) => ['direct', 'adjacent'].includes(item.rankingMetadata.relevanceType ?? ''))).toBe(true);
    const status = await app.handle(new Request(`https://product.example${payload.statusUrl}`));
    expect(status.status).toBe(200);
    expect(status.headers.get('Cache-Control')).toBe('no-store');
    expect(await status.json()).toMatchObject({ status: 'complete', reportId: payload.reportId, reportUrl: `/p/demo/${payload.reportId}`, completedStages: ['company_resolved', 'profile_built', 'content_retrieved', 'ranking_complete', 'ai_complete', 'report_persisted'], details: { jobTitle: 'Software Engineer' } });
    expect((await app.handle(new Request(`https://product.example/api/generations/${payload.reportId}/status?publisherId=real-publisher`))).status).toBe(404);
    expect((await app.handle(new Request(`https://product.example/api/generations/${payload.reportId}/status`))).status).toBe(400);
    expect((await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}`))).status).toBe(400);
    await app.flushAnalytics();
    const funnelEvents = await app.analyticsStore.query({ publisherId: 'demo' });
    expect(funnelEvents.map((event) => event.name)).toEqual(expect.arrayContaining(['generation_started', 'company_analysis_completed', 'profile_generated', 'retrieval_completed', 'ranking_completed', 'report_generated']));
    expect(funnelEvents.every((event) => !JSON.stringify(event.metadata ?? {}).includes('Software Engineer'))).toBe(true);

    const edited = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'microsoft.com', jobTitle: 'Chief Technology Officer' }) }));
    const editedPayload = await edited.json() as { reportId: string };
    expect(editedPayload.reportId).not.toBe(payload.reportId);
    expect((await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`))).status).toBe(200);
  });

  it('retrieves focused theme stories through the scoped persisted-report pipeline', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    const { reportId } = await generated.json() as { reportId: string };
    const before = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as any;
    const theme = before.professionalProfile.professionalInterests[0] as string;
    let observedQuery = '';
    const extra = { ...before.recommendations[0].article, id: 'theme-focused-extra', title: `${theme} platform update`, url: 'https://demo.publisher.example/theme-focused-extra', description: `Coverage of ${theme}.` };
    const duplicateByUrl = { ...before.recommendations[0].article, id: 'theme-focused-duplicate-url' };
    const definition = app.registry.get('demo');
    if (!definition) throw new Error('demo definition missing');
    definition.adapter = {
      publisherId: 'demo',
      search: async (intent) => { observedQuery = intent.queryText; return [extra, duplicateByUrl, ...before.recommendations.map((recommendation: any) => recommendation.article)]; },
      normalizeArticle: (article) => article as NormalizedArticle,
    };
    const response = await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=demo`, { method: 'POST' }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { theme: string; recommendations: Array<{ articleId: string; explanation: string }> };
    expect(payload.theme).toBe(theme);
    expect(observedQuery.toLowerCase()).toContain(theme.toLowerCase().split(' ')[0]);
    expect(payload.recommendations.map((item) => item.articleId)).toContain('theme-focused-extra');
    expect(payload.recommendations.map((item) => item.articleId)).not.toContain('theme-focused-duplicate-url');
    expect(payload.recommendations.map((item) => item.articleId)).not.toContain(before.recommendations[0].articleId);
    // Theme results get a neutral line from the article description, not the role template.
    const extraResult = payload.recommendations.find((item) => item.articleId === 'theme-focused-extra')!;
    expect(extraResult.explanation).toBe(`Coverage of ${theme}.`);
    expect(payload.recommendations.map((item) => item.explanation).join(' ')).not.toMatch(/relevant to your work as|Software Engineer/);
    // Articles already shown by another theme this session are excluded too.
    const searchShown = (body: string) => app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
    const afterShown = await (await searchShown(JSON.stringify({ shownArticleIds: ['theme-focused-extra', 'unknown-id', 42] }))).json() as { recommendations: Array<{ articleId: string }> };
    expect(afterShown.recommendations.map((item) => item.articleId)).not.toContain('theme-focused-extra');
    expect(afterShown.recommendations.length).toBe(payload.recommendations.length - 1);
    const overLimit = Array.from({ length: 80 }, (_, index) => `other-${index}`).concat('theme-focused-extra');
    expect(((await (await searchShown(JSON.stringify({ shownArticleIds: overLimit }))).json()) as { recommendations: Array<{ articleId: string }> }).recommendations.map((item) => item.articleId)).toContain('theme-focused-extra');
    expect((await searchShown('{"shownArticleIds": "theme-focused-extra"}')).status).toBe(400);
    expect((await searchShown('not json')).status).toBe(400);
    expect(await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json()).toMatchObject({ recommendations: before.recommendations });
    expect((await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/not-a-report-theme/search?publisherId=demo`, { method: 'POST' }))).status).toBe(400);
    expect((await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=real-publisher`, { method: 'POST' }))).status).toBe(404);

    definition.adapter = { ...definition.adapter, search: async () => [] };
    const empty = await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=demo`, { method: 'POST' }));
    expect(empty.status).toBe(200);
    expect((await empty.json()).recommendations).toEqual([]);
  });

  it('keeps deterministic theme results when AI rejects every eligible candidate', async () => {
    const logs: Array<{ message: string; fields?: ServerLogFields }> = [];
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_TIMEOUT_MS: '40' },
      aiProvider: new RejectingAIProvider(),
      logger: { info: (message, fields) => logs.push({ message, fields }), error: () => undefined },
    });
    const demoDefinition = app.registry.get('demo');
    if (!demoDefinition) throw new Error('demo definition missing');
    const demoAdapter = new DemoPublisherAdapter();
    const guaranteedArticles = Array.from({ length: 10 }, (_, index) => ({
      ...demoArticles[5],
      id: `theme-ai-fallback-${index}`,
      url: `https://demo.publisher.example/articles/theme-ai-fallback-${index}`,
      title: `Software engineering platform update ${index}`,
      dek: 'A software engineering and developer technology update.',
      keywords: ['software engineering', 'developer technology', 'technology'],
      body: 'Software engineering teams are improving platform systems, APIs and automation.',
    }));
    demoDefinition.adapter = {
      publisherId: 'demo',
      search: async () => guaranteedArticles,
      normalizeArticle: (raw) => demoAdapter.normalizeArticle(raw as typeof guaranteedArticles[number]),
    };
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    expect(generated.status).toBe(201);
    const { reportId } = await generated.json() as { reportId: string };
    const report = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as any;
    const theme = report.professionalProfile.professionalInterests[0] as string;
    const response = await app.handle(new Request(`https://product.example/api/reports/${reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=demo`, { method: 'POST' }));
    expect(response.status).toBe(200);
    const result = await response.json() as { recommendations: unknown[] };
    expect(result.recommendations.length).toBeGreaterThan(0);
    const diagnostic = logs.filter((entry) => entry.message === 'theme_retrieval_diagnostics').at(-1);
    expect(diagnostic?.fields).toMatchObject({ failureStage: 'complete', aiFilteredCount: expect.any(Number) });
  });

  it('rejects private or malformed company input without exposing external fetch details', async () => {
    const app = createProductionApp({ environment: 'test' });
    const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'http://localhost:8080', jobTitle: 'Engineer' }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsafe_company_url' });
    const ipv6 = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'http://[::1]/', jobTitle: 'Engineer' }) }));
    expect(ipv6.status).toBe(400);
    expect(await ipv6.json()).toMatchObject({ error: 'unsafe_company_url' });
  });

  it('uses the configured server-side real publisher adapter for report retrieval', async () => {
    let upstreamUrl = '';
    const app = createProductionApp({ environment: 'test', serverEnvironment: { REAL_PUBLISHER_UPSTREAM_BASE_URL: 'https://upstream.example', REAL_PUBLISHER_API_TOKEN: 'server-only-token' }, fetchImpl: async (input) => { upstreamUrl = String(input); return new Response(JSON.stringify(realPublisherSearchFixture), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
    const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'real-publisher', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
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
      const response = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl, jobTitle }) }));
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

  it('caps AI-inflated adjacent matches without promoting them to direct relevance', async () => {
    const { response, report } = await generateWithAI(new InflatedAdjacentAIProvider());
    expect(response.status).toBe(201);
    expect(report.recommendations.length).toBeGreaterThan(0);
    const deterministic = await generateWithAI(new ConfigurableReportAIProvider('rerank'));
    const deterministicTypes = new Map(deterministic.report.recommendations.map((item: any) => [item.articleId, item.rankingMetadata.relevanceType]));
    // A maximal AI score never changes the deterministic relevance type, and adjacent matches stay capped.
    for (const item of report.recommendations) {
      if (deterministicTypes.has(item.articleId)) expect(item.rankingMetadata.relevanceType).toBe(deterministicTypes.get(item.articleId));
      if (item.rankingMetadata.relevanceType === 'adjacent') expect(item.displayScore).toBeLessThanOrEqual(59);
    }
    expect(report.recommendations.some((item: any) => item.rankingMetadata.rankingMode === 'hybrid')).toBe(true);
  });

  it.each([
    ['profile failure', 'profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['invalid profile output', 'invalid-profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['profile timeout', 'timeout-profile', (report: any) => expect(report.professionalProfile.role.seniority).toBeUndefined()],
    ['rerank failure', 'rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    ['invalid rerank output', 'invalid-rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    ['rate-limited rerank', 'rate-limit-rerank', (report: any) => expect(report.recommendations.every((item: any) => item.rankingMetadata.rankingMode === 'deterministic')).toBe(true)],
    // The demo archive gives this role one direct match (limited coverage), so the fallback is the hedged summary.
    ['content failure', 'content', (report: any) => { expect(report.professionalProfile.coverage?.limited).toBe(true); expect(report.generatedSummary).toContain('closest stories in the current coverage'); expect(report.generatedSummary).not.toContain('clear connection to your work'); expect(report.recommendations.every((item: any) => !item.explanation.startsWith('This story matters'))).toBe(true); }],
    ['invalid content output', 'invalid-content', (report: any) => { expect(report.generatedSummary).toBe('Safe bounded summary'); expect(report.recommendations.every((item: any) => !item.explanation.includes('Invented article'))).toBe(true); }],
  ] as const)('falls back safely on %s', async (_label, failure, assertion) => {
    const { response, report } = await generateWithAI(new ConfigurableReportAIProvider(failure));
    expect(response.status).toBe(201);
    expect(report.recommendations.length).toBeGreaterThan(0);
    assertion(report);
  });
});
