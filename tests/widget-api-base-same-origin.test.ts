// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://discovery.ldsystems.uk/demo"}
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps same-origin behaviour on the platform host, including the beacon for analytics', async () => {
  const script = document.createElement('script');
  script.src = '/widget.js';
  script.setAttribute('data-publisher', 'sgi-europe');
  document.head.appendChild(script);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { calls.push(String(input)); return Response.json({ generationUrl: '/p/sgi-europe/generate/report-3' }, { status: 201 }); }));
  const beacon = vi.fn(() => true);
  vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
  const embed = await import('../src/embed');
  const widget = document.querySelector('content-discovery-widget') as HTMLElement & { openWidget(): void; shadowRoot: ShadowRoot };
  const navigate = vi.spyOn(customElements.get('content-discovery-widget')!.prototype as unknown as { navigateTo(url: string): void }, 'navigateTo').mockImplementation(() => undefined);
  widget.openWidget();
  widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!.value = 'nike';
  widget.shadowRoot.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')!.value = 'Head of Retail';
  widget.shadowRoot.querySelector('form.briefing-bar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toContain('https://discovery.ldsystems.uk/api/reports/generate');
  expect(navigate).toHaveBeenCalledWith('https://discovery.ldsystems.uk/p/sgi-europe/generate/report-3');
  await embed.analyticsClient.flush(true);
  expect(beacon).toHaveBeenCalledWith('https://discovery.ldsystems.uk/api/analytics/events', expect.any(Blob));
  embed.analyticsClient.stop();
});
