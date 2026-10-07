// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAnalytics } from '../src/core';
import { createDemoRegistry } from '../src/demo/definition';
import { mountWidget } from '../src/widget/mount';
import '../src/widget/widget';

describe('professional embed mode', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('collects exactly company website and job role without rendering the report in the embed', () => {
    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document, undefined, undefined, { generationEndpoint: '/api/reports/generate' });
    widget.openWidget();
    expect(widget.shadowRoot?.querySelectorAll('[data-profile-field]')).toHaveLength(2);
    expect(widget.shadowRoot?.querySelector('[data-profile-field="companyUrl"]')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('[data-profile-field="jobTitle"]')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('.article-grid')).toBeNull();
    expect(widget.shadowRoot?.querySelector('[data-action="generate"]')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="generate"]')?.type).toBe('submit');
    expect(widget.shadowRoot?.querySelectorAll('form.briefing-bar')).toHaveLength(1);
    expect(widget.shadowRoot?.querySelector('.panel, .panel-inner, .content, .intro, .capsule-brand')).toBeNull();
    expect(widget.shadowRoot?.querySelector('.briefing-label')?.textContent).toBe('I work at');
    expect(widget.shadowRoot?.querySelectorAll('.briefing-label')[1]?.textContent).toBe('as a');
    widget.prefillProfile('ldsystems.uk', 'Software Engineer');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.value).toBe('ldsystems.uk');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')?.value).toBe('Software Engineer');
  });

  it('renders the exact reference composition in DOM order', () => {
    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document);
    widget.openWidget();
    const form = widget.shadowRoot?.querySelector<HTMLFormElement>('form.briefing-bar');
    if (!form) throw new Error('briefing bar not rendered');
    const mainChildren = [...form.children].filter((element) => !element.matches('.profile-error'));
    expect(mainChildren.map((element) => element.className)).toEqual([
      'briefing-label',
      'briefing-field briefing-field--company',
      'briefing-label',
      'briefing-field briefing-field--role',
      'briefing-arrow',
      'briefing-submit',
    ]);
    expect(mainChildren[0]?.textContent).toBe('I work at');
    expect(mainChildren[2]?.textContent).toBe('as a');
    expect(mainChildren[4]?.textContent).toBe('→');
    expect(mainChildren[5]?.textContent).toContain('Build my briefing');
  });

  it('uses a unified desktop capsule and submits through the keyboard form path', async () => {
    const analytics = new MemoryAnalytics();
    const widget = mountWidget(createDemoRegistry(), 'demo', analytics, document);
    widget.openWidget();
    const styles = widget.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('grid-template-columns:auto minmax(170px,1fr)');
    expect(styles).toContain('linear-gradient(105deg,#18156f');
    expect(styles).toContain('backdrop-filter:blur(18px)');
    expect(styles).toContain('min-height:72px');
    expect(styles).toContain('width:194px');
    expect(styles).toContain('@media (max-width:620px)');
    expect(styles).toContain('grid-template-columns:1fr;');
    expect(widget.shadowRoot?.querySelectorAll('.briefing-label')[1]?.textContent).toBe('as a');
    expect(widget.shadowRoot?.querySelector('.capsule-brand')).toBeNull();
    expect(widget.shadowRoot?.querySelector('.publisher-mark')).toBeNull();

    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const form = widget.shadowRoot?.querySelector<HTMLFormElement>('form.briefing-bar');
    const company = widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]');
    const role = widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]');
    if (!form || !company || !role) throw new Error('professional form not rendered');
    company.value = 'ldsystems.uk';
    role.value = 'Software Engineer';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({ companyUrl: 'ldsystems.uk', jobTitle: 'Software Engineer', publisherId: 'demo' });
    expect(analytics.events.map((event) => event.name)).toEqual(expect.arrayContaining(['company_entered', 'role_entered', 'report_requested']));
    vi.unstubAllGlobals();
  });
});
