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
    // Theme cards show only themes a report story supports; link them so the card copy is what is tested here.
    report.professionalProfile.themeArticleIds = Object.fromEntries((report.professionalProfile.themes ?? []).map((theme: string) => [theme, [report.recommendations[0].articleId]]));
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createDemoRegistry());
    const card = document.querySelector('.brief-card')!;
    expect(card.firstElementChild?.hasAttribute('data-coverage-note')).toBe(true);
    expect(card.firstElementChild?.textContent).toMatch(/coverage for software engineering is limited\. These are the closest stories/);
    // The generic fallback summary would repeat the note, so the card shows only the note and the buttons.
    expect(card.querySelector('.brief-lead')).toBeNull();
    expect(card.textContent).not.toMatch(/closest stories in the current coverage/);
    expect(document.querySelector('#highlights-heading')?.textContent).toBe('Closest themes in this coverage');
    const lines = [...document.querySelectorAll('.cx-theme-text')].map((line) => line.textContent ?? '');
    for (const line of lines) expect(line).not.toMatch(/Relevant to your/);
  });
});
