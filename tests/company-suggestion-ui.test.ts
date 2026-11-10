// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.sgieurope.com/news/story.article"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCompanySuggestion, companySuggestionUrl, wantsCompanySuggestion } from '../src/widget/company-suggestion';

const PLATFORM = 'https://discovery.ldsystems.uk';
type Widget = HTMLElement & { openWidget(): void; shadowRoot: ShadowRoot };

async function loadWidget() {
  const script = document.createElement('script');
  script.src = `${PLATFORM}/widget.js`;
  script.setAttribute('data-publisher', 'sgi-europe');
  document.head.appendChild(script);
  vi.resetModules();
  await import('../src/embed');
  const widget = document.querySelector('content-discovery-widget') as Widget;
  vi.spyOn(customElements.get('content-discovery-widget')!.prototype as unknown as { navigateTo(url: string): void }, 'navigateTo').mockImplementation(() => undefined);
  widget.openWidget();
  return widget;
}

function stubFetch(calls: Array<{ url: string; body?: string }>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.includes('/company-suggestion')) return Response.json(new URL(url).searchParams.get('company') === 'Mike' ? { suggestion: 'Nike' } : {});
    return Response.json({ generationUrl: '/p/sgi-europe/generate/gen-1' });
  }));
}

const type = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true, composed: true })); };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('"Did you mean Nike?" on the widget form', () => {
  it('suggests Nike for "Mike" from the platform, and fills the field when chosen', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    stubFetch(calls);
    const widget = await loadWidget();
    const company = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!;
    type(company, 'Mike');
    await vi.waitFor(() => expect(widget.shadowRoot.querySelector('[data-company-suggestion]')?.textContent).toBe('Did you mean Nike?'), { timeout: 2000 });
    expect(calls[0].url).toBe(`${PLATFORM}/api/publishers/sgi-europe/company-suggestion?company=Mike`);
    widget.shadowRoot.querySelector<HTMLButtonElement>('[data-use-company-suggestion]')!.click();
    expect(widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!.value).toBe('Nike');
    expect(widget.shadowRoot.querySelector('[data-company-suggestion]')?.textContent).toBe('');
    widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')!.value = 'Head of Retail';
    widget.shadowRoot.querySelector<HTMLFormElement>('form.briefing-bar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/api/reports/generate'))).toBe(true));
    expect(JSON.parse(calls.find((call) => call.url.endsWith('/api/reports/generate'))!.body!).companyUrl).toBe('Nike');
  });

  it('never blocks: submitting "Mike" without choosing the suggestion generates for "Mike"', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    stubFetch(calls);
    const widget = await loadWidget();
    const company = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!;
    type(company, 'Mike');
    await vi.waitFor(() => expect(widget.shadowRoot.querySelector('[data-company-suggestion]')?.textContent).toBe('Did you mean Nike?'), { timeout: 2000 });
    widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')!.value = 'Head of Retail';
    widget.shadowRoot.querySelector<HTMLFormElement>('form.briefing-bar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/api/reports/generate'))).toBe(true));
    expect(JSON.parse(calls.find((call) => call.url.endsWith('/api/reports/generate'))!.body!).companyUrl).toBe('Mike');
  });

  it('does not look up websites or very short input', async () => {
    expect(wantsCompanySuggestion('nike.com')).toBe(false);
    expect(wantsCompanySuggestion('https://nike')).toBe(false);
    expect(wantsCompanySuggestion('Ni')).toBe(false);
    expect(wantsCompanySuggestion('Mike')).toBe(true);
    const calls: Array<{ url: string; body?: string }> = [];
    stubFetch(calls);
    const widget = await loadWidget();
    type(widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!, 'mike.com');
    await wait(450);
    expect(calls).toHaveLength(0);
  });
});

describe('"Did you mean" on plain forms (hosted edit sheet, loading page)', () => {
  it('shows the hint under the field and fills it on click', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    stubFetch(calls);
    document.body.innerHTML = '<form><input name="companyUrl"><p data-company-suggestion hidden></p></form>';
    const input = document.querySelector<HTMLInputElement>('input')!;
    const hint = document.querySelector<HTMLElement>('[data-company-suggestion]')!;
    bindCompanySuggestion(input, hint, (value) => companySuggestionUrl(PLATFORM, 'sgi-europe', value), (value) => value, 10);
    type(input, 'Mike');
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    expect(hint.textContent).toBe('Did you mean Nike?');
    hint.querySelector<HTMLButtonElement>('button')!.click();
    expect(input.value).toBe('Nike');
    expect(hint.hidden).toBe(true);
    type(input, 'Nike');
    await wait(30);
    expect(hint.hidden).toBe(true);
  });
});
