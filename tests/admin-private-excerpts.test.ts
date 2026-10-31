// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const capabilities = { persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true };

describe('publisher settings: subscriber-only excerpts', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('shows the toggle for a WVC publisher and saves it into the content source', async () => {
    document.body.innerHTML = '<main id="admin-root"></main>';
    const saved: Array<Record<string, any>> = [];
    let source: Record<string, unknown> = { type: 'wvc', baseUrl: 'https://news.acme.example/abaapi/storylistpagination/json', profileName: 'Editorial Finder', pageSize: 50, secretRef: 'env:ACME_WVC_API_KEY', allowedHostnames: ['news.acme.example'] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/admin/session') return json({ authenticated: true, configured: true });
      if (path === '/api/admin/publishers') return json({ publishers: [{ publisherId: 'acme', name: 'Acme News', enabled: true, environment: 'production', sourceType: 'wvc', allowedOrigins: [], contentCheck: null }], capabilities });
      if (path === '/api/admin/publishers/acme/config' && init?.method === 'PATCH') { const body = JSON.parse(String(init.body)); saved.push(body); source = body.contentSource; return json({ publisher: body }); }
      if (path === '/api/admin/publishers/acme') return json({ publisher: { publisherId: 'acme', name: 'Acme News', environment: 'production', enabled: true, branding: {}, allowedOrigins: [], contentSource: source }, analytics: {}, lastContentCheck: null, embed: '<script></script>', links: { analytics: '#', publicDemo: '#' }, persistence: 'publisher-store', capabilities });
      return json({ error: 'not_found' }, 404);
    }));
    await import('../src/admin');
    await vi.waitFor(() => expect(document.querySelector('.open-publisher')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.open-publisher')!.click();
    await vi.waitFor(() => expect(document.querySelector('#publisher-private-excerpts')).not.toBeNull());
    const toggle = document.querySelector<HTMLInputElement>('#publisher-private-excerpts')!;
    expect(toggle.closest('label')?.textContent).toContain('Show text excerpt as description for subscriber-only stories');
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    document.querySelector<HTMLFormElement>('#draft-form')!.requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].contentSource.showPrivateExcerpts).toBe(true);

    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#publisher-private-excerpts')?.checked).toBe(true));
    document.querySelector<HTMLInputElement>('#publisher-private-excerpts')!.checked = false;
    document.querySelector<HTMLFormElement>('#draft-form')!.requestSubmit();
    await vi.waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1].contentSource).not.toHaveProperty('showPrivateExcerpts');
  });
});
