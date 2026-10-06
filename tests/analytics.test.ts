import { describe, expect, it } from 'vitest';
import { createEvent, type AnalyticsEventName } from '../src/core';
import { BatchingAnalyticsClient } from '../src/analytics/client';
import { reportToCsv } from '../src/analytics/export';
import { buildAnalyticsReport, dateRangeForPreset } from '../src/analytics/metrics';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import type { StoredAnalyticsEvent } from '../src/analytics/types';
import { createAnalyticsIngestionRoute } from '../src/server/analytics-route';
import { MAX_ANALYTICS_PAYLOAD_BYTES, validateAnalyticsEvent } from '../src/server/analytics-validation';

function event(name: AnalyticsEventName, publisherId: string, sessionId: string, timestamp: string, metadata?: Record<string, string | number | boolean>): StoredAnalyticsEvent {
  const created = createEvent(name, publisherId, sessionId, metadata, '1');
  return { ...created, eventId: `${publisherId}-${sessionId}-${name}-${timestamp}`, schemaVersion: created.schemaVersion ?? '1.0', timestamp, receivedAt: timestamp };
}

describe('publisher analytics', () => {
  it('validates the versioned event schema and rejects raw free text', () => {
    const valid = event('question_answered', 'demo', 'session-1', '2026-09-20T10:00:00.000Z', { questionId: 'about', questionKind: 'interest', answerType: 'free-text', freeTextUsed: true });
    expect(validateAnalyticsEvent(valid).metadata?.freeTextUsed).toBe(true);
    expect(() => validateAnalyticsEvent({ ...valid, metadata: { ...valid.metadata, answer: 'I am a named person' } })).toThrow('not allowed');
    expect(() => validateAnalyticsEvent({ ...valid, metadata: { ...valid.metadata, answerOptionId: 'secret free text' }, name: 'question_answered' })).toThrow('free-text');
  });

  it('ingests valid batches, rejects malformed payloads, and enforces allowed publishers', async () => {
    const store = new MemoryAnalyticsStore();
    const route = createAnalyticsIngestionRoute(store, { isPublisherAllowed: (publisherId) => publisherId === 'demo' });
    const valid = event('widget_impression', 'demo', 'session-1', '2026-09-20T10:00:00.000Z');
    await expect(route(new Request('https://host.test/api/analytics/events', { method: 'POST', body: JSON.stringify({ events: [valid] }) }))).resolves.toMatchObject({ status: 202 });
    await expect(route(new Request('https://host.test/api/analytics/events', { method: 'POST', body: '{bad' }))).resolves.toMatchObject({ status: 400 });
    const other = { ...valid, publisherId: 'other' };
    await expect(route(new Request('https://host.test/api/analytics/events', { method: 'POST', body: JSON.stringify({ events: [other] }) }))).resolves.toMatchObject({ status: 403 });
    await expect(route(new Request('https://host.test/api/analytics/events', { method: 'POST', body: 'x'.repeat(MAX_ANALYTICS_PAYLOAD_BYTES + 1) }))).resolves.toMatchObject({ status: 413 });
    expect((await store.query({ publisherId: 'demo' }))).toHaveLength(1);
  });

  it('keeps storage and metrics tenant-scoped', async () => {
    const store = new MemoryAnalyticsStore();
    await store.append([event('widget_impression', 'demo', 'd-1', '2026-09-20T10:00:00.000Z'), event('widget_impression', 'other', 'o-1', '2026-09-20T10:00:00.000Z')]);
    expect((await store.query({ publisherId: 'demo' })).every((item) => item.publisherId === 'demo')).toBe(true);
    const report = buildAnalyticsReport([
      event('widget_impression', 'demo', 'd-1', '2026-09-20T10:00:00.000Z'),
      event('widget_opened', 'demo', 'd-1', '2026-09-20T10:01:00.000Z'),
      event('question_answered', 'demo', 'd-1', '2026-09-20T10:02:00.000Z', { questionKind: 'interest', answerOptionId: 'technology', answerType: 'single-select' }),
      event('search_completed', 'demo', 'd-1', '2026-09-20T10:03:00.000Z', { resultCount: 4, rankingMode: 'hybrid' }),
      event('result_impression', 'demo', 'd-1', '2026-09-20T10:04:00.000Z', { articleId: 'a-1', articleTitle: 'Story', articleCategory: 'Technology', articlePosition: 1, articlePublishedAt: '2026-08-01' }),
      event('article_clicked', 'demo', 'd-1', '2026-09-20T10:05:00.000Z', { articleId: 'a-1', articleTitle: 'Story', articleCategory: 'Technology', articlePosition: 1, rankingMode: 'hybrid' }),
      event('widget_impression', 'other', 'o-1', '2026-09-20T10:00:00.000Z'),
    ], 'demo', { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' });
    expect(report.overview.widgetImpressions).toBe(1);
    expect(report.overview.articleClicks).toBe(1);
    expect(report.rankingModes).toEqual([{ mode: 'hybrid', searches: 1, clicks: 1, ctr: 100 }]);
    expect(report.topInterests[0]).toMatchObject({ label: 'technology', count: 1 });
    expect(report.positionPerformance[0]).toMatchObject({ position: 1, impressions: 1, clicks: 1, ctr: 100 });
  });

  it('measures the professional generation and hosted story funnel', () => {
    const report = buildAnalyticsReport([
      event('widget_impression', 'demo', 'professional-1', '2026-09-20T10:00:00.000Z'),
      event('widget_opened', 'demo', 'professional-1', '2026-09-20T10:01:00.000Z'),
      event('company_entered', 'demo', 'professional-1', '2026-09-20T10:02:00.000Z', { industry: 'marine' }),
      event('role_entered', 'demo', 'professional-1', '2026-09-20T10:03:00.000Z', { roleFunction: 'operations' }),
      event('report_generated', 'demo', 'professional-1', '2026-09-20T10:04:00.000Z', { reportId: 'report-1', resultCount: 2, rankingMode: 'deterministic' }),
      event('story_impression', 'demo', 'professional-1', '2026-09-20T10:05:00.000Z', { articleId: 'story-1', articleTitle: 'Story', articleCategory: 'Marine', articlePosition: 1 }),
      event('story_clicked', 'demo', 'professional-1', '2026-09-20T10:06:00.000Z', { articleId: 'story-1', articleTitle: 'Story', articleCategory: 'Marine', articlePosition: 1 }),
    ], 'demo');
    expect(report.overview.searchesCompleted).toBe(1);
    expect(report.overview.articleClicks).toBe(1);
    expect(report.funnel.map((stage) => stage.count)).toEqual([1, 1, 1, 1]);
    expect(report.topRecommendedArticles[0]).toMatchObject({ articleId: 'story-1', impressions: 1, clicks: 1 });
  });

  it('supports date presets, CSV exports, and non-blocking failed delivery', async () => {
    const range = dateRangeForPreset('7d', new Date('2026-09-28T12:00:00.000Z'));
    expect(range.from).toContain('2026-09-22');
    const report = buildAnalyticsReport([event('widget_impression', 'demo', 'd-1', '2026-09-27T10:00:00.000Z')], 'demo', range);
    expect(reportToCsv(report, 'daily')).toContain('date,impressions,opens,searches,clicks');
    const client = new BatchingAnalyticsClient({ flushIntervalMs: 0, fetchImpl: async () => { throw new Error('offline'); } });
    expect(() => client.track(event('article_clicked', 'demo', 'd-1', '2026-09-27T10:00:00.000Z'))).not.toThrow();
    await client.flush();
  });
});
