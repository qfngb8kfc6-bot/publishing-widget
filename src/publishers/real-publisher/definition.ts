import { DeterministicExplanationProvider, PublisherRegistry } from '../../core';
import { RealPublisherAdapter } from './adapter';
import { defaultRealPublisherApiConfig, realPublisherManifest, realPublisherConfig } from './config';
import type { RealPublisherApiConfig } from './types';

export function createRealPublisherDefinition(apiConfig: RealPublisherApiConfig = defaultRealPublisherApiConfig, fetchImpl?: typeof fetch) {
  return { config: realPublisherConfig, adapter: new RealPublisherAdapter(apiConfig, fetchImpl), explanationProvider: new DeterministicExplanationProvider(), manifest: realPublisherManifest };
}

export function registerRealPublisher(registry: PublisherRegistry, apiConfig?: RealPublisherApiConfig): void {
  const definition = createRealPublisherDefinition(apiConfig);
  registry.registerManifest(realPublisherManifest, definition.adapter, definition.explanationProvider);
}
