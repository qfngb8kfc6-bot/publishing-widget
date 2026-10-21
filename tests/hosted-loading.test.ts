// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitThemeChips, generationPageMarkup, generationProgress, runGenerationPage, STAGE_WEIGHTS, type GenerationStatusPayload } from '../src/hosted-loading';
import { sgiEuropeManifest } from '../src/publishers/sgi-europe';
import { createEvent, type AnalyticsEvent } from '../src/core';
import { validateAnalyticsEvent } from '../src/server/analytics-validation';

const STAGES = ['company_resolved', 'profile_built', 'content_retrieved', 'ranking_complete', 'ai_complete', 'report_persisted'];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) { if (check()) return; await wait(5); }
  throw new Error('condition not reached');
}

function mount() {
  document.body.innerHTML = `<main>${generationPageMarkup(sgiEuropeManifest, '<div data-publisher-brand>SGI Europe</div>', '')}</main>`;
  return document.querySelector<HTMLElement>('main')!;
}

/** Serves status payloads in order (the last one repeats) and records every request. */
function statusFetch(payloads: Array<GenerationStatusPayload | Response>, posts: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let index = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.method === 'POST') return (Object.entries(posts).find(([path]) => url.startsWith(path))?.[1] ?? (() => Response.json({ error: 'generation_unavailable' }, { status: 503 })))();
    const payload = payloads[Math.min(index, payloads.length - 1)];
    index += 1;
    return payload instanceof Response ? payload : Response.json(payload);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function analytics() {
  const events: AnalyticsEvent[] = [];
  return { events, client: { track: (event: AnalyticsEvent) => { events.push(event); } } };
}

const stateOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-step]')].map((step) => step.dataset.state);
const labelOf = (root: HTMLElement, index: number) => root.querySelector(`[data-step="${index}"] [data-step-label]`)?.textContent;

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('progress weighting', () => {
  it('weights stages by typical duration and creeps toward, but never reaches, the next milestone', () => {
    expect(STAGE_WEIGHTS.reduce((sum, weight) => sum + weight, 0)).toBe(100);
    expect(generationProgress(0, 0)).toBe(0);
    let previous = -1;
    for (const elapsed of [0, 200, 900, 5_000, 60_000, 10_000_000]) {
      const value = generationProgress(0, elapsed);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThan(STAGE_WEIGHTS[0]);
      previous = value;
    }
    // Still moving long after the typical duration, so it never looks frozen.
    expect(generationProgress(4, 20_000) - generationProgress(4, 10_000)).toBeGreaterThan(0.5);
    expect(generationProgress(4, 1_000_000)).toBeLessThan(95);
    expect(generationProgress(2, 0)).toBe(STAGE_WEIGHTS[0] + STAGE_WEIGHTS[1]);
    expect(generationProgress(6, 0)).toBe(99);
    expect(generationProgress(3, 0, true)).toBe(100);
  });
});

