import { DeterministicExplanationProvider, PublisherRegistry } from '../core';
import { DemoPublisherAdapter } from './adapter';
import { demoConfig, demoManifest } from './config';

export function createDemoRegistry(): PublisherRegistry {
  const registry = new PublisherRegistry();
  registry.registerManifest(demoManifest, new DemoPublisherAdapter(), new DeterministicExplanationProvider());
  return registry;
}

export function createDemoDefinition() {
  return { config: demoConfig, adapter: new DemoPublisherAdapter(), explanationProvider: new DeterministicExplanationProvider(), manifest: demoManifest };
}
