// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('admin Test report form: "Did you mean …?"', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('suggests Nike for "Mike" under the company field, fills it on click, and never blocks the test', async () => {
    document.body.innerHTML = '<main id="admin-root"></main>';
    const calls: string[] = [];
    const reportBodies: Array<Record<string, unknown>> = [];
    const capabilities = { persistenceMode: 'postgres', writable: true, databaseBacked: true, createAllowed: true, editAllowed: true };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      calls.push(path);
      if (path.includes('/company-suggestion')) return json(new URL(path).searchParams.get('company') === 'Mike' ? { suggestion: 'Nike' } : {});
      if (path.endsWith('/test-report')) { reportBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return json({ reportUrl: '/p/sgi-europe/r1' }); }
      if (path === '/api/admin/session') return json({ authenticated: true, configured: true });
      if (path === '/api/admin/publishers') return json({ publishers: [{ publisherId: 'sgi-europe', name: 'SGI Europe', enabled: true, environment: 'production', sourceType: 'rss', allowedOrigins: [], contentCheck: null }], capabilities });
      if (path === '/api/admin/publishers/sgi-europe') return json({ publisher: { publisherId: 'sgi-europe', name: 'SGI Europe', environment: 'production', enabled: true, branding: {}, allowedOrigins: [], contentSource: { type: 'rss', feedUrl: 'https://www.sgieurope.com/9871.rss' } }, analytics: {}, lastContentCheck: null, embed: '<script></script>', links: { analytics: '/analytics?publisher=sgi-europe', publicDemo: '/?publisher=sgi-europe' }, persistence: 'publisher-store', capabilities });
      return json({ error: 'not_found' }, 404);
    }));
    vi.resetModules();
    await import('../src/admin');
    await vi.waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('Publishers'));
    document.querySelector<HTMLButtonElement>('.open-publisher[data-publisher="sgi-europe"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('h2')?.textContent).toBe('SGI Europe'));

    const company = document.querySelector<HTMLInputElement>('#company-url')!;
    const hint = document.querySelector<HTMLElement>('#company-suggestion')!;
    // The prefilled website is not looked up.
    expect(calls.some((call) => call.includes('/company-suggestion'))).toBe(false);
    company.value = 'Mike';
    company.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(hint.hidden).toBe(false), { timeout: 2000 });
    expect(hint.textContent).toBe('Did you mean Nike?');
    expect(calls.find((call) => call.includes('/company-suggestion'))).toBe(`${window.location.origin}/api/publishers/sgi-europe/company-suggestion?company=Mike`);

    // Ignoring the hint still runs the test for what was typed.
    document.querySelector<HTMLFormElement>('#report-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(reportBodies).toHaveLength(1));
    expect(reportBodies[0]).toMatchObject({ companyUrl: 'Mike' });

    hint.querySelector<HTMLButtonElement>('[data-use-company-suggestion]')!.click();
    expect(company.value).toBe('Nike');
    expect(hint.hidden).toBe(true);
  });
});
