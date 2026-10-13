import { describe, expect, it } from 'vitest';
import { buildAnalyticsReport } from '../src/analytics/metrics';
import { PostgresAnalyticsStore } from '../src/analytics/postgres-store';

describe('PostgresAnalyticsStore', () => {
  it('normalizes postgres timestamp values before the metrics layer reads them', async () => {
    const store = new PostgresAnalyticsStore({
      query: async <Row>() => ({ rows: [{
        eventId: 'event-1', schemaVersion: '1.0', publisherId: 'demo', name: 'widget_impression',
        timestamp: new Date('2026-10-13T10:00:00.000Z'), sessionId: 'session-1', metadata: null,
        receivedAt: new Date('2026-10-13T10:00:01.000Z'),
      }] as unknown as Row[] }),
    });

    const events = await store.query({ publisherId: 'demo' });
    expect(events[0]?.timestamp).toBe('2026-10-13T10:00:00.000Z');
    expect(events[0]?.receivedAt).toBe('2026-10-13T10:00:01.000Z');
    expect(events[0]?.metadata).toEqual({});
    expect(buildAnalyticsReport(events, 'demo').daily).toEqual([{ date: '2026-10-13', impressions: 1, opens: 0, searches: 0, clicks: 0 }]);
  });

  it('returns an empty result for a publisher with no events', async () => {
    const store = new PostgresAnalyticsStore({ query: async <Row>() => ({ rows: [] as Row[] }) });
    const events = await store.query({ publisherId: 'demo' });
    expect(events).toEqual([]);
    expect(buildAnalyticsReport(events, 'demo').overview.widgetImpressions).toBe(0);
  });
});
