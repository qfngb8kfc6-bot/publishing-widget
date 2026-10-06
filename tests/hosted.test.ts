// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { renderHostedRoute } from '../src/hosted';
import { createProductionApp } from '../src/server/production';

describe('hosted professional experience', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('renders a true hosted generation page with publisher branding, loading fallback and profile context', async () => {
    const registry = createDemoRegistry();
    window.history.replaceState({}, '', '/p/demo/generate/report-12345678');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ companyName: 'LD Systems', companyDomain: 'ldsystems.uk', jobTitle: 'Software Engineer' })));

    await renderHostedRoute(document, registry);

    expect(document.querySelector('.hosted-shell')).not.toBeNull();
    expect(document.querySelector('.hosted-card')?.textContent).toContain('Northstar Journal');
    expect(document.querySelector('.hosted-card')?.textContent).toContain('Software Engineer at LD Systems');
    expect(document.querySelector('.progress')).not.toBeNull();
    const styles = document.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('--loading-fallback:#dfe9dc');
    expect(styles).toContain('--report-fallback:#28583f');
    expect(styles).toContain('@media(max-width:680px)');
    expect(styles).toContain('.hosted-shell.report{background-image:');
  });

  it('loads the persisted report page without invoking generation or rendering the embed widget', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    const payload = await generated.json() as { reportId: string };
    const reportResponse = await app.handle(new Request(`https://product.example/api/reports/${payload.reportId}?publisherId=demo`));
    const report = await reportResponse.json();
    window.history.replaceState({}, '', `/p/demo/${payload.reportId}`);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));

    await renderHostedRoute(document, createDemoRegistry());

    expect(document.querySelector('.hosted-shell.report')).not.toBeNull();
    expect(document.body.textContent).toContain('Software Engineer at LD Systems');
    expect(document.body.textContent).toContain('Why this matters to you');
    expect(document.querySelector<HTMLAnchorElement>('[data-story-id]')?.href).toMatch(/^https:\/\/demo\.publisher\.example\//);
    expect(document.querySelector('content-discovery-widget')).toBeNull();
    expect(document.querySelector('[data-share]')).not.toBeNull();
    expect(document.querySelector('[data-edit]')).not.toBeNull();
  });
});
