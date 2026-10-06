// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoRegistry } from '../src/demo/definition';
import { CONTENT_DISCOVERY_ELEMENT_NAME, ensureContentDiscoveryElementRegistered } from '../src/widget/registration';
import { mountWidget } from '../src/widget/mount';
import { ContentDiscoveryWidget } from '../src/widget/widget';

describe('incompatible content-discovery-widget registration', () => {
  beforeAll(() => {
    class IncompatibleWidget extends HTMLElement {}
    customElements.define(CONTENT_DISCOVERY_ELEMENT_NAME, IncompatibleWidget);
  });

  it('fails fast with a useful compatibility diagnostic', () => {
    expect(() => ensureContentDiscoveryElementRegistered(ContentDiscoveryWidget)).toThrow(/incompatible custom element.*configure, openWidget/);
    expect(() => mountWidget(createDemoRegistry())).toThrow(/registered element is incompatible|incompatible custom element/);
  });
});
