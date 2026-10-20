// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.sgieurope.com/news/story.article"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findWidgetScript, widgetApiBase } from '../src/widget/api-base';

const PLATFORM = 'https://discovery.ldsystems.uk';

type FetchCall = { url: string; init?: RequestInit };

function installWidgetScript(attributes: Record<string, string> = {}, src = `${PLATFORM}/widget.js`): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = src;
  script.setAttribute('data-publisher', 'sgi-europe');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  document.head.appendChild(script);
  return script;
}

async function loadEmbed() {
  vi.resetModules();
  const embed = await import('../src/embed');
  const widget = document.querySelector('content-discovery-widget') as HTMLElement & { openWidget(): void; shadowRoot: ShadowRoot };
  if (!widget) throw new Error('widget was not mounted');
  const navigate = vi.spyOn(customElements.get('content-discovery-widget')!.prototype as unknown as { navigateTo(url: string): void }, 'navigateTo').mockImplementation(() => undefined);
  return { embed, widget, navigate };
}

async function submit(widget: HTMLElement & { openWidget(): void; shadowRoot: ShadowRoot }) {
  widget.openWidget();
  const company = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]');
  const role = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]');
  const form = widget.shadowRoot.querySelector<HTMLFormElement>('form.briefing-bar');
  if (!company || !role || !form) throw new Error('form not rendered');
  company.value = 'nike';
  role.value = 'Head of Retail';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function stubFetch(response: () => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return response(); }));
  return calls;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('widget API base on a publisher page', () => {
  it('posts generation to the platform that served widget.js and redirects there', async () => {
    installWidgetScript();
    const calls = stubFetch(() => Response.json({ generationUrl: '/p/sgi-europe/generate/report-1', reportUrl: '/p/sgi-europe/report-1' }, { status: 201 }));
    const { widget, navigate } = await loadEmbed();
    await submit(widget);
    const generation = calls.find((call) => call.url.endsWith('/api/reports/generate'));
    expect(generation?.url).toBe(`${PLATFORM}/api/reports/generate`);
    expect(JSON.parse(String(generation?.init?.body))).toMatchObject({ publisherId: 'sgi-europe', companyUrl: 'nike', jobTitle: 'Head of Retail' });
    expect(calls.some((call) => call.url.startsWith('https://www.sgieurope.com'))).toBe(false);
    expect(navigate).toHaveBeenCalledWith(`${PLATFORM}/p/sgi-europe/generate/report-1`);
  });

  it('sends analytics to the platform with fetch, without credentials or a beacon', async () => {
    installWidgetScript();
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    const { embed, widget } = await loadEmbed();
    widget.openWidget();
    await embed.analyticsClient.flush(true);
    const analytics = calls.find((call) => call.url.endsWith('/api/analytics/events'));
    expect(analytics?.url).toBe(`${PLATFORM}/api/analytics/events`);
    expect(analytics?.init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true });
    expect(JSON.parse(String(analytics?.init?.body)).events.every((event: { publisherId: string }) => event.publisherId === 'sgi-europe')).toBe(true);
    expect(beacon).not.toHaveBeenCalled();
    embed.analyticsClient.stop();
  });

  it('lets data-generation-endpoint override the endpoint and redirect origin', async () => {
    installWidgetScript({ 'data-generation-endpoint': 'https://staging.ldsystems.uk/api/reports/generate' });
    const calls = stubFetch(() => Response.json({ generationUrl: '/p/sgi-europe/generate/report-2' }, { status: 201 }));
    const { widget, navigate } = await loadEmbed();
    await submit(widget);
    expect(calls.find((call) => call.url.includes('/api/reports/generate'))?.url).toBe('https://staging.ldsystems.uk/api/reports/generate');
    expect(navigate).toHaveBeenCalledWith('https://staging.ldsystems.uk/p/sgi-europe/generate/report-2');
  });

  it('keeps the friendly error and warns with the status and safe error code', async () => {
    installWidgetScript();
    stubFetch(() => Response.json({ error: 'origin_not_allowed', requestId: 'req-123' }, { status: 403 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { widget, navigate } = await loadEmbed();
    await submit(widget);
    expect(navigate).not.toHaveBeenCalled();
    expect(widget.shadowRoot.querySelector('[role="alert"]')?.textContent).toContain('We could not start your briefing');
    expect(warn).toHaveBeenCalledWith('[content-discovery] generation request failed', expect.objectContaining({ endpoint: `${PLATFORM}/api/reports/generate`, status: 403, error: 'origin_not_allowed', requestId: 'req-123' }));
  });
});

describe('widget script discovery', () => {
  it('prefers document.currentScript captured at execution time', () => {
    const current = installWidgetScript({}, 'https://cdn.ldsystems.uk/assets/discovery.js');
    installWidgetScript({}, `${PLATFORM}/widget.js`);
    expect(widgetApiBase(findWidgetScript(document, current), document)).toBe('https://cdn.ldsystems.uk');
  });

  it('falls back to the script whose src path ends in /widget.js, ignoring query strings', () => {
    installWidgetScript({}, 'https://www.sgieurope.com/assets/site.js');
    installWidgetScript({}, `${PLATFORM}/widget.js?v=0.5.0`);
    expect(widgetApiBase(findWidgetScript(document, null), document)).toBe(PLATFORM);
  });

  it('falls back to relative same-origin URLs when no widget script is found', () => {
    expect(widgetApiBase(findWidgetScript(document, null), document)).toBeUndefined();
  });
});