describe('hosted loading page', () => {
  it('shows real stages with personalised labels, theme chips, live announcements and rising progress, then replaces itself with the report', async () => {
    const root = mount();
    const { fetchImpl, calls } = statusFetch([
      { status: 'running', stage: 'started', completedStages: [], details: { jobTitle: 'head of retail' }, sessionId: 'session-1' },
      { status: 'running', stage: 'company_resolved', completedStages: STAGES.slice(0, 1), details: { companyName: 'Nike', jobTitle: 'head of retail', articlesSearched: 11_482 } },
      { status: 'running', stage: 'profile_built', completedStages: STAGES.slice(0, 2), details: { companyName: 'Nike', jobTitle: 'head of retail', articlesSearched: 11_482, themes: ['retail', 'wholesale', 'store openings'] } },
      { status: 'running', stage: 'ranking_complete', completedStages: STAGES.slice(0, 4), details: { companyName: 'Nike', jobTitle: 'head of retail', articlesSearched: 11_482, themes: ['retail', 'wholesale', 'store openings'] } },
      { status: 'complete', stage: 'report_persisted', completedStages: STAGES, details: { companyName: 'Nike', jobTitle: 'head of retail' }, reportUrl: '/p/sgi-europe/report-1' },
    ]);
    const navigate = vi.fn();
    const tracker = analytics();
    const progress: number[] = [];
    const stop = runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-1', { fetchImpl, navigate, analytics: tracker.client, pollMs: 15, tickMs: 5, readyMs: 30, reducedMotion: false });
    expect(stateOf(root)).toEqual(['active', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(labelOf(root, 0)).toBe('Understanding your company');

    await until(() => labelOf(root, 1) === 'Mapping what a Head of Retail focuses on' && stateOf(root)[1] === 'active');
    progress.push(Number(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')));
    expect(labelOf(root, 0)).toBe('Understanding Nike');
    expect(labelOf(root, 2)).toBe('Searching 11,482 SGI Europe articles');
    expect(root.querySelector('[data-step="0"] [data-step-state]')?.textContent).toBe('Done');
    expect(root.querySelector('[data-loading-live]')?.textContent).toBe('Step 2 of 6: Mapping what a Head of Retail focuses on');
    expect(root.querySelector('[data-loading-identity]')?.textContent).toBe('For a Head of Retail at Nike');

    await until(() => root.querySelectorAll('.loading-chip').length === 3);
    expect([...root.querySelectorAll('.loading-chip')].map((chip) => chip.textContent)).toEqual(['retail', 'wholesale', 'store openings']);
    await until(() => stateOf(root)[4] === 'active');
    expect(stateOf(root)).toEqual(['complete', 'complete', 'complete', 'complete', 'active', 'pending']);
    expect(root.querySelector('[aria-current="step"]')?.getAttribute('data-step')).toBe('4');
    progress.push(Number(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')));
    expect(progress[1]).toBeGreaterThan(progress[0]);
    expect(progress[1]).toBeLessThan(100);

    await until(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledWith('/p/sgi-europe/report-1');
    expect(root.querySelector('[data-loading-heading]')?.textContent).toBe('Your briefing is ready');
    expect(root.querySelector('[data-loading-message]')?.textContent).toBe('Opening your briefing…');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
    expect(stateOf(root).every((state) => state === 'complete')).toBe(true);
    // Polling stopped once complete; no company or role in any request URL.
    const polls = calls.length;
    await wait(40);
    expect(calls.length).toBe(polls);
    expect(calls.every((call) => call.url === '/api/generations/gen-1/status?publisherId=sgi-europe')).toBe(true);
    expect(calls[0].init).toMatchObject({ cache: 'no-store' });

    const names = tracker.events.map((event) => event.name);
    expect(names[0]).toBe('generation_started');
    expect(names.filter((name) => name === 'generation_stage_completed')).toHaveLength(6);
    expect(names).toContain('generation_completed');
    expect(tracker.events.every((event) => event.sessionId === 'session-1' && event.metadata?.surface === 'loading_page')).toBe(true);
    expect(tracker.events.find((event) => event.name === 'generation_stage_completed')?.metadata).toMatchObject({ generationStage: 'company_resolved', elapsedMs: expect.any(Number), stageMs: expect.any(Number) });
    expect(JSON.stringify(tracker.events)).not.toMatch(/Nike|retail/i);
    stop();
  });

  it('rotates truthful sub-messages during a long stage', async () => {
    const root = mount();
    const { fetchImpl } = statusFetch([{ status: 'running', completedStages: STAGES.slice(0, 4), details: {} }]);
    const stop = runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-2', { fetchImpl, navigate: vi.fn(), pollMs: 10, messageMs: 30, reducedMotion: true });
    const seen = new Set<string>();
    await until(() => { seen.add(root.querySelector('[data-loading-message]')?.textContent ?? ''); return seen.size >= 3; });
    expect([...seen]).toEqual(expect.arrayContaining(['Spotting patterns across stories', 'Comparing competitor moves']));
    stop();
  });

  it('shows a friendly failure with Retry and Edit, and retries without company or role in the URL', async () => {
    const root = mount();
    const { fetchImpl, calls } = statusFetch(
      [{ status: 'failed', completedStages: STAGES.slice(0, 2), details: { companyName: 'Nike', jobTitle: 'Head of Retail' }, error: 'generation_interrupted', retryable: true }],
      { '/api/generations/gen-3/retry': () => Response.json({ generationId: 'gen-4', generationUrl: '/p/sgi-europe/generate/gen-4' }, { status: 202 }) },
    );
    const navigate = vi.fn();
    const tracker = analytics();
    runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-3', { fetchImpl, navigate, analytics: tracker.client, pollMs: 10 });
    await until(() => !root.querySelector('[data-loading-failure]')?.hasAttribute('hidden'));
    expect(root.querySelector('[data-loading-failure]')?.getAttribute('role')).toBe('alert');
    expect(root.querySelector('[data-failure-message]')?.textContent).toContain('interrupted');
    expect(root.querySelector('[data-loading-identity]')?.textContent).toBe('For a Head of Retail at Nike');
    expect(root.querySelector('[data-loading-panel]')?.hasAttribute('hidden')).toBe(true);
    const retry = root.querySelector<HTMLButtonElement>('[data-retry]')!;
    expect(document.activeElement).toBe(retry);
    expect(tracker.events.find((event) => event.name === 'generation_failed')?.metadata).toMatchObject({ errorCode: 'generation_interrupted', generationStage: 'content_retrieved' });

    retry.click();
    await until(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledWith('/p/sgi-europe/generate/gen-4');
    const post = calls.find((call) => call.init?.method === 'POST')!;
    expect(post.url).toBe('/api/generations/gen-3/retry?publisherId=sgi-europe');
    expect(post.init?.body).toBeUndefined();
  });

  it('lets the reader edit their details after a failure and keeps company errors on the page', async () => {
    const root = mount();
    const { fetchImpl, calls } = statusFetch(
      [{ status: 'failed', completedStages: [], details: { companyName: 'Adids', jobTitle: 'Product Manager' }, error: 'generation_unavailable', retryable: true, sessionId: 'session-9' }],
      { '/api/reports/generate': () => Response.json({ error: 'company_resolution_failed' }, { status: 400 }) },
    );
    runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-5', { fetchImpl, navigate: vi.fn(), pollMs: 10 });
    await until(() => !root.querySelector('[data-loading-failure]')?.hasAttribute('hidden'));
    root.querySelector<HTMLButtonElement>('[data-edit]')!.click();
    const form = root.querySelector<HTMLFormElement>('[data-edit-form]')!;
    expect(form.hidden).toBe(false);
    expect(form.querySelector<HTMLInputElement>('[name="companyUrl"]')?.value).toBe('Adids');
    expect(form.querySelector<HTMLInputElement>('[name="jobTitle"]')?.value).toBe('Product Manager');
    expect(document.activeElement).toBe(form.querySelector('[name="companyUrl"]'));
    form.querySelector<HTMLInputElement>('[name="companyUrl"]')!.value = 'adids';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => (root.querySelector('[data-edit-status]')?.textContent ?? '').includes("couldn't find"));
    expect(root.querySelector('[data-edit-status]')?.textContent).toBe("We couldn't find 'adids'. Check the spelling or enter the company's website.");
    expect(JSON.parse(String(calls.find((call) => call.init?.method === 'POST')?.init?.body))).toEqual({ publisherId: 'sgi-europe', companyUrl: 'adids', jobTitle: 'Product Manager', sessionId: 'session-9' });
  });

  it('gives up after the timeout with a retry option instead of polling forever', async () => {
    const root = mount();
    const { fetchImpl, calls } = statusFetch([{ status: 'running', completedStages: ['company_resolved'], details: {} }]);
    runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-6', { fetchImpl, navigate: vi.fn(), pollMs: 5, timeoutMs: 60 });
    await until(() => !root.querySelector('[data-loading-failure]')?.hasAttribute('hidden'));
    expect(root.querySelector('[data-failure-message]')?.textContent).toBe('This is taking longer than usual. You can try again now.');
    expect(root.querySelector<HTMLButtonElement>('[data-retry]')?.hidden).toBe(false);
    const polls = calls.length;
    await wait(30);
    expect(calls.length).toBe(polls);
  });

  it('reports an unknown generation without a retry, and survives dropped polls', async () => {
    const root = mount();
    let attempt = 0;
    const fetchImpl = vi.fn(async () => { attempt += 1; if (attempt === 1) throw new TypeError('network'); return new Response('{"error":"generation_not_found"}', { status: 404 }); }) as unknown as typeof fetch;
    runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-7', { fetchImpl, navigate: vi.fn(), pollMs: 5 });
    await until(() => !root.querySelector('[data-loading-failure]')?.hasAttribute('hidden'));
    expect(attempt).toBe(2);
    expect(root.querySelector<HTMLButtonElement>('[data-retry]')?.hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-failure-heading]'));
  });

  it('respects reduced motion: no fades, pulse or exit animation, and a quicker hand-off', async () => {
    const root = mount();
    // jsdom has no matchMedia: the page reads the reader's setting from it when no option overrides it.
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query }) as MediaQueryList });
    const { fetchImpl } = statusFetch([{ status: 'running', completedStages: STAGES.slice(0, 4), details: {} }, { status: 'complete', completedStages: STAGES, reportUrl: '/p/sgi-europe/report-2' }]);
    const navigate = vi.fn();
    runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-8', { fetchImpl, navigate, pollMs: 10 });
    const frame = root.querySelector<HTMLElement>('.loading-frame')!;
    expect(frame.classList.contains('reduced-motion')).toBe(true);
    expect(frame.dataset.reducedMotion).toBe('true');
    await until(() => navigate.mock.calls.length > 0, 200);
    expect(navigate).toHaveBeenCalledWith('/p/sgi-europe/report-2');
    expect(frame.classList.contains('is-leaving')).toBe(false);
    expect(root.querySelector('[data-loading-message]')?.classList.contains('is-fading')).toBe(false);
    const styles = root.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('@media(prefers-reduced-motion:reduce)');
    expect(styles).toContain('.loading-frame.reduced-motion .loading-chip{opacity:1;transform:none;animation:none}');
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('records loading_abandoned when the reader leaves before the report is ready', async () => {
    const root = mount();
    const { fetchImpl } = statusFetch([{ status: 'running', completedStages: STAGES.slice(0, 2), details: {}, sessionId: 'session-2' }]);
    const tracker = analytics();
    const stop = runGenerationPage(root, sgiEuropeManifest, 'sgi-europe', 'gen-9', { fetchImpl, navigate: vi.fn(), analytics: tracker.client, pollMs: 10 });
    await until(() => tracker.events.some((event) => event.name === 'generation_started'));
    window.dispatchEvent(new Event('pagehide'));
    expect(tracker.events.find((event) => event.name === 'loading_abandoned')?.metadata).toMatchObject({ generationStage: 'content_retrieved', elapsedMs: expect.any(Number) });
    stop();
  });

  it('keeps buttons keyboard-focusable and the page labelled', () => {
    const root = mount();
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Briefing progress');
    expect(root.querySelector('[data-loading-live]')?.getAttribute('aria-live')).toBe('polite');
    for (const button of root.querySelectorAll('button')) expect(button.getAttribute('tabindex')).not.toBe('-1');
    expect(root.querySelectorAll('[data-step]')).toHaveLength(6);
  });

  it('sends loading analytics the ingestion endpoint accepts', () => {
    for (const [name, metadata] of [['generation_started', { surface: 'loading_page' }], ['generation_stage_completed', { surface: 'loading_page', generationStage: 'profile_built', elapsedMs: 2100, stageMs: 1800 }], ['generation_completed', { surface: 'loading_page', elapsedMs: 8200 }], ['generation_failed', { surface: 'loading_page', errorCode: 'client_timeout', generationStage: 'ai_complete', elapsedMs: 45_100 }], ['loading_abandoned', { surface: 'loading_page', generationStage: 'ranking_complete', elapsedMs: 4000 }]] as const) {
      expect(validateAnalyticsEvent(createEvent(name, 'sgi-europe', 'session-1', metadata)).name).toBe(name);
    }
  });

  it('keeps theme chips to two lines and stands in "+N" for the rest', () => {
    const container = document.createElement('span');
    container.innerHTML = ['a', 'b', 'c', 'd', 'e', 'f'].map((theme) => `<span class="loading-chip">${theme}</span>`).join('');
    document.body.appendChild(container);
    // Fake layout: three chips per line, 30px apart; the "+N" chip lands after the last visible chip.
    const lineOf = (element: HTMLElement) => {
      const visible = [...container.querySelectorAll<HTMLElement>('.loading-chip:not(.loading-chip-more)')].filter((chip) => !chip.hidden);
      const index = element.classList.contains('loading-chip-more') ? visible.length : [...container.children].indexOf(element);
      return Math.floor(index / 3) * 30;
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return lineOf(this as HTMLElement); } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 24; } });
    try {
      container.insertAdjacentHTML('beforeend', '<span class="loading-chip">g</span><span class="loading-chip">h</span>');
      fitThemeChips(container);
      const shown = [...container.querySelectorAll<HTMLElement>('.loading-chip')].filter((chip) => !chip.hidden).map((chip) => chip.textContent);
      expect(shown).toEqual(['a', 'b', 'c', 'd', 'e', '+3 more themes']);
      // Fitting again (e.g. after a resize) starts from all chips, not the reduced set.
      fitThemeChips(container);
      expect(container.querySelectorAll('.loading-chip-more')).toHaveLength(1);
    } finally {
      delete (HTMLElement.prototype as { offsetTop?: number }).offsetTop;
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });
});
