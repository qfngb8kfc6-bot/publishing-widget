import { describe, expect, it } from 'vitest';
import { createEvent, DeterministicExplanationProvider, PublisherRegistry } from '../src/core';
import { demoManifest } from '../src/demo/config';
import { DemoPublisherAdapter } from '../src/demo/adapter';
import { validatePublisherManifest } from '../src/core/config';
import { createPublisherRegistry } from '../src/publishers/registry';
import { publisherEnvironmentKey, validatePublisherServerConfig } from '../src/server/env';

describe('Phase 5 publisher operations', () => {
  it('validates and registers typed manifests without changing the widget contract', () => {
    validatePublisherManifest(demoManifest);
    const registry = new PublisherRegistry();
    registry.registerManifest(demoManifest, new DemoPublisherAdapter(), new DeterministicExplanationProvider());
    expect(registry.get('demo')?.manifest?.publisherConfigVersion).toBe('1');
    expect(() => registry.registerManifest(demoManifest, new DemoPublisherAdapter(), new DeterministicExplanationProvider())).toThrow('already registered');
  });

  it('keeps server credential conventions outside browser configuration', () => {
    expect(publisherEnvironmentKey('acme-media', 'API_KEY')).toBe('PUBLISHER_ACME_MEDIA_API_KEY');
    expect(() => validatePublisherServerConfig({ ...demoManifest, environment: 'production', api: { authentication: 'server-proxy' } }, {})).toThrow('PUBLISHER_DEMO_API_KEY');
  });

  it('scopes analytics events to widget and publisher config versions', () => {
    const event = createEvent('widget_opened', 'demo', 'session-1');
    expect(event.widgetVersion).toBe('0.5.0');
    expect(event.publisherId).toBe('demo');
  });

  it('keeps demo and real publisher definitions in one registry', () => {
    const registry = createPublisherRegistry();
    expect(registry.list().map((definition) => definition.config.publisherId)).toEqual(['demo', 'real-publisher']);
  });
});
