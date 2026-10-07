// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAnalytics } from '../src/core';
import { wireLiveDemoButtons } from '../src/demo/live-demo';
import { createDemoRegistry } from '../src/demo/definition';
import { mountWidget } from '../src/widget/mount';
import '../src/widget/widget';

describe('sales live-demo CTA wiring', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('wires every CTA and opens the real widget with analytics', () => {
    document.body.innerHTML = '<a data-open-reader href="#live-demo">See the demo</a><button data-open-reader>Start live demo</button>';
    const analytics = new MemoryAnalytics();
    const widget = mountWidget(createDemoRegistry(), 'demo', analytics, document);
    wireLiveDemoButtons(document, () => widget.openWidget());
    const buttons = document.querySelectorAll<HTMLElement>('[data-open-reader]');

    buttons[1].click();
    expect(widget.shadowRoot?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('.profile-form')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('[data-profile-field="companyUrl"]')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('[data-profile-field="jobTitle"]')).not.toBeNull();
    expect(analytics.events.map((event) => event.name)).toEqual(expect.arrayContaining(['widget_opened', 'intro_viewed']));

    (widget.shadowRoot?.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(widget.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    buttons[0].click();
    expect(widget.shadowRoot?.querySelector('.profile-form')).not.toBeNull();
    expect(analytics.events.filter((event) => event.name === 'widget_opened')).toHaveLength(2);
  });

  it('keeps the host visible above page content on narrow viewports', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document);
    widget.openWidget();
    const styles = widget.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(widget.shadowRoot?.querySelector('.panel')).not.toBeNull();
    expect(styles).toContain('position: fixed');
    expect(styles).toContain('z-index: 2147483000');
    expect(styles).toContain('width: 100%;');
    expect(styles).toContain('grid-template-columns: 1fr;');
    expect(styles).toContain('prefers-reduced-motion');
  });

  it('renders the idle experience as a bottom-centred contextual capsule', () => {
    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document);
    const styles = widget.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(widget.shadowRoot?.querySelector('.launcher')).not.toBeNull();
    expect(widget.shadowRoot?.querySelector('.launcher-copy strong')?.textContent).toContain('Find stories relevant to your business');
    expect(styles).toContain('right: 50%');
    expect(styles).toContain('border-radius: 999px');
    expect(styles).toContain('backdrop-filter: blur(16px)');
  });
});
