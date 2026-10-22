// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://www.sgieurope.com/news/story.article"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generationInputMessage } from '../src/widget/messages';

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
  const navigate = vi.spyOn(customElements.get('content-discovery-widget')!.prototype as unknown as { navigateTo(url: string): void }, 'navigateTo').mockImplementation(() => undefined);
  widget.openWidget();
  return { widget, navigate };
}

function fill(widget: Widget, company: string, role: string) {
  widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!.value = company;
  widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')!.value = role;
  widget.shadowRoot.querySelector<HTMLFormElement>('form.briefing-bar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('widget hand-off to the hosted loading page', () => {
  it('shows "Starting your briefing…" while the job is created, then navigates to the loader on the platform origin', async () => {
    let respond!: (response: Response) => void;
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => { calls.push(String(input)); return new Promise<Response>((resolve) => { respond = resolve; }); }));
    const { widget, navigate } = await loadWidget();
    fill(widget, 'nike', 'Head of Retail');
    await tick();
    const button = widget.shadowRoot.querySelector<HTMLButtonElement>('[data-action="generate"]')!;
    expect(button.textContent).toBe('Starting your briefing…');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(widget.shadowRoot.querySelector('[data-starting-status]')?.getAttribute('role')).toBe('status');
    expect(widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.readOnly).toBe(true);
    // A second submit while starting does not create a second job.
    fill(widget, 'nike', 'Head of Retail');
    await tick();
    expect(calls).toEqual([`${PLATFORM}/api/reports/generate`]);

    respond(Response.json({ generationId: 'gen-1', status: 'running', statusUrl: '/api/generations/gen-1/status?publisherId=sgi-europe', generationUrl: '/p/sgi-europe/generate/gen-1' }, { status: 202 }));
    await tick();
    await tick();
    expect(navigate).toHaveBeenCalledWith(`${PLATFORM}/p/sgi-europe/generate/gen-1`);
  });

  it('keeps an unknown company in the widget with a specific message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'company_resolution_failed' }, { status: 400 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { widget, navigate } = await loadWidget();
    fill(widget, 'adids', 'Product Manager');
    await tick();
    await tick();
    expect(navigate).not.toHaveBeenCalled();
    expect(widget.shadowRoot.querySelector('[data-profile-error]')?.textContent).toBe("We couldn't find 'adids'. Check the spelling or enter the company's website.");
    expect(widget.shadowRoot.querySelector('.error-state')).toBeNull();
    const company = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!;
    expect(company.value).toBe('adids');
    expect(company.getAttribute('aria-invalid')).toBe('true');
    expect(company.readOnly).toBe(false);
    expect(widget.shadowRoot.querySelector('[data-action="generate"]')?.textContent).toContain('Build my briefing');
  });

  it('shows the generic error state when the service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'generation_unavailable' }, { status: 503 })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { widget, navigate } = await loadWidget();
    fill(widget, 'nike.com', 'Head of Retail');
    await tick();
    await tick();
    expect(navigate).not.toHaveBeenCalled();
    expect(widget.shadowRoot.querySelector('.error-state')?.textContent).toContain('We could not start your briefing');
  });

  it('validates locally before creating a job', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const { widget } = await loadWidget();
    fill(widget, 'nike.com', 'x'.repeat(161));
    await tick();
    expect(request).not.toHaveBeenCalled();
    expect(widget.shadowRoot.querySelector('[data-profile-error]')?.textContent).toContain('too long');
  });

  it('has a specific message for each input error the endpoint can return', () => {
    expect(generationInputMessage('company_resolution_timeout', 'Acme Sports')).toBe("We couldn't look up 'Acme Sports' in time. Try again, or enter the company's website.");
    expect(generationInputMessage('unsafe_company_url', 'http://10.0.0.1')).toContain('public website');
    expect(generationInputMessage('rate_limited', 'nike')).toContain('wait a minute');
    expect(generationInputMessage('generation_unavailable', 'nike')).toBeUndefined();
  });

  it('resets to the editable form, keeping the entered values, when Back restores the page from the bfcache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ generationId: 'gen-1', generationUrl: '/p/sgi-europe/generate/gen-1' }, { status: 202 })));
    const { widget, navigate } = await loadWidget();
    fill(widget, 'nike', 'Head of Retail');
    await tick();
    await tick();
    expect(navigate).toHaveBeenCalledOnce();
    // Navigation began, so the page was frozen mid-"Starting".
    expect(widget.shadowRoot.querySelector('[data-action="generate"]')?.textContent).toBe('Starting your briefing…');

    const pageshow = new Event('pageshow');
    Object.defineProperty(pageshow, 'persisted', { value: true });
    window.dispatchEvent(pageshow);
    const button = widget.shadowRoot.querySelector<HTMLButtonElement>('[data-action="generate"]')!;
    expect(button.textContent).toContain('Build my briefing');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    const company = widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!;
    expect(company.value).toBe('nike');
    expect(company.readOnly).toBe(false);
    expect(widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')?.value).toBe('Head of Retail');

    // And another briefing can be started straight away.
    fill(widget, 'adidas', 'Head of Retail');
    await tick();
    await tick();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('ignores a normal pageshow, and resets on becoming visible only when no request is in flight', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const { widget } = await loadWidget();
    fill(widget, 'nike', 'Head of Retail');
    await tick();
    const label = () => widget.shadowRoot.querySelector('[data-action="generate"]')?.textContent;
    window.dispatchEvent(new Event('pageshow'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    // The POST is still pending: keep "Starting".
    expect(label()).toBe('Starting your briefing…');

    respond(Response.json({ generationId: 'gen-1', generationUrl: '/p/sgi-europe/generate/gen-1' }, { status: 202 }));
    await tick();
    await tick();
    expect(label()).toBe('Starting your briefing…');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(label()).toContain('Build my briefing');
    delete (document as { visibilityState?: string }).visibilityState;
  });
});
