import { describe, expect, it } from 'vitest';
import type { AnalyticsStore } from '../src/analytics/types';
import { demoManifest } from '../src/demo/config';
import { createProductionApp } from '../src/server/production';
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
  it('requires server-side admin authentication and lists only safe publisher metadata', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    expect((await app.handle(request('/api/admin/publishers', {}, undefined))).status).toBe(401);
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers', {}, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { publishers: Array<{ publisherId: string; sourceType: string }> };
    expect(body.publishers.map((publisher) => publisher.publisherId)).toEqual(['demo', 'real-publisher']);
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
      expect(body.publishers.map((publisher) => publisher.publisherId)).toEqual(['demo', 'real-publisher']);
      const real = body.publishers.find((publisher) => publisher.publisherId === 'real-publisher')!;
      expect(real.sourceType).toBe('rest-json');
      expect(real.brandingSummary).toBeNull();
      expect(real.allowedOrigins).toEqual([]);
      expect(JSON.stringify(body)).not.toContain('server-only-token');
    } finally {
      definition.manifest = originalManifest;
      definition.config = originalConfig;
    }
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
    const mutation = await app.handle(request('/api/admin/publishers/demo/config', { method: 'PATCH', body: JSON.stringify(demoManifest) }, cookie));
    expect(mutation.status).toBe(409);
    expect((await mutation.json()).error).toBe('config_static_read_only');
  });

  it('returns a safe detail view, embed contract and publisher-scoped analytics link', async () => {
    const app = createProductionApp({ environment: 'test', serverEnvironment: { ADMIN_PASSWORD: 'test-admin-password' } });
    const cookie = await signIn(app);
    const response = await app.handle(request('/api/admin/publishers/demo', {}, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { embed: string; links: { analytics: string }; publisher: { publisherId: string } };
    expect(body.publisher.publisherId).toBe('demo');
    expect(body.embed).toContain('data-publisher="demo"');
    expect(body.links.analytics).toBe('/analytics?publisher=demo');
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
