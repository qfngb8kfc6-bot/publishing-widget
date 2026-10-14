import { describe, expect, it } from 'vitest';
import type { AnalyticsStore } from '../src/analytics/types';
import { createEvent } from '../src/core';
import { demoManifest } from '../src/demo/config';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore, type PublisherStore } from '../src/publishers/store';
import type { ServerLogFields, StructuredLogger } from '../src/server/logging';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import { MockAIProvider } from '../src/ai/providers/mock';

function request(path: string, init: RequestInit = {}, cookie?: string): Request {
  const headers = new Headers(init.headers);
  headers.set('Origin', 'https://admin.example');
  if (cookie) headers.set('Cookie', cookie);
  return new Request(`https://admin.example${path}`, { ...init, headers });
}

async function signIn(app: ReturnType<typeof createProductionApp>): Promise<string> {
  const response = await app.handle(request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'test-admin-password' }) }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('Path=/;');
  return response.headers.get('Set-Cookie')!.split(';', 1)[0];
}

function analyticsStoreThatMustNotBeRead(): AnalyticsStore {
  return {
    append: async () => undefined,
    query: async () => { throw new TypeError('analytics query unavailable token=server-only-token'); },
    listPublisherIds: async () => [],
  };
}

describe('internal publisher administration', () => {
  it('reports a writable database-backed admin mode to the frontend', async () => {
    const memory = new MemoryPublisherStore([demoManifest]);
    const store: PublisherStore = {
      mode: 'postgres',
      list: () => memory.list(),
      get: (publisherId) => memory.get(publisherId),
      create: (manifest) => memory.create(manifest),
      update: (manifest) => memory.update(manifest),
    };
    const app = createProductionApp({ environment: 'production', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' }, publisherStore: store });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers', {}, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { capabilities: { persistenceMode: string; writable: boolean; databaseBacked: boolean; createAllowed: boolean; editAllowed: boolean } };
    expect(body.capabilities).toEqual({ persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true });
  });

  it('requires server-side admin authentication and lists only safe publisher metadata', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    expect((await app.handle(request('/api/admin/publishers', {}, undefined))).status).toBe(401);
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers', {}, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { publishers: Array<{ publisherId: string; sourceType: string }> };
    expect(body.publishers.map((publisher) => publisher.publisherId)).toEqual(['demo', 'real-publisher', 'ibi', 'sgi-europe']);
    expect(body.publishers.find((publisher) => publisher.publisherId === 'demo')?.sourceType).toBe('demo');
    expect(JSON.stringify(body)).not.toContain('test-admin-password');
  });

  it('lists the full registry without analytics work when optional manifest fields are absent', async () => {
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password', REAL_PUBLISHER_API_TOKEN: 'server-only-token', REAL_PUBLISHER_UPSTREAM_BASE_URL: 'https://upstream.example' },
      analyticsStore: analyticsStoreThatMustNotBeRead(),
    });
    const definition = app.registry.get('real-publisher')!;
    const originalManifest = definition.manifest;
    const originalConfig = definition.config;
    definition.manifest = { ...originalManifest!, branding: undefined, content: undefined, contentSource: undefined, allowedOrigins: undefined } as unknown as NonNullable<typeof definition.manifest>;
    definition.config = { ...originalConfig, branding: undefined, content: undefined } as unknown as typeof definition.config;
    try {
      const cookie = await signIn(app);
      const response = await app.handle(request('/api/admin/publishers', {}, cookie));
      expect(response.status).toBe(200);
      const body = await response.json() as { publishers: Array<Record<string, unknown>> };
      expect(body.publishers.map((publisher) => publisher.publisherId)).toEqual(['demo', 'real-publisher', 'ibi', 'sgi-europe']);
      const real = body.publishers.find((publisher) => publisher.publisherId === 'real-publisher')!;
      expect(real.sourceType).toBe('rest-json');
      expect(real.brandingSummary).toMatchObject({ primaryColor: '#36566c' });
      expect(real.allowedOrigins).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('server-only-token');
    } finally {
      definition.manifest = originalManifest;
      definition.config = originalConfig;
    }
  });

  it('creates and updates a persistent publisher, checks drafts, and runs reports from saved source config', async () => {
    const requestedUrls: string[] = [];
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password', ACME_API_TOKEN: 'server-secret' },
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify({ articles: [{ id: 'acme-1', title: 'Enterprise software platform update', description: 'A useful technology development.', url: 'https://acme.example/stories/acme-1', categories: ['Technology'], tags: ['software', 'enterprise'], publishedAt: '2026-10-01' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      companyContextProvider: { getContext: async () => ({ domain: 'ldsystems.uk', canonicalUrl: 'https://ldsystems.uk/', name: 'LD Systems', industry: 'technology', description: 'A software company.', topics: ['technology', 'software'], entities: ['LD Systems'], source: 'demo-fixture', fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const cookie = await signIn(app);
    const draft = {
      publisherId: 'acme-media', name: 'Acme Media', enabled: true, environment: 'production', publisherConfigVersion: '1',
      branding: { primaryAccent: '#123456', widgetTitle: 'Build your Acme briefing', introductoryCopy: 'A briefing from Acme Media.' },
      content: { adapterId: 'rest-json', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'keywords' },
      contentSource: { type: 'rest-json', baseUrl: 'https://acme.example', endpoint: '/search', searchQueryParameter: 'q', authentication: { mode: 'bearer', secretRef: 'env:ACME_API_TOKEN' }, pagination: { style: 'page', pageParameter: 'page', limitParameter: 'limit', firstPage: 1, pageSize: 30, maxPages: 1 }, candidateLimit: 30 },
      results: { heading: 'Stories selected for you', description: 'Acme stories.', maximumRecommendations: 8, openArticleInNewTab: true },
      ranking: { mode: 'deterministic', deterministicWeight: 1, semanticWeight: 0 }, features: { aiEnabled: false, explanationsEnabled: true, analyticsEnabled: true }, allowedOrigins: ['https://acme.example'],
    };
    const created = await app.handle(request('/api/admin/publishers', { method: 'POST', body: JSON.stringify(draft) }, cookie));
    expect(created.status).toBe(201);
    expect(JSON.stringify(await created.clone().json())).not.toContain('server-secret');
    const draftCheck = await app.handle(request('/api/admin/publishers/acme-media/content-check', { method: 'POST', body: JSON.stringify(draft) }, cookie));
    expect(draftCheck.status).toBe(200);
    expect(requestedUrls.some((url) => url.startsWith('https://acme.example/search'))).toBe(true);
    const publicSearch = await app.handle(new Request('https://product.example/api/publishers/acme-media/search?q=software'));
    expect(publicSearch.status).toBe(200);
    expect((await publicSearch.json()).publisherId).toBe('acme-media');
    const report = await app.handle(request('/api/admin/publishers/acme-media/test-report', { method: 'POST', body: JSON.stringify({ companyUrl: 'https://ldsystems.uk/', jobTitle: 'Software Engineer' }) }, cookie));
    expect(report.status).toBe(201);
    const saved = { ...draft, name: 'Acme Media Updated', enabled: false, branding: { ...draft.branding, primaryAccent: '#654321' }, allowedOrigins: ['https://updated.example'] };
    const updated = await app.handle(request('/api/admin/publishers/acme-media/config', { method: 'PATCH', body: JSON.stringify(saved) }, cookie));
    expect(updated.status).toBe(200);
    const detail = await app.handle(request('/api/admin/publishers/acme-media', {}, cookie));
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { publisher: { name: string; enabled: boolean; allowedOrigins: string[]; contentSource: { authentication?: { secretRef?: string; secretConfigured?: boolean } } } };
    expect(detailBody.publisher).toMatchObject({ name: 'Acme Media Updated', enabled: false, allowedOrigins: ['https://updated.example'] });
    expect(detailBody.publisher.contentSource.authentication).toMatchObject({ secretRef: 'env:ACME_API_TOKEN', secretConfigured: true });
    expect(JSON.stringify(detailBody)).not.toContain('server-secret');
    const publicRoute = await app.handle(new Request('https://product.example/api/publishers/acme-media/search?q=software'));
    expect(publicRoute.status).toBe(404);
  });

  it('returns zero-data analytics for a persisted publisher without cross-tenant data', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const event = createEvent('widget_impression', 'real-publisher', 'real-session');
    await app.analyticsStore.append([{ ...event, eventId: event.eventId!, schemaVersion: event.schemaVersion!, receivedAt: event.timestamp }]);
    const overview = await app.handle(new Request('https://admin.example/api/analytics/demo/overview'));
    expect(overview.status).toBe(200);
    const body = await overview.json() as { publisherId: string; overview: { widgetImpressions: number; storyClicks: number }; daily: unknown[] };
    expect(body).toMatchObject({ publisherId: 'demo', overview: { widgetImpressions: 0, storyClicks: 0 } });
    expect(body.daily).toEqual([]);
    expect(cookie).toBeTruthy();
  });

  it('keeps the public error stable while logging a safe diagnostic for an admin failure', async () => {
    const errors: Array<{ message: string; fields?: ServerLogFields }> = [];
    const logger: StructuredLogger = {
      info: () => undefined,
      error: (message, fields) => { errors.push({ message, fields }); },
    };
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' }, analyticsStore: analyticsStoreThatMustNotBeRead(), logger });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/demo', {}, cookie));
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string; requestId: string };
    expect(body.error).toBe('internal_error');
    expect(body.requestId).toBeTruthy();
    const failure = errors.find((entry) => entry.message === 'request_failed')!;
    expect(failure.fields?.operation).toBe('admin_request');
    expect(failure.fields?.errorName).toBe('TypeError');
    expect(failure.fields?.errorMessage).toContain('analytics query unavailable');
    expect(failure.fields?.errorMessage).not.toContain('server-only-token');
    expect(failure.fields?.errorStack).toContain('TypeError');
  });

  it('runs a server-side content check and exposes safe diagnostics', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/demo/content-check', { method: 'POST' }, cookie));
    expect(response.status).toBe(200);
    const result = await response.json() as { reachable: boolean; accepted: number; sampleTitles: string[]; coverage: { image: number } };
    expect(result.reachable).toBe(true);
    expect(result.accepted).toBeGreaterThan(0);
    expect(result.sampleTitles.length).toBeGreaterThan(0);
    expect(typeof result.coverage.image).toBe('number');
  });

  it('logs bounded source-size diagnostics without exposing upstream content', async () => {
    const errors: Array<{ message: string; fields?: ServerLogFields }> = [];
    const logger: StructuredLogger = { info: () => undefined, error: (message, fields) => errors.push({ message, fields }) };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      fetchImpl: async () => new Response('private upstream body', { status: 200, headers: { 'Content-Length': String(20 * 1024 * 1024 + 1) } }),
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      logger,
    });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/sgi-europe/content-check', { method: 'POST' }, cookie));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('source_response_too_large');
    const diagnostic = errors.find((entry) => entry.message === 'content_check_failed');
    expect(diagnostic?.fields).toMatchObject({ publisherId: 'sgi-europe', registryMode: 'memory', sourceType: 'rss', sourceConfigured: true, adapterResolved: true, failureStage: 'source_response_size', contentLength: 20 * 1024 * 1024 + 1, maxResponseBytes: 20 * 1024 * 1024 });
    expect(JSON.stringify(diagnostic)).not.toContain('private upstream body');
  });

  it('identifies unresolved company names separately from source availability', async () => {
    const errors: Array<{ message: string; fields?: ServerLogFields }> = [];
    const logger: StructuredLogger = { info: () => undefined, error: (message, fields) => errors.push({ message, fields }) };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyInputResolver: { resolve: async () => { throw new Error('company_resolution_failed'); } },
      logger,
    });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/sgi-europe/test-report', { method: 'POST', body: JSON.stringify({ companyUrl: 'nike', jobTitle: 'Head of Retail' }) }, cookie));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'company_resolution_failed', code: 'company_resolution_failed', requestId: expect.any(String) });
    const generationDiagnostic = errors.find((entry) => entry.message === 'generation_failed');
    expect(generationDiagnostic?.fields).toMatchObject({ publisherId: 'sgi-europe', runtimeSource: 'rss', registryMode: 'memory', maxBytes: 20 * 1024 * 1024, companyInputType: 'company_name', companyResolutionAttempted: true, companyResolutionSucceeded: false, resolvedHostnamePresent: false, resolutionMethod: 'bounded_public_site', failureStage: 'company_resolution', errorMessage: 'company_resolution_failed' });
    const diagnostic = errors.find((entry) => entry.message === 'admin_generation_unavailable');
    expect(diagnostic?.fields).toMatchObject({ publisherId: 'sgi-europe', sourceType: 'rss', feedUrlPresent: true, maxBytes: 20 * 1024 * 1024, maxResponseBytes: 20 * 1024 * 1024, adapterResolved: true, companyInputType: 'company_name', companyResolutionAttempted: true, companyResolutionSucceeded: false, resolvedHostnamePresent: false, failureStage: 'company_resolution', errorMessage: 'company_resolution_failed' });
  });

  it('generates SGI admin test reports for both Nike input forms through normal generation', async () => {
    const logs: Array<{ message: string; fields?: ServerLogFields }> = [];
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password', AI_ENABLED: 'true', AI_PROVIDER: 'mock', AI_MODEL: 'test-model' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      aiProvider: new MockAIProvider(),
      fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml', 'Content-Length': '11984097' } }),
      companyInputResolver: { resolve: async (value: string) => ({ inputType: value === 'nike' ? 'company_name' as const : 'domain' as const, displayName: 'Nike', domain: 'nike.com', canonicalUrl: 'https://nike.com/', resolutionMethod: value === 'nike' ? 'bounded_public_site' as const : 'submitted_domain' as const }) },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sportswear', description: 'A sportswear company.', topics: ['retail', 'innovation'], entities: ['Nike'], source: 'demo-fixture' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: (message, fields) => logs.push({ message, fields }), error: () => undefined },
    });
    const cookie = await signIn(app);
    for (const [index, companyUrl] of ['nike', 'nike.com'].entries()) {
      const response = await app.handle(request('/api/admin/publishers/sgi-europe/test-report', { method: 'POST', headers: { 'X-Request-ID': `sgi-nike-regression-${index}` }, body: JSON.stringify({ companyUrl, jobTitle: 'Head of Retail' }) }, cookie));
      expect(response.status, await response.clone().text()).toBe(201);
      const body = await response.json() as { reportUrl: string; reportId: string };
      expect(body.reportUrl).toContain(`/p/sgi-europe/${body.reportId}`);
      expect(await app.reportStore.get(body.reportId, 'sgi-europe')).toMatchObject({ id: body.reportId, publisherId: 'sgi-europe', companyDomain: 'nike.com', jobTitle: 'Head of Retail' });
      const stages = logs.filter((entry) => entry.message === 'generation_stage' && entry.fields?.requestId === `sgi-nike-regression-${index}`).map((entry) => entry.fields?.stage);
      expect(stages).toEqual(expect.arrayContaining(['company_resolved', 'profile_built', 'content_retrieved', 'preselection_complete', 'ranking_complete', 'ai_complete', 'report_persisted']));
    }
  });

  it('returns a safe ranking diagnostic when normal generation throws a TypeError', async () => {
    const errors: Array<{ message: string; fields?: ServerLogFields }> = [];
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sportswear', description: 'A sportswear company.', topics: ['retail'], entities: ['Nike'], source: 'demo-fixture' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger: { info: () => undefined, error: (message, fields) => errors.push({ message, fields }) },
    });
    await app.publisherRuntime.get('sgi-europe');
    const definition = app.registry.get('sgi-europe');
    if (!definition) throw new Error('SGI definition missing');
    definition.adapter.normalizeArticle = () => { throw new TypeError('ranking article shape mismatch'); };
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/sgi-europe/test-report', { method: 'POST', headers: { 'X-Request-ID': 'sgi-ranking-failure' }, body: JSON.stringify({ companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }, cookie));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'generation_unavailable', code: 'ranking_failed', requestId: 'sgi-ranking-failure' });
    const diagnostic = errors.find((entry) => entry.message === 'admin_generation_unavailable');
    expect(diagnostic?.fields).toMatchObject({ requestId: 'sgi-ranking-failure', publisherId: 'sgi-europe', failureStage: 'ranking', errorCode: 'ranking_failed', errorName: 'TypeError', errorMessage: 'ranking article shape mismatch' });
  });

  it('uses the updated persisted SGI source for health and generation without a restart', async () => {
    const oldManifest = { ...sgiEuropeManifest, contentSource: { ...sgiEuropeManifest.contentSource!, maxBytes: 5_000_000 } };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      publisherStore: new MemoryPublisherStore([oldManifest]),
      fetchImpl: async (input) => {
        expect(String(input)).toBe('https://www.sgieurope.com/9871.rss?adredir=1');
        return new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml', 'Content-Length': '11984097' } });
      },
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sportswear', description: 'A sportswear company.', topics: ['retail', 'innovation'], entities: ['Nike'], source: 'demo-fixture' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    await app.publisherRuntime.get('sgi-europe');
    expect(app.publisherRuntime.describe('sgi-europe')).toMatchObject({ maxBytes: 5_000_000, runtimeCacheHit: true });
    const cookie = await signIn(app);
    const updatedManifest = { ...oldManifest, contentSource: { ...oldManifest.contentSource, maxBytes: 20 * 1024 * 1024 } };
    const saved = await app.handle(request('/api/admin/publishers/sgi-europe/config', { method: 'PATCH', body: JSON.stringify(updatedManifest) }, cookie));
    expect(saved.status).toBe(200);
    expect(app.publisherRuntime.describe('sgi-europe')).toMatchObject({ maxBytes: 20 * 1024 * 1024, runtimeCacheHit: true });
    const health = await app.handle(request('/api/admin/publishers/sgi-europe/content-check', { method: 'POST' }, cookie));
    expect(health.status).toBe(200);
    expect((await health.json()).reachable).toBe(true);
    const report = await app.handle(request('/api/admin/publishers/sgi-europe/test-report', { method: 'POST', body: JSON.stringify({ companyUrl: 'nike.com', jobTitle: 'Head of Retail' }) }, cookie));
    expect(report.status, await report.clone().text()).toBe(201);
  });

  it('logs safe saved-source diagnostics when an SGI test report cannot reach RSS', async () => {
    const source = sgiEuropeManifest.contentSource!;
    const legacyManifest = { ...sgiEuropeManifest, contentSource: { type: 'rss', feed: source.type === 'rss' ? source.feedUrl : undefined } as never };
    const memory = new MemoryPublisherStore([legacyManifest]);
    const store: PublisherStore = { mode: 'postgres', list: () => memory.list(), get: (publisherId) => memory.get(publisherId), create: (manifest) => memory.create(manifest), update: (manifest) => memory.update(manifest) };
    const errors: Array<{ message: string; fields?: ServerLogFields }> = [];
    const logger: StructuredLogger = { info: () => undefined, error: (message, fields) => errors.push({ message, fields }) };
    const app = createProductionApp({
      environment: 'test',
      serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' },
      publisherStore: store,
      fetchImpl: async () => new Response('upstream unavailable', { status: 503 }),
      companyContextProvider: { getContext: async () => ({ domain: 'ldsystems.uk', canonicalUrl: 'https://ldsystems.uk/', name: 'LD Systems', industry: 'technology', description: 'A software company.', topics: ['technology'], entities: ['LD Systems'], source: 'demo-fixture', fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
      logger,
    });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/sgi-europe/test-report', { method: 'POST', body: JSON.stringify({ companyUrl: 'https://ldsystems.uk/', jobTitle: 'Technology professional' }) }, cookie));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'generation_unavailable', code: 'unavailable', requestId: expect.any(String) });
    const diagnostic = errors.find((entry) => entry.message === 'admin_generation_unavailable');
    expect(diagnostic?.fields).toMatchObject({ publisherId: 'sgi-europe', registryMode: 'postgres', sourceType: 'rss', sourceConfigured: true, adapterResolved: true, failureStage: 'source_fetch_failed', errorName: 'ContentSourceError' });
    expect(diagnostic?.fields?.errorMessage).toBe('Source returned HTTP 503.');
    expect(JSON.stringify(diagnostic)).not.toContain('upstream unavailable');
  });

  it('validates drafts, rejects credential-shaped public headers, and keeps configuration source-controlled', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const valid = await app.handle(request('/api/admin/publishers/demo/validate', { method: 'POST', body: JSON.stringify(demoManifest) }, cookie));
    expect(valid.status).toBe(200);
    expect((await valid.json()).valid).toBe(true);
    const unsafeDraft = { ...demoManifest, contentSource: { type: 'rest-json', baseUrl: 'https://content.example', endpoint: '/search', headers: { Authorization: 'Bearer do-not-return-this' } } };
    const invalid = await app.handle(request('/api/admin/publishers/demo/validate', { method: 'POST', body: JSON.stringify(unsafeDraft) }, cookie));
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.text();
    expect(invalidBody).not.toContain('do-not-return-this');
    const mutation = await app.handle(request('/api/admin/publishers/demo/config', { method: 'PATCH', body: JSON.stringify({ ...demoManifest, branding: { ...demoManifest.branding, primaryAccent: '#123456' } }) }, cookie));
    expect(mutation.status).toBe(200);
    expect((await mutation.json()).persistence).toBe('publisher-store');
  });

  it('returns a safe detail view, embed contract and publisher-scoped analytics link', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/demo', {}, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { embed: string; links: { analytics: string }; publisher: { publisherId: string } };
    expect(body.publisher.publisherId).toBe('demo');
    expect(body.embed).toContain('<script src="https://admin.example/widget.js" data-publisher="demo"');
    expect(body.links.analytics).toBe('/analytics?publisher=demo');
    const ibiResponse = await app.handle(request('/api/admin/publishers/ibi', {}, cookie));
    expect(ibiResponse.status).toBe(200);
    const ibiBody = await ibiResponse.json() as { embed: string; publisher: { allowedOrigins: string[]; contentSource: { type: string } } };
    expect(ibiBody.embed).toContain('<script src="https://admin.example/widget.js" data-publisher="ibi"');
    expect(ibiBody.publisher).toMatchObject({ allowedOrigins: ['https://ibinews.com', 'https://www.ibinews.com'], contentSource: { type: 'sitemap' } });
  });

  it('rejects cross-origin admin mutations and supports logout', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const crossOrigin = new Request('https://admin.example/api/admin/publishers/demo/content-check', { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: cookie } });
    expect((await app.handle(crossOrigin)).status).toBe(403);
    const logout = await app.handle(request('/api/admin/logout', { method: 'POST' }, cookie));
    expect(logout.status).toBe(200);
    expect((await app.handle(request('/api/admin/publishers', {}, cookie))).status).toBe(401);
  });
});
