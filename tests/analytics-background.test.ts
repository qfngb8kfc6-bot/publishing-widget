import { describe, expect, it } from 'vitest';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import type { StoredAnalyticsEvent } from '../src/analytics/types';
import { createProductionApp } from '../src/server/production';
import { sgiEuropeRssFixture } from '../src/publishers/sgi-europe/fixtures';

const companyContext = (domain: string) => ({
  domain,
  canonicalUrl: `https://${domain}/`,
  name: 'Nike',
  industry: 'sporting goods',
  description: 'A sporting goods company.',
  topics: ['retail'],
  entities: ['Nike'],
  source: 'submitted-domain' as const,
  fetchedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  analysisVersion: 'test-v1',
});

function app(analyticsStore: MemoryAnalyticsStore, logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = []) {
  return createProductionApp({
    environment: 'test',
    serverEnvironment: {},
    analyticsStore,
    fetchImpl: async () => new Response(sgiEuropeRssFixture, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
    companyContextProvider: { getContext: async (domain: string) => companyContext(domain) },
    logger: {
      info: (message, fields) => logs.push({ level: 'info', message, fields: fields as Record<string, unknown> }),
      error: (message, fields) => logs.push({ level: 'error', message, fields: fields as Record<string, unknown> }),
    },
  });
}

function generate(target: ReturnType<typeof app>) {
  return target.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publisherId: 'sgi-europe', companyUrl: 'nike.com', jobTitle: 'Head of Retail' }),
  }));
}

class SlowAnalyticsStore extends MemoryAnalyticsStore {
  inFlight = 0;
  maxInFlight = 0;

  override async append(events: StoredAnalyticsEvent[]): Promise<void> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await super.append(events);
    this.inFlight -= 1;
  }
}

class FailingAnalyticsStore extends MemoryAnalyticsStore {
  override async append(): Promise<void> {
    throw new Error('connection refused');
  }
}

describe('background analytics writes', () => {
  it('returns the report without waiting for analytics, then writes every event in order on one connection', async () => {
    const store = new SlowAnalyticsStore();
    const target = app(store);
    const startedAt = Date.now();
    const response = await generate(target);
    const elapsed = Date.now() - startedAt;
    expect(response.status).toBe(201);
    // Nine sequential 150ms writes would take over 1.3s if they still blocked the request.
    expect(elapsed).toBeLessThan(1_000);
    expect(store.events.length).toBeLessThan(9);

    await target.flushAnalytics();
    const names = store.events.map((event) => event.name);
    expect(names[0]).toBe('generation_started');
    expect(names.at(-1)).toBe('report_generated');
    expect(names).toEqual(expect.arrayContaining(['company_analysis_completed', 'profile_generated', 'retrieval_completed', 'ranking_completed']));
    expect(store.events.every((event) => event.publisherId === 'sgi-europe')).toBe(true);
    expect(store.maxInFlight).toBe(1);
  });

  it('logs analytics failures without failing generation', async () => {
    const logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
    const target = app(new FailingAnalyticsStore(), logs);
    const response = await generate(target);
    expect(response.status).toBe(201);
    await target.flushAnalytics();
    const failures = logs.filter((entry) => entry.message === 'analytics_write_failed');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((entry) => entry.level === 'error' && entry.fields?.publisherId === 'sgi-europe' && entry.fields?.errorMessage === 'connection refused')).toBe(true);
    expect(failures.some((entry) => entry.fields?.operation === 'report_generated')).toBe(true);
    // Event metadata never reaches the log line.
    expect(JSON.stringify(failures)).not.toContain('resultCount');
  });
});
