// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHostedRoute } from '../src/hosted';
import { createPublisherRegistry } from '../src/publishers/registry';
import { createProductionApp } from '../src/server/production';

describe('hosted privacy page and report footer', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('renders the publisher\'s privacy text as escaped paragraphs at /p/:publisherId/privacy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: 'Your data\n\nWe keep <b>briefings</b> for 6 months.\n\nAsk us anything.', retentionDays: 180 })));
    window.history.replaceState({}, '', '/p/demo/privacy');
    await renderHostedRoute(document, createPublisherRegistry());
    const page = document.querySelector('.privacy-page')!;
    expect(page.querySelector('h1')?.textContent).toBe('Your data');
    expect([...page.querySelectorAll('p')].map((p) => p.textContent)).toEqual(expect.arrayContaining(['We keep <b>briefings</b> for 6 months.', 'Ask us anything.']));
    expect(page.querySelector('b')).toBeNull();
  });

  it('shows the privacy line in the report footer with the configured retention', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Technology professional' }) }));
    const { reportId } = await generated.json() as { reportId: string };
    const report = await app.reportStore.get(reportId, 'demo');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (String(input).includes('/privacy') ? Response.json({ retentionDays: 90 }) : String(input).includes('/api/analytics') ? Response.json({ accepted: true }) : Response.json(report))));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createPublisherRegistry());
    await vi.waitFor(() => expect(document.querySelector('.report-privacy [data-privacy-text]')?.textContent).toContain('after 3 months'));
    expect(document.querySelector<HTMLAnchorElement>('.report-privacy a')?.getAttribute('href')).toBe('/p/demo/privacy');
  });
});
