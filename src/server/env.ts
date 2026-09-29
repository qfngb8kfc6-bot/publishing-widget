import type { PublisherManifest } from '../publishers/manifest';

export type ServerEnvironment = Record<string, string | undefined>;

export function publisherEnvironmentKey(publisherId: string, field: 'API_KEY' | 'BASE_URL' | 'SEARCH_ENDPOINT' | 'ARTICLE_ENDPOINT' | 'TIMEOUT_MS'): string {
  const safeId = publisherId.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
  return `PUBLISHER_${safeId}_${field}`;
}

export function readPublisherServerConfig(environment: ServerEnvironment, publisherId: string) {
  return {
    apiKey: environment[publisherEnvironmentKey(publisherId, 'API_KEY')],
    baseUrl: environment[publisherEnvironmentKey(publisherId, 'BASE_URL')],
    searchEndpoint: environment[publisherEnvironmentKey(publisherId, 'SEARCH_ENDPOINT')],
    articleEndpoint: environment[publisherEnvironmentKey(publisherId, 'ARTICLE_ENDPOINT')],
    timeoutMs: environment[publisherEnvironmentKey(publisherId, 'TIMEOUT_MS')],
  };
}

export function validatePublisherServerConfig(manifest: PublisherManifest, environment: ServerEnvironment): void {
  if (manifest.environment !== 'production' || manifest.api?.authentication !== 'server-proxy') return;
  const config = readPublisherServerConfig(environment, manifest.publisherId);
  if (!config.apiKey) throw new Error(`Missing ${publisherEnvironmentKey(manifest.publisherId, 'API_KEY')} for production server-proxy publisher.`);
}
