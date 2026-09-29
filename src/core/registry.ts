import { validatePublisherConfig, validatePublisherManifest } from './config';
import { manifestFromPublisherConfig, manifestToPublisherConfig } from '../publishers/manifest';
import type { PublisherManifest } from '../publishers/manifest';
import type { ExplanationProvider, PublisherAdapter, PublisherConfig } from './types';

export interface PublisherDefinition {
  config: PublisherConfig;
  adapter: PublisherAdapter;
  explanationProvider: ExplanationProvider;
  manifest?: PublisherManifest;
}

export class PublisherRegistry {
  private readonly definitions = new Map<string, PublisherDefinition>();

  register(definition: PublisherDefinition): void {
    validatePublisherConfig(definition.config);
    if (definition.config.publisherId !== definition.adapter.publisherId) throw new Error('Publisher config and adapter ids must match.');
    if (this.definitions.has(definition.config.publisherId)) throw new Error(`Publisher already registered: ${definition.config.publisherId}`);
    this.definitions.set(definition.config.publisherId, { ...definition, manifest: definition.manifest ?? manifestFromPublisherConfig(definition.config) });
  }

  registerManifest(manifest: PublisherManifest, adapter: PublisherAdapter, explanationProvider: ExplanationProvider): void {
    validatePublisherManifest(manifest);
    if (manifest.publisherId !== adapter.publisherId) throw new Error('Publisher manifest and adapter ids must match.');
    this.register({ config: manifestToPublisherConfig(manifest), adapter, explanationProvider, manifest });
  }

  get(publisherId: string): PublisherDefinition | undefined {
    return this.definitions.get(publisherId);
  }

  has(publisherId: string): boolean {
    return this.definitions.has(publisherId);
  }

  list(): PublisherDefinition[] {
    return [...this.definitions.values()];
  }
}
