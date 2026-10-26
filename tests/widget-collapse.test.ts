// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, MemoryAnalytics } from '../src/core';
import { createDemoRegistry } from '../src/demo/definition';
import { mountWidget, parseWidgetPosition } from '../src/widget/mount';
import { validateAnalyticsEvent } from '../src/server/analytics-validation';
import '../src/widget/widget';

const KEY = 'ld-briefing-widget:demo:minimised';

function setViewport(mobile: boolean) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: mobile && query.includes('max-width: 639px'), media: query }) as MediaQueryList });
}

function mount() {
  const analytics = new MemoryAnalytics();
  const widget = mountWidget(createDemoRegistry(), 'demo', analytics, document);
  const shadow = widget.shadowRoot!;
  return { widget, shadow, analytics, names: () => analytics.events.map((event) => event.name) };
}

beforeEach(() => { document.body.innerHTML = ''; window.sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); delete (window as { matchMedia?: unknown }).matchMedia; });

describe('collapsible widget', () => {
  it('starts expanded on desktop; × minimises to the pill and the pill expands it, with focus following', () => {
    setViewport(false);
    const { widget, shadow, names } = mount();
    expect(widget.dataset.state).toBe('expanded');
    expect(shadow.querySelector('form.briefing-bar')).not.toBeNull();
    // Nothing is focused on page load.
    expect(shadow.activeElement).toBeNull();
    const minimise = shadow.querySelector<HTMLButtonElement>('[data-action="close"]')!;
    expect(minimise.getAttribute('aria-label')).toBe('Minimise briefing');
    expect(minimise.getAttribute('aria-expanded')).toBe('true');
    expect(minimise.getAttribute('aria-controls')).toBe('ld-briefing-panel');
    expect(shadow.getElementById('ld-briefing-panel')).not.toBeNull();

    minimise.click();
    const pill = shadow.querySelector<HTMLButtonElement>('[data-action="expand"]')!;
    expect(widget.dataset.state).toBe('minimised');
    expect(widget.hidden).toBe(false);
    expect(shadow.querySelector('form.briefing-bar')).toBeNull();
    expect(pill.textContent).toContain('Get your personalised briefing');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(shadow.activeElement).toBe(pill);
    expect(window.sessionStorage.getItem(KEY)).toBe('1');

    pill.click();
    expect(widget.dataset.state).toBe('expanded');
    expect(shadow.activeElement).toBe(shadow.querySelector('[data-profile-field="companyUrl"]'));
    expect(window.sessionStorage.getItem(KEY)).toBe('0');
    expect(names()).toEqual(expect.arrayContaining(['widget_minimised', 'widget_expanded']));
    expect(names()).not.toContain('widget_closed');
  });

  it('keeps entered values across minimise and expand, and Escape minimises', () => {
    setViewport(false);
    const { shadow } = mount();
    const company = shadow.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')!;
    company.value = 'nike';
    company.dispatchEvent(new Event('input', { bubbles: true }));
    shadow.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shadow.querySelector('[data-action="expand"]')).not.toBeNull();
    shadow.querySelector<HTMLButtonElement>('[data-action="expand"]')!.click();
    expect(shadow.querySelector<HTMLInputElement>('[data-profile-field="companyUrl"]')?.value).toBe('nike');
  });

  it('starts minimised on mobile without moving focus, and opens as a bottom sheet', () => {
    setViewport(true);
    const { widget, shadow } = mount();
    expect(widget.dataset.state).toBe('minimised');
    expect(shadow.activeElement).toBeNull();
    shadow.querySelector<HTMLButtonElement>('[data-action="expand"]')!.click();
    expect(widget.dataset.state).toBe('expanded');
    const styles = shadow.querySelector('style')?.textContent ?? '';
    expect(styles).toContain('@media (max-width:639px)');
    expect(styles).toContain('border-radius:24px 24px 0 0');
    expect(styles).toContain('calc(16px + env(safe-area-inset-bottom))');
    expect(styles).toContain(':host([data-state="minimised"])');
  });

  it('shrinks the pill to a corner chip on mobile, bottom-right unless the publisher sets data-position', () => {
    setViewport(true);
    const { widget, shadow } = mount();
    expect(widget.dataset.position).toBe('bottom-right');
    expect(shadow.querySelector('.pill-label-short')?.textContent).toBe('Your briefing');
    expect(shadow.querySelector('.pill-label-full')?.textContent).toBe('Get your personalised briefing');
    const styles = shadow.querySelector('style')?.textContent ?? '';
    expect(styles).toContain(':host([data-state="minimised"]) { right:max(14px, env(safe-area-inset-right)); left:auto;');
    expect(styles).toContain(':host([data-state="minimised"][data-position="bottom-left"]) { right:auto; left:max(14px, env(safe-area-inset-left)); }');
    expect(styles).toContain(':host([data-state="minimised"][data-position="bottom-center"]) { right:auto; left:50%; transform:translateX(-50%); }');
    expect(styles).toContain('.briefing-pill { gap:8px; min-height:44px;');
    expect(['bottom-left', 'bottom-center', 'bottom-right', 'top-left', null, undefined].map(parseWidgetPosition)).toEqual(['bottom-left', 'bottom-center', 'bottom-right', 'bottom-right', 'bottom-right', 'bottom-right']);
    expect(mountWidget(createDemoRegistry(), 'demo', undefined, document, undefined, undefined, { position: 'bottom-center' }).dataset.position).toBe('bottom-center');
  });

  it('hides the mobile pill while scrolling down and shows it on scroll up or once scrolling stops; never on desktop', () => {
    vi.useFakeTimers();
    try {
      let y = 0;
      vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
      const scrollTo = (value: number) => { y = value; window.dispatchEvent(new Event('scroll')); };
      setViewport(true);
      const { widget } = mount();
      scrollTo(200);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(true);
      vi.advanceTimersByTime(499);
      scrollTo(400);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(false);
      scrollTo(600);
      scrollTo(500);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(false);
      // A bounce of a few pixels changes nothing.
      scrollTo(700);
      scrollTo(698);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(true);
      // Expanded: the sheet never hides.
      widget.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="expand"]')!.click();
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(false);
      scrollTo(900);
      expect(widget.hasAttribute('data-scroll-hidden')).toBe(false);

      document.body.innerHTML = '';
      window.sessionStorage.clear();
      setViewport(false);
      const desktop = mount().widget;
      desktop.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
      scrollTo(1200);
      expect(desktop.dataset.state).toBe('minimised');
      expect(desktop.hasAttribute('data-scroll-hidden')).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('remembers the choice for the session', () => {
    setViewport(true);
    window.sessionStorage.setItem(KEY, '0');
    expect(mount().widget.dataset.state).toBe('expanded');
    document.body.innerHTML = '';
    setViewport(false);
    window.sessionStorage.setItem(KEY, '1');
    expect(mount().widget.dataset.state).toBe('minimised');
  });

  it('works when session storage is unavailable', () => {
    setViewport(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { widget, shadow } = mount();
    expect(widget.dataset.state).toBe('expanded');
    shadow.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(widget.dataset.state).toBe('minimised');
    shadow.querySelector<HTMLButtonElement>('[data-action="expand"]')!.click();
    expect(widget.dataset.state).toBe('expanded');
  });

  it('records widget_expanded and widget_minimised events the ingestion endpoint accepts', () => {
    for (const name of ['widget_expanded', 'widget_minimised'] as const) expect(validateAnalyticsEvent(createEvent(name, 'sgi-europe', 'session-1')).name).toBe(name);
  });
});
