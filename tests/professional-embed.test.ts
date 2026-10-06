// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
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
    widget.prefillProfile('ldsystems.uk', 'Software Engineer');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.value).toBe('ldsystems.uk');
    expect(widget.shadowRoot?.querySelector<HTMLInputElement>('[data-profile-field="jobTitle"]')?.value).toBe('Software Engineer');
  });
});
