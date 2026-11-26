import { describe, expect, it } from 'vitest';
import { defaultPrivacyPolicy, privacyNoticeText, validatePublisherManifest } from '../src/core';
import { demoManifest } from '../src/demo/config';
import { MemoryFeedbackStore } from '../src/reports/feedback';
import { analyticsRetentionDays, ReportRetention, reportRetentionDays } from '../src/reports/retention';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import { PostgresAnalyticsStore } from '../src/analytics/postgres-store';
import type { StoredAnalyticsEvent } from '../src/analytics/types';
import { MemoryReportStore, PostgresReportStore, type ReportRecord } from '../src/reports';
import { MemoryPublisherStore } from '../src/publishers/store';
import { createProductionApp } from '../src/server/production';

const DAY_MS = 86_400_000;

describe('report retention', () => {
  it('reads REPORT_RETENTION_DAYS (7-3650 whole days), else 365', () => {
    expect(reportRetentionDays({})).toBe(365);
    expect(reportRetentionDays({ REPORT_RETENTION_DAYS: '90' })).toBe(90);
    for (const value of ['0', '3', '-1', '12.5', 'forever', '9999']) expect(reportRetentionDays({ REPORT_RETENTION_DAYS: value }), value).toBe(365);
  });

  it('deletes reports older than the period and their feedback; keeps newer ones', async () => {
    const reports = new MemoryReportStore();
    const feedback = new MemoryFeedbackStore();
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const report = (id: string, ageDays: number) => ({ id, publisherId: 'demo', createdAt: new Date(Date.now() - ageDays * DAY_MS).toISOString() }) as ReportRecord;
    for (const [id, age] of [['old-1', 400], ['old-2', 366], ['new-1', 364], ['new-2', 5]] as const) {
      await reports.save(report(id, age));
      await feedback.record({ publisherId: 'demo', reportId: id, vote: 'up', createdAt: new Date().toISOString() });
    }
    const retention = new ReportRetention({ days: 365, reports, feedback, logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined } });
    expect(await retention.run()).toEqual({ reportsDeleted: 2, feedbackDeleted: 2, analyticsEventsDeleted: 0 });
    expect([...reports.reports.keys()].sort()).toEqual(['new-1', 'new-2']);
    expect(feedback.all().map((entry) => entry.reportId).sort()).toEqual(['new-1', 'new-2']);
    expect(logs.find((entry) => entry.message === 'report_retention_cleanup')?.fields).toMatchObject({ reportsDeleted: 2, feedbackDeleted: 2, retentionDays: 365 });
  });

  it('Postgres deletes the oldest reports first, in batches (recommendations cascade)', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const store = new PostgresReportStore({ query: async (sql: string, parameters?: unknown[]) => { queries.push({ sql, parameters }); return { rows: [{ id: 'r1' }] as never[] }; } });
    expect(await store.deleteCreatedBefore(new Date('2025-11-25T00:00:00.000Z'), 500)).toEqual(['r1']);
    expect(queries[0].sql).toBe('DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE created_at < $1 ORDER BY created_at LIMIT $2) RETURNING id');
    expect(queries[0].parameters).toEqual(['2025-11-25T00:00:00.000Z', 500]);
  });
});

