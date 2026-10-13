import { DeterministicExplanationProvider, PublisherRegistry } from '../../core';
import { IbiPublisherAdapter } from './adapter';
import { ibiConfig, ibiManifest } from './config';

export function createIbiDefinition(fetchImpl?: typeof fetch) {
  return { config: ibiConfig, adapter: new IbiPublisherAdapter(fetchImpl), explanationProvider: new DeterministicExplanationProvider(), manifest: ibiManifest };
}

export function registerIbiPublisher(registry: PublisherRegistry, fetchImpl?: typeof fetch): void {
  const definition = createIbiDefinition(fetchImpl);
  registry.registerManifest(ibiManifest, definition.adapter, definition.explanationProvider);
}
