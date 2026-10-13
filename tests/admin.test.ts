import { describe, expect, it } from 'vitest';
import type { AnalyticsStore } from '../src/analytics/types';
import { createEvent } from '../src/core';
import { demoManifest } from '../src/demo/config';
import { createProductionApp } from '../src/server/production';
import { MemoryPublisherStore, type PublisherStore } from '../src/publishers/store';
import type { ServerLogFields, StructuredLogger } from '../src/server/logging';

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
