// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryAnalytics } from '../src/core';
import { createMockAIRecommendationLayer } from '../src/ai/recommendation';
import { createDemoRegistry } from '../src/demo/definition';
import { mountWidget } from '../src/widget/mount';
import '../src/widget/widget';

describe('consumer widget flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens, completes the questionnaire, and renders hybrid results in a narrow viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    const analytics = new MemoryAnalytics();
    const widget = mountWidget(createDemoRegistry(), 'demo', analytics, document, undefined, createMockAIRecommendationLayer());
    const root = widget.shadowRoot!;

    expect(root.querySelector('.launcher')).not.toBeNull();
    expect(root.querySelector('style')?.textContent).toContain('@media (max-width: 560px)');
    (root.querySelector('.launcher') as HTMLButtonElement).click();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.querySelector('.intro-heading')).not.toBeNull();
    (root.querySelector('[data-action="begin"]') as HTMLButtonElement).click();

    const interest = root.querySelector<HTMLInputElement>('input[value="sustainability"]')!;
    interest.checked = true;
    interest.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    (root.querySelector('[data-action="continue"]') as HTMLButtonElement).click();

    const role = root.querySelector<HTMLInputElement>('input[value="manufacturer"]')!;
    role.checked = true;
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    (root.querySelector('[data-action="continue"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(root.querySelector('.article-grid')).not.toBeNull();
    expect(root.querySelector('.featured-card')).not.toBeNull();
    expect(root.querySelector('.best-badge')).not.toBeNull();
    expect(root.querySelector('.why')).not.toBeNull();
    expect(root.querySelectorAll('.article-card').length).toBeGreaterThan(0);
    expect(root.querySelector('.content')).not.toBeNull();
    expect(analytics.events.some((event) => event.name === 'search_completed' && event.metadata?.rankingMode === 'hybrid')).toBe(true);
  });

  it('supports closing and Escape without affecting the host document', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const widget = mountWidget(createDemoRegistry(), 'demo');
    const root = widget.shadowRoot!;
    (root.querySelector('.launcher') as HTMLButtonElement).click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.launcher')).not.toBeNull();
    expect(document.body.querySelector('content-discovery-widget')).toBe(widget);
  });

  it('continues the consumer flow when analytics delivery rejects', async () => {
    const analytics = { track: () => Promise.reject(new Error('analytics offline')) };
    const widget = mountWidget(createDemoRegistry(), 'demo', analytics);
    (widget.shadowRoot!.querySelector('.launcher') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(widget.shadowRoot!.querySelector('.intro-heading')).not.toBeNull();
  });
});
