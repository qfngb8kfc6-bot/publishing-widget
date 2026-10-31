// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('guided publisher setup', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('lists WVC first, switches fields per source and runs the Test step without the key', async () => {
    document.body.innerHTML = '<main id="admin-root"></main>';
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/admin/session') return json({ authenticated: true, configured: true });
      if (path === '/api/admin/publishers') return json({ publishers: [], capabilities: { persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true } });
      if (path === '/api/admin/source-test') {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ wvc: { reachable: true, totalPages: 230, totalRecords: 11_480, lastPage: { page: 230, stories: 50, newestDatePublished: '2026-10-26T08:00:00.000Z', privateCount: 31, textLength: { min: 420, median: 3100, max: 19_800 }, coverage: { title: 100, url: 100, publishedAt: 100, description: 98, image: 64 }, titleField: 'HEADLINE', sampleTitles: ['Acme opens stores'] } } });
      }
      return json({ error: 'not_found' }, 404);
    }));
    await import('../src/admin');
    await vi.waitFor(() => expect(document.querySelector('#new-publisher')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('#new-publisher')!.click();
    await vi.waitFor(() => expect(document.querySelector('#new-publisher-form')).not.toBeNull());

    const labels = [...document.querySelectorAll('.source-kind strong')].map((label) => label.textContent);
    expect(labels).toEqual(['1. WVC API (recommended)', '2. WVC API + RSS', '3. RSS', '4. Sitemap']);
    expect(document.querySelector<HTMLInputElement>('input[name="sourceKind"]:checked')?.value).toBe('wvc');
    const group = (kinds: string) => document.querySelector<HTMLElement>(`[data-source-kinds="${kinds}"]`)!;
    expect(group('wvc wvc-rss').hidden).toBe(false);
    expect(group('wvc-rss rss').hidden).toBe(true);

    const set = (name: string, value: string) => { document.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value; };
    set('publisherId', 'acme'); set('name', 'Acme News'); set('wvcBaseUrl', 'https://news.acme.example/abaapi/storylistpagination/json'); set('wvcSecretEnv', 'ACME_WVC_API_KEY'); set('feedUrl', 'https://news.acme.example/feed.rss');
    const plusRss = document.querySelector<HTMLInputElement>('input[name="sourceKind"][value="wvc-rss"]')!;
    plusRss.checked = true;
    plusRss.dispatchEvent(new Event('change'));
    expect(group('wvc-rss rss').hidden).toBe(false);

    document.querySelector<HTMLButtonElement>('#test-source')!.click();
    await vi.waitFor(() => expect(document.querySelector('#source-test-output')?.textContent).toContain('WVC API reachable'));
    expect(bodies[0].contentSource).toEqual({ type: 'wvc', baseUrl: 'https://news.acme.example/abaapi/storylistpagination/json', profileName: 'Editorial Finder', pageSize: 50, secretRef: 'env:ACME_WVC_API_KEY', allowedHostnames: ['news.acme.example'], rss: { feedUrl: 'https://news.acme.example/feed.rss' } });
    expect(bodies[0].content.adapterId).toBe('wvc');
    const output = document.querySelector('#source-test-output')!.textContent!;
    // The subscriber-only excerpt setting is off unless ticked.
    expect(bodies[0].contentSource).not.toHaveProperty('showPrivateExcerpts');
    expect(document.querySelector('label[for="wvc-private-excerpts"], #wvc-private-excerpts')?.closest('label')?.textContent).toContain('Show text excerpt as description for subscriber-only stories');
    document.querySelector<HTMLInputElement>('#wvc-private-excerpts')!.checked = true;
    document.querySelector<HTMLButtonElement>('#test-source')!.click();
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].contentSource.showPrivateExcerpts).toBe(true);
    for (const expected of ['230', '11480', '31 subscriber-only', 'median 3100', '100% (HEADLINE)', 'Images in text64%', 'Acme opens stores']) expect(output.replace(/[ ,]/g, (match) => (match === ',' ? '' : ' '))).toContain(expected);
  });
});
