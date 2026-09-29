import { DiscoveryError, type Intent, type PublisherAdapter, type SearchOptions } from '../../core';
import { normalizeTemplateArticle } from './normalizer';
import type { TemplateRawArticle } from './types';

export class TemplatePublisherAdapter implements PublisherAdapter<TemplateRawArticle> {
  readonly publisherId = 'replace-me';

  async search(_intent: Intent, _options: SearchOptions): Promise<TemplateRawArticle[]> {
    throw new DiscoveryError('api-unavailable');
  }

  normalizeArticle(raw: TemplateRawArticle) {
    return normalizeTemplateArticle(raw, this.publisherId);
  }
}
