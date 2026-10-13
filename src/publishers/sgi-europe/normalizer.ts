import type { NormalizedArticle } from '../../core';
import { normalizeMappedArticle } from '../content/normalize';
import { sgiEuropeFeedUrl } from './config';

export function normalizeSgiEuropeArticle(raw: unknown): NormalizedArticle | null {
  return normalizeMappedArticle(raw, {
    publisherId: 'sgi-europe',
    sourceType: 'rss',
    sourceUrl: sgiEuropeFeedUrl,
    endpoint: sgiEuropeFeedUrl,
    sourceName: 'SGI Europe RSS feed',
  });
}
