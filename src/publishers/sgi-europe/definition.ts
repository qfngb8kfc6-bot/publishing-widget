import { DeterministicExplanationProvider, PublisherRegistry } from '../../core';
import { SgiEuropePublisherAdapter } from './adapter';
import { sgiEuropeConfig, sgiEuropeManifest } from './config';

export function createSgiEuropeDefinition(fetchImpl?: typeof fetch) {
  return { config: sgiEuropeConfig, adapter: new SgiEuropePublisherAdapter(fetchImpl), explanationProvider: new DeterministicExplanationProvider(), manifest: sgiEuropeManifest };
}

export function registerSgiEuropePublisher(registry: PublisherRegistry, fetchImpl?: typeof fetch): void {
  const definition = createSgiEuropeDefinition(fetchImpl);
  registry.registerManifest(sgiEuropeManifest, definition.adapter, definition.explanationProvider);
}
