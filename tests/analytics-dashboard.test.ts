// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createEvent } from '../src/core';
import { renderAnalyticsDashboard } from '../src/analytics-dashboard';
import { createSeedAnalyticsStore } from '../src/analytics/seed';
import { MemoryAnalyticsStore } from '../src/analytics/store';
import type { StoredAnalyticsEvent } from '../src/analytics/types';

function impression(sessionId: string, timestamp: string): StoredAnalyticsEvent {
  const event = createEvent('widget_impression', 'demo', sessionId, undefined, '1');
  return { ...event, eventId: `${sessionId}-${timestamp}`, schemaVersion: event.schemaVersion ?? '1.0', timestamp, receivedAt: timestamp };
}

describe('analytics dashboard', () => {
  it('renders useful seeded publisher-scoped data and exports', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderAnalyticsDashboard(root, await createSeedAnalyticsStore());
    expect(root.textContent).toContain('Briefing analytics');
    expect(root.textContent).toContain('Briefing funnel');
    expect(root.textContent).toContain('Who is using the briefing?');
    expect(root.textContent).toContain('Which stories drive engagement?');
    expect(root.querySelectorAll('[data-export]').length).toBe(2);
    expect(root.querySelector('table.activity-table')).not.toBeNull();
    expect(root.textContent).not.toContain('12:15:00');
    expect(root.textContent).not.toContain('questionnaire');
    expect(root.textContent).not.toContain('Legacy interest');
    expect(root.querySelector('table')).not.toBeNull();
  });

  it('renders daily bars from their actual relative counts', async () => {
    const root = document.createElement('div');
    const store = new MemoryAnalyticsStore();
    await store.append([
      impression('small-1', '2026-09-27T10:00:00.000Z'),
      impression('large-1', '2026-09-28T10:00:00.000Z'),
      impression('large-2', '2026-09-28T10:01:00.000Z'),
      impression('large-3', '2026-09-28T10:02:00.000Z'),
      impression('large-4', '2026-09-28T10:03:00.000Z'),
    ]);
    await renderAnalyticsDashboard(root, store);
    const heights = [...root.querySelectorAll<HTMLElement>('.day-bar-fill')].map((bar) => bar.style.height);
    expect(heights).toEqual(['25%', '100%']);
  });

  it('renders a factual empty state without NaN or broken dashboard copy', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderAnalyticsDashboard(root, { query: async () => [], append: async () => undefined, listPublisherIds: async () => ['demo'] });
    expect(root.textContent).toContain('No article impressions recorded in this period.');
    expect(root.textContent).toContain('No categorised industry data recorded in this period.');
    expect(root.textContent).not.toContain('NaN');
    expect(root.textContent).not.toContain('undefined');
  });
});
