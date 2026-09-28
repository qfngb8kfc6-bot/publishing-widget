import { validatePublisherConfig } from './config';
import type { ExplanationProvider, PublisherAdapter, PublisherConfig } from './types';

export interface PublisherDefinition {
  config: PublisherConfig;
  adapter: PublisherAdapter;
  explanationProvider: ExplanationProvider;
}

export class PublisherRegistry {
  private readonly definitions = new Map<string, PublisherDefinition>();

  register(definition: PublisherDefinition): void {
    validatePublisherConfig(definition.config);
    if (definition.config.publisherId !== definition.adapter.publisherId) throw new Error('Publisher config and adapter ids must match.');
    this.definitions.set(definition.config.publisherId, definition);
  }

  get(publisherId: string): PublisherDefinition | undefined {
    return this.definitions.get(publisherId);
  }

  has(publisherId: string): boolean {
    return this.definitions.has(publisherId);
  }
}
