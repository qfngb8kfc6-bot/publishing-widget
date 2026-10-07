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
    expect(styles).toContain('--loading-fallback:#151A3A');
    expect(styles).toContain('--report-fallback:#2A2C8F');
    expect(styles).toContain('--palette-cyan:#12A8B4');
    expect(styles).toContain('@media(max-width:780px)');
    expect(styles).toContain('.hosted-shell.report{background-image:');
    expect(document.querySelector('.generation-progress')?.textContent).toContain('Reviewing relevant coverage');
    expect(styles).toContain('prefers-reduced-motion');
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
    expect(document.querySelector('.report-cover')).not.toBeNull();
    expect(document.querySelector('.featured-story')).not.toBeNull();
    expect(document.querySelectorAll('.story-card').length).toBeGreaterThan(0);
    expect(document.querySelector('#why-heading')?.textContent).toBe('Why this briefing matters to you');
    expect(document.querySelector('.context-bar')).not.toBeNull();
    expect(document.querySelector('.edit-sheet')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-edit]')?.click();
    expect(document.querySelector<HTMLElement>('[data-edit-sheet]')?.hasAttribute('hidden')).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
    expect(document.querySelector<HTMLElement>('[data-edit-sheet]')?.hasAttribute('hidden')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-share]')?.click();
    await Promise.resolve();
    expect(document.querySelector('[data-share-note]')?.textContent).toContain('Report link copied');

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 900 });
    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.context-bar')?.classList.contains('is-visible')).toBe(true);
  });

  it('uses publisher-supplied loading and report branding with mobile fallbacks', async () => {
    const registry = createDemoRegistry();
    const definition = registry.get('demo');
    if (!definition?.manifest) throw new Error('demo manifest missing');
    definition.manifest = {
      ...definition.manifest,
      branding: {
        ...definition.manifest.branding,
        loading: { ...definition.manifest.branding.loading, desktopBackgroundImage: 'https://assets.example/loading-desktop.jpg', mobileBackgroundImage: 'https://assets.example/loading-mobile.jpg', overlay: '#10251a', overlayOpacity: .6 },
        report: { ...definition.manifest.branding.report, desktopBackgroundImage: 'https://assets.example/report-desktop.jpg', mobileBackgroundImage: 'https://assets.example/report-mobile.jpg', overlay: '#10251a', overlayOpacity: .7 },
      },
    };
    window.history.replaceState({}, '', '/p/demo/generate/report-branding');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ companyName: 'LD Systems', companyDomain: 'ldsystems.uk', jobTitle: 'Software Engineer' })));

    await renderHostedRoute(document, registry);

    const styles = document.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('https://assets.example/loading-desktop.jpg');
    expect(styles).toContain('https://assets.example/loading-mobile.jpg');
    expect(styles).toContain('color-mix(in srgb, #10251a 60%, transparent)');
    expect(styles).toContain('https://assets.example/report-desktop.jpg');
  });
});
