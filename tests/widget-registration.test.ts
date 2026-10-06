// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAnalytics } from '../src/core';
import { createDemoRegistry } from '../src/demo/definition';
import { CONTENT_DISCOVERY_ELEMENT_NAME, ensureContentDiscoveryElementRegistered } from '../src/widget/registration';
import { mountWidget } from '../src/widget/mount';
import { ContentDiscoveryWidget } from '../src/widget/widget';

describe('content-discovery-widget registration', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('mounts a compatible registered element and remains stable across repeated registration calls', () => {
    const first = ensureContentDiscoveryElementRegistered(ContentDiscoveryWidget);
    const second = ensureContentDiscoveryElementRegistered(ContentDiscoveryWidget);
    expect(second).toBe(first);
    expect(customElements.get(CONTENT_DISCOVERY_ELEMENT_NAME)).toBe(first);

    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document);
    expect(typeof widget.configure).toBe('function');
    expect(typeof widget.openWidget).toBe('function');
  });

  it('allows a second compatible bundle entry point to coexist without overwriting the registration', () => {
    class SecondBundleWidget extends HTMLElement {
      configure(): void {}
      openWidget(): void {}
    }
    const existing = customElements.get(CONTENT_DISCOVERY_ELEMENT_NAME);
    expect(existing).toBeTruthy();
    expect(ensureContentDiscoveryElementRegistered(SecondBundleWidget)).toBe(existing);
    const widget = mountWidget(createDemoRegistry(), 'demo', new MemoryAnalytics(), document);
    expect(widget).toBeInstanceOf(HTMLElement);
    expect(typeof widget.configure).toBe('function');
    expect(typeof widget.openWidget).toBe('function');
  });
});
