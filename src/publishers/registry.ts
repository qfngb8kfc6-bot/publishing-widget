import { demoManifest } from '../demo/config';
import { DemoPublisherAdapter } from '../demo/adapter';
import { DeterministicExplanationProvider, PublisherRegistry } from '../core';
import { defaultRealPublisherApiConfig, realPublisherManifest } from './real-publisher/config';
import { RealPublisherAdapter } from './real-publisher/adapter';
import type { RealPublisherApiConfig } from './real-publisher/types';

export function createPublisherRegistry(realPublisherApiConfig?: RealPublisherApiConfig, fetchImpl?: typeof fetch): PublisherRegistry {
  const registry = new PublisherRegistry();
  const definitions = [
    { manifest: demoManifest, adapter: new DemoPublisherAdapter() },
    { manifest: realPublisherManifest, adapter: new RealPublisherAdapter(realPublisherApiConfig ?? defaultRealPublisherApiConfig, fetchImpl) },
  ];
  for (const definition of definitions) registry.registerManifest(definition.manifest, definition.adapter, new DeterministicExplanationProvider());
  return registry;
}
