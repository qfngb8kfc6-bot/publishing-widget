// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('admin content health navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="admin-root"></main>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '<main id="admin-root"></main>';
  });

  it('opens content health, runs saved checks, renders failures, and returns to publishers', async () => {
    const calls: string[] = [];
    const publishers = [
      { publisherId: 'ibi', name: 'IBI News', enabled: true, environment: 'production', sourceType: 'sitemap', allowedOrigins: ['https://ibinews.com'], contentCheck: null },
      { publisherId: 'demo', name: 'Northstar Journal', enabled: true, environment: 'development', sourceType: 'demo', allowedOrigins: [], contentCheck: null },
    ];
    const successfulCheck = { checkedAt: '2026-10-13T10:00:00.000Z', reachable: true, sourceType: 'sitemap', recordsFetched: 30, accepted: 27, rejected: 2, duplicates: 1, warnings: [], elapsedMs: 142, sampleTitles: ['A real source title'], coverage: { image: 80, publishedAt: 100, description: 90 } };
    const failedCheck = { checkedAt: '2026-10-13T10:01:00.000Z', reachable: false, sourceType: 'demo', recordsFetched: 0, accepted: 0, rejected: 0, duplicates: 0, warnings: [], elapsedMs: 21, sampleTitles: [], coverage: { image: 0, publishedAt: 0, description: 0 }, error: { code: 'upstream_unavailable', message: 'Sitemap could not be reached.' } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === '/api/admin/session') return json({ authenticated: true, configured: true });
      if (path === '/api/admin/publishers') return json({ publishers, capabilities: { persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true } });
      if (path.endsWith('/ibi/content-check')) return json(successfulCheck);
      if (path.endsWith('/demo/content-check')) return json(failedCheck, 502);
      return json({ error: 'not_found' }, 404);
    }));

    await import('../src/admin');
    await vi.waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('Publishers'));

    document.querySelector<HTMLAnchorElement>('[data-admin-view="health"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('Content health'));
    expect(document.body.textContent).toContain('IBI News');
    expect(document.body.textContent).toContain('sitemap');
    expect(document.body.textContent).toContain('Not checked');

    const ibiButton = document.querySelector<HTMLButtonElement>('.run-health-check[data-publisher="ibi"]')!;
    ibiButton.click();
    expect(document.querySelector('[data-health-status="ibi"]')?.textContent).toContain('Checking');
    await vi.waitFor(() => expect(document.querySelector('[data-health-status="ibi"]')?.textContent).toContain('Reachable'));
    expect(document.querySelector('[data-health-detail="ibi"]')?.textContent).toContain('27 accepted');
    expect(calls).toContain('/api/admin/publishers/ibi/content-check');

    document.querySelector<HTMLButtonElement>('.run-health-check[data-publisher="demo"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-health-status="demo"]')?.textContent).toContain('Unavailable'));
    expect(document.body.textContent).toContain('Sitemap could not be reached.');
    expect(document.body.textContent).not.toContain('server-only-token');

    document.querySelector<HTMLAnchorElement>('[data-admin-view="publishers"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('Publishers'));
    expect(document.querySelector<HTMLAnchorElement>('a[href="/analytics?publisher=demo"]')).not.toBeNull();
  });
});
