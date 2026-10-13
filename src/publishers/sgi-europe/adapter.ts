import type { PublisherArticle } from '../../core';
import { FeedContentAdapter } from '../content';
import { sgiEuropeContentSource } from './config';
import { normalizeSgiEuropeArticle } from './normalizer';

export class SgiEuropePublisherAdapter extends FeedContentAdapter {
  constructor(fetchImpl?: typeof fetch) {
    super('sgi-europe', sgiEuropeContentSource, fetchImpl);
  }

  normalizeArticle(raw: unknown): PublisherArticle | null {
    return normalizeSgiEuropeArticle(raw);
  }
}