describe('analytics event retention', () => {
  const event = (eventId: string, publisherId: string, ageDays: number) => ({ eventId, schemaVersion: '1', publisherId, name: 'report_viewed', timestamp: new Date(Date.now() - ageDays * DAY_MS).toISOString(), sessionId: 's', receivedAt: new Date().toISOString() }) as StoredAnalyticsEvent;

  it('reads ANALYTICS_RETENTION_DAYS (7-3650 whole days), else 365', () => {
    expect(analyticsRetentionDays({})).toBe(365);
    expect(analyticsRetentionDays({ ANALYTICS_RETENTION_DAYS: '180' })).toBe(180);
    for (const value of ['0', '6', 'never', '3651', '30.5']) expect(analyticsRetentionDays({ ANALYTICS_RETENTION_DAYS: value }), value).toBe(365);
  });

  it('deletes events older than the period for every publisher in the same cleanup run, keeps newer ones', async () => {
    const analytics = new MemoryAnalyticsStore();
    await analytics.append([event('a-old', 'demo', 200), event('a-new', 'demo', 10), event('b-old', 'sgi-europe', 181), event('b-new', 'sgi-europe', 179)]);
    const logs: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const retention = new ReportRetention({ days: 365, reports: new MemoryReportStore(), analytics, analyticsDays: 180, logger: { info: (message, fields) => logs.push({ message, fields: (fields ?? {}) as Record<string, unknown> }), error: () => undefined } });
    expect(await retention.run()).toEqual({ reportsDeleted: 0, feedbackDeleted: 0, analyticsEventsDeleted: 2 });
    expect(analytics.events.map((item) => item.eventId).sort()).toEqual(['a-new', 'b-new']);
    expect(logs.find((entry) => entry.message === 'report_retention_cleanup')?.fields).toMatchObject({ analyticsEventsDeleted: 2, analyticsRetentionDays: 180, retentionDays: 365 });
  });

  it('Postgres deletes per publisher, oldest first, in batches, and counts the rows', async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const store = new PostgresAnalyticsStore({ query: async (sql: string, parameters?: unknown[]) => { queries.push({ sql, parameters }); return { rows: [], rowCount: 42 }; } });
    expect(await store.deleteOccurredBefore('demo', new Date('2025-11-26T00:00:00.000Z'), 5000)).toBe(42);
    expect(queries[0].sql).toBe('DELETE FROM analytics_events WHERE event_id IN (SELECT event_id FROM analytics_events WHERE publisher_id = $1 AND occurred_at < $2 ORDER BY occurred_at LIMIT $3)');
    expect(queries[0].parameters).toEqual(['demo', '2025-11-26T00:00:00.000Z', 5000]);
  });

  it('is wired into the app from ANALYTICS_RETENTION_DAYS', () => {
    expect(createProductionApp({ environment: 'test', serverEnvironment: { ANALYTICS_RETENTION_DAYS: '90' } }).reportRetention.analyticsDays).toBe(90);
    expect(createProductionApp({ environment: 'test' }).reportRetention.analyticsDays).toBe(365);
  });
});

describe('privacy notice and page', () => {
  const get = (app: ReturnType<typeof createProductionApp>) => app.handle(new Request('https://discovery.ldsystems.uk/api/publishers/demo/privacy'));

  it('says what is stored, why and for how long', () => {
    expect(privacyNoticeText()).toBe('We store the company and role you enter and the briefing we generate, so we can build it and show it at its link. We delete them after 1 year.');
    expect(privacyNoticeText(90)).toContain('after 3 months');
    const page = defaultPrivacyPolicy('SGI Europe', 365);
    expect(page).toContain('company (name or website) and job role');
    expect(page).toContain('deleted 1 year after they were created');
  });

  it('serves the default text with the configured retention, or the publisher\'s own text from admin', async () => {
    const defaults = await (await get(createProductionApp({ environment: 'test', serverEnvironment: { REPORT_RETENTION_DAYS: '180' } }))).json();
    expect(defaults).toMatchObject({ custom: false, retentionDays: 180 });
    expect(defaults.text).toContain('deleted 6 months after they were created');
    const own = await (await get(createProductionApp({ environment: 'test', publisherStore: new MemoryPublisherStore([{ ...demoManifest, privacyPolicy: 'Our privacy page\n\nWe keep briefings for a year.' }]) }))).json();
    expect(own).toMatchObject({ custom: true, retentionDays: 365, text: 'Our privacy page\n\nWe keep briefings for a year.' });
  });

  it('accepts a privacy page of at most 20,000 characters in the manifest', () => {
    expect(() => validatePublisherManifest({ ...demoManifest, privacyPolicy: 'x'.repeat(20_000) })).not.toThrow();
    expect(() => validatePublisherManifest({ ...demoManifest, privacyPolicy: 'x'.repeat(20_001) })).toThrow(/privacyPolicy/);
  });
});
