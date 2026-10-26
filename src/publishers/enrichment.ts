import type { WvcEnrichmentSourceConfig } from './content';
import { sgiEuropeEnrichmentSource } from './sgi-europe/config';

/**
 * Full-text enrichment sources by publisher, defined in code (not in stored manifests) because they are
 * server-side configuration. Publishers without an entry are unaffected.
 */
const ENRICHMENT_SOURCES: Readonly<Record<string, WvcEnrichmentSourceConfig>> = {
  'sgi-europe': sgiEuropeEnrichmentSource,
};

export function enrichmentSourceFor(publisherId: string): WvcEnrichmentSourceConfig | undefined {
  return Object.hasOwn(ENRICHMENT_SOURCES, publisherId) ? ENRICHMENT_SOURCES[publisherId] : undefined;
}

export function enrichedPublisherIds(): string[] {
  return Object.keys(ENRICHMENT_SOURCES);
}
