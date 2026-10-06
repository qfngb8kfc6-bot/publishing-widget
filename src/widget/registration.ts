export const CONTENT_DISCOVERY_ELEMENT_NAME = 'content-discovery-widget';

const requiredMethods = ['configure', 'openWidget'] as const;

export function isCompatibleContentDiscoveryConstructor(value: CustomElementConstructor | undefined): boolean {
  const prototype = value?.prototype as Record<string, unknown> | undefined;
  return Boolean(prototype && requiredMethods.every((method) => typeof prototype[method] === 'function'));
}

export function ensureContentDiscoveryElementRegistered(implementation: CustomElementConstructor): CustomElementConstructor {
  const existing = customElements.get(CONTENT_DISCOVERY_ELEMENT_NAME);
  if (!existing) {
    customElements.define(CONTENT_DISCOVERY_ELEMENT_NAME, implementation);
    return implementation;
  }
  if (!isCompatibleContentDiscoveryConstructor(existing)) {
    throw new Error(`[${CONTENT_DISCOVERY_ELEMENT_NAME}] incompatible custom element is already registered; expected prototype methods: ${requiredMethods.join(', ')}.`);
  }
  return existing;
}
