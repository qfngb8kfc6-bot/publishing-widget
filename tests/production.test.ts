import { describe, expect, it } from 'vitest';
import { createProductionApp, resolveCommitSha, runConfiguredAIHealthCheck } from '../src/server/production';
import { SlidingWindowRateLimiter } from '../src/server/rate-limit';
import { originAllowed } from '../src/server/cors';
import { demoManifest } from '../src/demo/config';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createEvent } from '../src/core';

describe('production boundaries', () => {
  it('reports the deployed commit from COMMIT_SHA, GIT_SHA or RENDER_GIT_COMMIT', async () => {
    expect(resolveCommitSha({})).toBeUndefined();
    expect(resolveCommitSha({ RENDER_GIT_COMMIT: 'render-sha' })).toBe('render-sha');
    expect(resolveCommitSha({ GIT_SHA: 'git-sha', RENDER_GIT_COMMIT: 'render-sha' })).toBe('git-sha');
    expect(resolveCommitSha({ COMMIT_SHA: 'commit-sha', GIT_SHA: 'git-sha', RENDER_GIT_COMMIT: 'render-sha' })).toBe('commit-sha');
    const app = createProductionApp({ environment: 'production', serverEnvironment: {}, commitSha: resolveCommitSha({ RENDER_GIT_COMMIT: 'render-sha' }) });
    expect(await (await app.handle(new Request('https://product.example/health'))).json()).toMatchObject({ status: 'ok', commitSha: 'render-sha' });
  });

  it('serves safe health data and disables mock AI in production', async () => {
    const app = createProductionApp({ environment: 'production', serverEnvironment: {} });
    const health = await app.handle(new Request('https://product.example/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', environment: 'production', version: '0.5.0' });
    const ai = await app.handle(new Request('https://product.example/api/ai/intent', { method: 'POST', body: JSON.stringify({ intent: {} }) }));
    expect(ai.status).toBe(503);
    const readiness = await app.handle(new Request('https://product.example/ready'));
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toMatchObject({ status: 'not_ready', analyticsStore: 'memory' });
  });

  it('allows only configured production origins and rejects unapproved publisher requests', async () => {
    const app = createProductionApp({ environment: 'production', serverEnvironment: { PUBLISHER_REAL_PUBLISHER_ALLOWED_ORIGINS: 'https://approved.example' } });
    const rejected = await app.handle(new Request('https://product.example/api/publishers/real-publisher/search?q=test', { headers: { Origin: 'https://unapproved.example' } }));
    expect(rejected.status).toBe(403);
    const approved = await app.handle(new Request('https://product.example/api/publishers/real-publisher/search?q=test', { headers: { Origin: 'https://approved.example' } }));
    expect(approved.status).toBe(503);
    expect(approved.headers.get('Access-Control-Allow-Origin')).toBe('https://approved.example');
  });

  it('applies tenant origin checks to hosted report reads', async () => {
    const app = createProductionApp({ environment: 'production', serverEnvironment: { PUBLISHER_DEMO_ALLOWED_ORIGINS: 'https://approved.example' } });
    const rejected = await app.handle(new Request('https://product.example/api/reports/missing-report?publisherId=demo', { headers: { Origin: 'https://unapproved.example' } }));
    expect(rejected.status).toBe(403);
    const approved = await app.handle(new Request('https://product.example/api/reports/missing-report?publisherId=demo', { headers: { Origin: 'https://approved.example' } }));
    expect(approved.status).toBe(404);
    expect(approved.headers.get('Access-Control-Allow-Origin')).toBe('https://approved.example');
  });

  it('supports localhost in development and rate limits by route scope', () => {
    expect(originAllowed(demoManifest, 'http://localhost:5173', 'development')).toBe(true);
    expect(originAllowed(demoManifest, 'https://outside.example', 'production')).toBe(false);
    expect(originAllowed(sgiEuropeManifest, 'https://discovery.ldsystems.uk', 'production', { allowPlatformOrigin: true, platformOrigin: 'https://discovery.ldsystems.uk' })).toBe(true);
    expect(originAllowed(sgiEuropeManifest, 'https://www.sgieurope.com', 'production')).toBe(true);
    expect(originAllowed(sgiEuropeManifest, 'https://sgieurope.com', 'production')).toBe(true);
    expect(originAllowed(sgiEuropeManifest, 'https://evil.example', 'production', { allowPlatformOrigin: true, platformOrigin: 'https://discovery.ldsystems.uk' })).toBe(false);
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('search:demo:client').allowed).toBe(true);
    expect(limiter.check('search:demo:client').allowed).toBe(false);
    expect(limiter.check('search:other:client').allowed).toBe(true);
  });

  it('allows the first-party platform for hosted SGI report actions while preserving publisher origin enforcement', async () => {
    const app = createProductionApp({
      environment: 'production',
      serverEnvironment: { PLATFORM_ORIGIN: 'https://discovery.ldsystems.uk' },
      fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
      publisherStore: new MemoryPublisherStore([sgiEuropeManifest]),
      companyContextProvider: { getContext: async (domain: string) => ({ domain, canonicalUrl: `https://${domain}/`, name: 'Nike', industry: 'sporting goods', description: 'A sporting goods company.', topics: ['retail', 'innovation'], entities: ['Nike'], source: 'submitted-domain' as const, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), analysisVersion: 'test' }) },
    });
    const generated = await app.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', {
      method: 'POST',
      headers: { Origin: 'https://discovery.ldsystems.uk', 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }),
    }));
    expect(generated.status, await generated.clone().text()).toBe(201);
    const payload = await generated.json() as { reportId: string };
    const report = await app.reportStore.get(payload.reportId, 'sgi-europe');
    if (!report) throw new Error('SGI report was not persisted.');
    const theme = report.professionalProfile.professionalInterests[0];
    if (!theme) throw new Error('SGI report did not contain a theme.');
    const themePath = `https://discovery.ldsystems.uk/api/reports/${payload.reportId}/themes/${encodeURIComponent(theme)}/search?publisherId=sgi-europe`;

    for (const origin of ['https://discovery.ldsystems.uk', 'https://www.sgieurope.com', 'https://sgieurope.com']) {
      const response = await app.handle(new Request(themePath, { method: 'POST', headers: { Origin: origin } }));
      expect(response.status, `${origin}: ${await response.clone().text()}`).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
    const preflight = await app.handle(new Request(themePath, { method: 'OPTIONS', headers: { Origin: 'https://discovery.ldsystems.uk', 'Access-Control-Request-Method': 'POST' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://discovery.ldsystems.uk');
    const rejected = await app.handle(new Request(themePath, { method: 'POST', headers: { Origin: 'https://evil.example' } }));
    expect(rejected.status).toBe(403);

    const event = createEvent('widget_impression', 'sgi-europe', 'hosted-session');
    for (const origin of ['https://discovery.ldsystems.uk', 'https://www.sgieurope.com', 'https://sgieurope.com']) {
      const analytics = await app.handle(new Request('https://discovery.ldsystems.uk/api/analytics/events', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event] }) }));
      expect(analytics.status, `${origin}: ${await analytics.clone().text()}`).toBe(202);
      expect(analytics.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
    const rejectedAnalytics = await app.handle(new Request('https://discovery.ldsystems.uk/api/analytics/events', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event] }) }));
    expect(rejectedAnalytics.status).toBe(403);
    const overview = await app.handle(new Request('https://discovery.ldsystems.uk/api/analytics/sgi-europe/overview', { headers: { Origin: 'https://discovery.ldsystems.uk' } }));
    expect(overview.status).toBe(200);
    expect(overview.headers.get('Access-Control-Allow-Origin')).toBe('https://discovery.ldsystems.uk');
  });

  it('accepts the local Vite origin for demo generation while production remains allowlisted', async () => {
    const developmentApp = createProductionApp({ environment: 'development' });
    const localResponse = await developmentApp.handle(new Request('http://localhost:8787/api/reports/generate', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'https://ldsystems.uk/', jobTitle: 'Software Engineer' }),
    }));
    expect(localResponse.status).toBe(201);
    expect(localResponse.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');

    const productionApp = createProductionApp({ environment: 'production', serverEnvironment: { PUBLISHER_DEMO_ALLOWED_ORIGINS: 'https://discovery.ldsystems.uk' } });
    const productionResponse = await productionApp.handle(new Request('https://discovery.ldsystems.uk/api/reports/generate', {
      method: 'POST',
      headers: { Origin: 'https://discovery.ldsystems.uk', 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'https://ldsystems.uk/', jobTitle: 'Software Engineer' }),
    }));
    expect(productionResponse.status).toBe(201);
    expect(productionResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://discovery.ldsystems.uk');
  });

  it('does not trust forwarding headers unless a proxy is explicitly enabled', async () => {
    const { requestRateLimitKey } = await import('../src/server/rate-limit');
    const first = new Request('https://product.example/api', { headers: { 'x-forwarded-for': '198.51.100.1' } });
    const second = new Request('https://product.example/api', { headers: { 'x-forwarded-for': '198.51.100.2' } });
    expect(requestRateLimitKey(first, 'ai', 'global')).toBe(requestRateLimitKey(second, 'ai', 'global'));
    expect(requestRateLimitKey(first, 'ai', 'global', true)).not.toBe(requestRateLimitKey(second, 'ai', 'global', true));
  });

  it('checks the professional profile AI contract without exposing the server key', async () => {
    let requestBody = '';
    const result = await runConfiguredAIHealthCheck({ AI_ENABLED: 'true', AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'server-only-health-key', AI_MODEL: 'test-model', AI_ENDPOINT: 'https://ai.example.test/chat/completions' }, async (_input, init) => {
      requestBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ company: { themes: ['technology'] }, person: { seniority: 'professional' }, professionalInterests: ['technology'], likelyInformationNeeds: ['technology developments'], relevantEntities: [], searchTerms: ['technology'], semanticQueries: ['technology developments'], excludedConcepts: [] }) } }] }), { status: 200 });
    });
    expect(result).toEqual({ status: 'ok', provider: 'openai-compatible' });
    expect(requestBody).not.toContain('server-only-health-key');
  });
});
