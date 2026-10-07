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
    widget.prefillProfile('ldsystems.uk', 'Software Engineer');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.value).toBe('ldsystems.uk');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')?.value).toBe('Software Engineer');
  });

  it('uses a unified desktop capsule and submits through the keyboard form path', async () => {
    const analytics = new MemoryAnalytics();
    const widget = mountWidget(createDemoRegistry(), 'demo', analytics, document);
    widget.openWidget();
    const styles = widget.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('grid-template-columns: minmax(150px, .85fr)');
    expect(styles).toContain('linear-gradient(110deg, #4d70ff');
    expect(styles).toContain('backdrop-filter: blur(25px) saturate(1.15)');
    expect(styles).toContain('@media (max-width: 620px)');
    expect(styles).toContain('grid-template-columns: 1fr;');
    expect(widget.shadowRoot?.querySelector('.field-flow')?.textContent).toBe('as a');

    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const form = widget.shadowRoot?.querySelector<HTMLFormElement>('[data-profile-form]');
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
