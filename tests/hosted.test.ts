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
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'running', stage: 'company_resolved', completedStages: ['company_resolved'], details: { companyName: 'LD Systems', jobTitle: 'Software Engineer' } })));

    await renderHostedRoute(document, registry);
    await vi.waitFor(() => expect(document.querySelector('[data-step="0"] [data-step-label]')?.textContent).toBe('Understanding LD Systems'));

    expect(document.querySelector('.hosted-shell')).not.toBeNull();
    expect(document.querySelector('.hosted-card')?.textContent).toContain('Northstar Journal');
    expect(document.querySelector('.generation-frame.loading-frame')).not.toBeNull();
    expect(document.querySelector('.generation-logo [data-publisher-brand]')).not.toBeNull();
    expect(document.querySelector('[data-loading-identity]')?.textContent).toBe('For a Software Engineer at LD Systems');
    expect(document.querySelector('[data-step="1"] [data-step-label]')?.textContent).toBe('Mapping what a Software Engineer focuses on');
    expect(document.querySelector('[data-step="1"]')?.getAttribute('data-state')).toBe('active');
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/generations/report-12345678/status?publisherId=demo');
    const styles = document.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('--loading-fallback:#151A3A');
    expect(styles).toContain('--report-fallback:#2A2C8F');
    expect(styles).toContain('--palette-cyan:#12A8B4');
    expect(styles).toContain('@media(max-width:780px)');
    expect(styles).toContain('.generation-frame{');
    expect(styles).toContain('prefers-reduced-motion');
  });

  it('loads the persisted report page without invoking generation or rendering the embed widget', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
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
    expect(document.querySelector('.report-hero')).not.toBeNull();
    expect(document.querySelector('.match-summary-card')).not.toBeNull();
    expect(document.querySelector('.relevance-ring')).not.toBeNull();
    expect(document.querySelector('.highlights-section')).not.toBeNull();
    expect(document.querySelector('.also-relevant')).not.toBeNull();
    expect(document.querySelector('.featured-story')).not.toBeNull();
    expect(document.querySelectorAll('.story-card').length).toBeGreaterThan(0);
    expect(document.querySelector('#highlights-heading')?.textContent).toBe('Top themes in your briefing');
    expect(document.querySelector('.why strong')?.textContent).toBe('Why this matters to you');
    expect(document.querySelector('.report-cover')).toBeNull();
    expect(document.querySelector('.cover-content')).toBeNull();
    expect(document.querySelector('.report-intro')).toBeNull();
    expect(document.querySelector('#why-heading')).toBeNull();
    expect(document.querySelector('.context-bar')).not.toBeNull();
    expect(document.querySelector('.edit-sheet')).not.toBeNull();
    const styles = document.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('.report-hero{min-height:clamp(560px,68vh,740px);padding:clamp(24px,3.5vw,48px)}');
    expect(styles).toContain('.report-hero-content{min-height:clamp(460px,55vh,560px)');
    expect(styles).toContain('.report-hero h1{font-size:clamp(4.75rem,7vw,6.25rem)}');
    expect(styles).toContain('.report-title{margin-top:18px;font-size:clamp(2.25rem,3vw,2.875rem)}');
    expect(styles).toContain('.match-summary-card{margin-top:-48px;padding:clamp(22px,3vw,36px)}');
    expect(styles).toContain('.context-bar{top:18px;background:#fff');
    expect(styles).toContain('.context-bar .hosted-brand.compact{color:#151a3a}');

    document.querySelector<HTMLButtonElement>('[data-edit]')?.click();
    expect(document.querySelector<HTMLElement>('[data-edit-sheet]')?.hasAttribute('hidden')).toBe(false);
    const editCompany = document.querySelector<HTMLInputElement>('#edit-company-url');
    expect(editCompany?.type).toBe('text');
    expect(editCompany?.placeholder).toBe('Nike or nike.com');
    expect(editCompany?.getAttribute('autocomplete')).toBe('organization');
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

  it('wires every theme action and replaces focused results with safe analytics events', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    const { reportId } = await generated.json() as { reportId: string };
    const report = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json();
    report.themeDescriptions = { [report.professionalProfile.professionalInterests[0]]: 'Two platform teams <b>cut</b> release times by half.' };
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ input: url, init });
      if (url.includes('/api/analytics/events')) return Response.json({ accepted: true });
      if (url.includes('/themes/')) {
        const theme = decodeURIComponent(url.split('/themes/')[1].split('/search')[0]);
        return Response.json({ theme, recommendations: theme === report.professionalProfile.professionalInterests[0] ? report.recommendations.slice(1, 2).map((item: { article: Record<string, unknown> }) => ({ ...item, article: { ...item.article, categories: [] } })) : [] });
      }
      return Response.json(report);
    }));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createDemoRegistry());

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-search]')];
    expect(buttons.length).toBe(4);
    const cardLines = [...document.querySelectorAll('.highlight-card p')].map((line) => line.textContent);
    expect(cardLines[0]).toBe('Two platform teams <b>cut</b> release times by half.');
    expect(document.querySelector('.highlight-card p b')).toBeNull();
    expect(cardLines[1]).toMatch(/^Relevant to your .+ focus and the information needs identified for this briefing\.$/);
    expect(document.querySelector('[data-theme-results]')?.hasAttribute('hidden')).toBe(true);
    await buttons[0].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-theme-results]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.theme-results-heading')?.textContent).toContain(report.professionalProfile.professionalInterests[0]);
    expect(document.querySelector('.theme-results .story-card')).not.toBeNull();
    // A theme result without an AI explanation has no "Why this matters to you" box; main-report cards keep theirs.
    expect(document.querySelector('.theme-results .why')).toBeNull();
    // An article without a category shows no label rather than a placeholder.
    expect(document.querySelector('.theme-results .story-meta')?.textContent).not.toContain('Coverage');
    expect(document.querySelector('.theme-results .story-summary')).not.toBeNull();
    expect(document.querySelectorAll('.why').length).toBeGreaterThan(0);

    await buttons[1].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.theme-results')?.textContent).toContain('No strong stories were found');
    const themeRequests = requests.filter((request) => request.input.includes('/themes/'));
    expect(themeRequests.length).toBe(2);
    // The second theme excludes what the first theme showed.
    expect(themeRequests.map((request) => JSON.parse(String(request.init?.body)).shownArticleIds)).toEqual([[], [report.recommendations[1].articleId]]);
    const analyticsEvents = requests.filter((request) => request.input.includes('/api/analytics/events')).flatMap((request) => {
      try { return (JSON.parse(String(request.init?.body)) as { events?: Array<{ name: string; metadata?: Record<string, unknown> }> }).events ?? []; } catch { return []; }
    });
    expect(analyticsEvents.map((event) => event.name)).toContain('theme_find_stories_clicked');
    expect(analyticsEvents.some((event) => event.name === 'theme_find_stories_clicked' && event.metadata?.reportId === reportId)).toBe(true);
  });

  it.each([2, 4, 8])('renders a report with %s recommendations without duplicate story cards', async (count) => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    const { reportId } = await generated.json() as { reportId: string };
    const source = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as any;
    const seed = source.recommendations[0];
    const report = {
      ...source,
      sections: undefined,
      recommendations: Array.from({ length: count }, (_, index) => index === 0 ? seed : {
        ...seed,
        articleId: `${seed.articleId}-presentation-${index}`,
        rank: index + 1,
        article: { ...seed.article, id: `${seed.article.id}-presentation-${index}`, url: `${seed.article.url}?presentation=${index}`, title: `${seed.article.title} ${index + 1}` },
      }),
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createDemoRegistry());
    const cards = [...document.querySelectorAll<HTMLElement>('[data-story-card]')];
    const ids = cards.map((card) => card.dataset.storyCard);
    expect(cards).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
  });

  it('renders a compact one-headline hero, a mobile layout, compact image fallbacks and a More toggle for "why"', async () => {
    const app = createProductionApp({ environment: 'test' });
    const generated = await app.handle(new Request('https://product.example/api/reports/generate?mode=sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherId: 'demo', companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer' }),
    }));
    const { reportId } = await generated.json() as { reportId: string };
    const source = await (await app.handle(new Request(`https://product.example/api/reports/${reportId}?publisherId=demo`))).json() as any;
    const seed = source.recommendations[0];
    const report = { ...source, sections: undefined, recommendations: [0, 1, 2].map((index) => ({ ...seed, articleId: `story-${index}`, rank: index + 1, article: { ...seed.article, id: `story-${index}`, url: `${seed.article.url}?story=${index}`, imageUrl: index === 1 ? undefined : 'https://images.example/story.jpg' } })) };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(report)));
    window.history.replaceState({}, '', `/p/demo/${reportId}`);
    await renderHostedRoute(document, createDemoRegistry());

    // One headline in the hero; the publisher's results heading names the top stories instead.
    expect(document.querySelectorAll('.report-hero h1, .report-hero h2')).toHaveLength(1);
    expect(document.querySelector('.report-title')).toBeNull();
    expect(document.querySelector('#top-stories-heading')?.textContent).toBeTruthy();
    // Ring, heading, summary and actions are direct children so the ring can sit beside the heading on mobile.
    expect([...document.querySelector('.match-summary-card')!.children].map((child) => child.className)).toEqual(['relevance-ring', 'section-kicker', 'match-summary-text', 'summary-actions']);
    // Images and the compact fallback.
    const cards = [...document.querySelectorAll<HTMLElement>('[data-story-card]')];
    expect(cards.map((card) => card.classList.contains('no-image'))).toEqual([false, true, false]);
    expect(cards[1].querySelector('.story-placeholder')?.textContent).toContain('coverage');
    // "Why" has a More toggle, hidden where nothing is cut off (jsdom has no layout), that expands the text.
    const toggle = cards[0].querySelector<HTMLButtonElement>('.why-toggle')!;
    expect(toggle.hidden).toBe(true);
    toggle.hidden = false;
    toggle.click();
    expect(cards[0].querySelector('.why')?.classList.contains('is-expanded')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Less');

    const styles = [...document.querySelectorAll('style')].map((style) => style.textContent).join('');
    for (const rule of ['html{scroll-padding-top:104px}', 'scroll-margin-top:104px', '@media(max-width:639px)', 'scroll-snap-type:x mandatory', '.report-page .highlight-index{display:none}', 'max-height:180px;aspect-ratio:16/9', '-webkit-line-clamp:3', '.report-page .featured-story.no-image .story-placeholder{display:none}', 'font-size:clamp(2.5rem,3.9vw,3.5rem)', 'font-size:clamp(1.75rem,8vw,2rem)']) {
      expect(styles).toContain(rule);
    }
  });
});
