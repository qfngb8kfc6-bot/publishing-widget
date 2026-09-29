import { DiscoveryError, type Intent, type PublisherAdapter, type SearchOptions } from '../../core';
import { normalizeAcmeMediaArticle } from './normalizer';
import type { AcmeMediaRawArticle } from './types';

export class AcmeMediaPublisherAdapter implements PublisherAdapter<AcmeMediaRawArticle> {
  readonly publisherId = 'acme-media';
  async search(_intent: Intent, _options: SearchOptions): Promise<AcmeMediaRawArticle[]> {
    throw new DiscoveryError('api-unavailable');
  }
  normalizeArticle(raw: AcmeMediaRawArticle) { return normalizeAcmeMediaArticle(raw); }
}
