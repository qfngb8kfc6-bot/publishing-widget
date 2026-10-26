// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { renderHostedRoute } from '../src/hosted';
import { createProductionApp } from '../src/server/production';

describe('limited-coverage report page', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('shows the honest note first on the summary card and does not overclaim on theme cards', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }) }));
    const { reportId } = await generated.json() as { reportId: string };
    const report = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json();
    expect(report.professionalProfile.coverage?.limited).toBe(true);
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createDemoRegistry());
    const card = document.querySelector('.match-summary-card')!;
    expect(card.firstElementChild?.className).toBe('coverage-note');
    expect(card.firstElementChild?.textContent).toMatch(/coverage for software engineering is limited\. These are the closest stories/);
    expect(document.querySelector('#highlights-heading')?.textContent).toBe('Closest themes in this coverage');
    const lines = [...document.querySelectorAll('.highlight-card p')].map((line) => line.textContent ?? '');
    for (const line of lines) expect(line).not.toMatch(/Relevant to your/);
  });
});
