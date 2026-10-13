import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/core';
import { realPublisherSearchFixture } from '../src/publishers/real-publisher/fixtures';
import { createProductionApp } from '../src/server/production';
import { PostgresAnalyticsStore } from '../src/analytics/postgres-store';

describe('production-style route integration', () => {
  it('proxies a configured publisher request without exposing upstream credentials', async () => {
    let upstreamAuthorization = '';
    const app = createProductionApp({
      environment: 'production',
      serverEnvironment: {
        REAL_PUBLISHER_UPSTREAM_BASE_URL: 'https://upstream.example',
        REAL_PUBLISHER_API_TOKEN: 'test-server-token',
        PUBLISHER_REAL_PUBLISHER_ALLOWED_ORIGINS: 'https://approved.example',
      },
      fetchImpl: async (_input, init) => {
        upstreamAuthorization = new Headers(init?.headers).get('Authorization') ?? '';
        return new Response(JSON.stringify(realPublisherSearchFixture), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const response = await app.handle(new Request('https://product.example/api/publishers/real-publisher/search?q=sustainability&page=1&limit=30', { headers: { Origin: 'https://approved.example' } }));
    expect(response.status).toBe(200);
    expect(upstreamAuthorization).toBe('Bearer test-server-token');
    expect(await response.text()).not.toContain('test-server-token');
    expect(response.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('ingests article click analytics and returns a scoped overview', async () => {
    const app = createProductionApp({ environment: 'production', serverEnvironment: { PUBLISHER_DEMO_ALLOWED_ORIGINS: 'https://approved.example' } });
    const event = createEvent('article_clicked', 'demo', 'session-1', { articleId: 'article-1', articlePosition: 1, articleCategory: 'Technology', articleTitle: 'Story' }, '1');
    const ingest = await app.handle(new Request('https://product.example/api/analytics/events', { method: 'POST', headers: { Origin: 'https://approved.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [event] }) }));
    expect(ingest.status).toBe(202);
    const overview = await app.handle(new Request('https://product.example/api/analytics/demo/overview', { headers: { Origin: 'https://approved.example' } }));
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({ publisherId: 'demo', publisherName: 'Northstar Journal', overview: { articleClicks: 1, storyClicks: 1 } });
  });

  it('returns a valid zero-data overview through the production Postgres store path', async () => {
    const analyticsStore = new PostgresAnalyticsStore({ query: async <Row>() => ({ rows: [] as Row[] }) });
    const app = createProductionApp({ environment: 'production', analyticsStore, analyticsStoreMode: 'postgres' });
    const overview = await app.handle(new Request('https://discovery.ldsystems.uk/api/analytics/demo/overview'));
    expect(overview.status).toBe(200);
    const body = await overview.json() as { publisherId: string; overview: { widgetImpressions: number }; daily: unknown[] };
    expect(body).toMatchObject({ publisherId: 'demo', overview: { widgetImpressions: 0 }, daily: [] });
  });
});
