import type { NormalizedArticle } from '../../core';
import type { AcmeMediaRawArticle } from './types';

export function normalizeAcmeMediaArticle(raw: AcmeMediaRawArticle): NormalizedArticle | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title : '';
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!id || !title || !/^https?:\/\//i.test(url)) return null;
  return { id, title, url, description: typeof raw.description === 'string' ? raw.description : undefined, categories: [], tags: [], publisherId: 'acme-media', provenance: { publisherId: 'acme-media', sourceArticleId: id, sourceUrl: url, retrievalSource: 'acme-media-api' } };
}
