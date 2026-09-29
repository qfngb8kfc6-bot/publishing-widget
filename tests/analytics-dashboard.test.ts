// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderAnalyticsDashboard } from '../src/analytics-dashboard';
import { createSeedAnalyticsStore } from '../src/analytics/seed';

describe('analytics dashboard', () => {
  it('renders useful seeded publisher-scoped data and exports', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await renderAnalyticsDashboard(root, await createSeedAnalyticsStore());
    expect(root.textContent).toContain('Discovery, measured.');
    expect(root.textContent).toContain('Top interests');
    expect(root.querySelectorAll('[data-export]').length).toBe(4);
    expect(root.querySelector('table')).not.toBeNull();
  });
});
