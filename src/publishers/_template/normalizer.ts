import type { NormalizedArticle } from '../../core';
import type { TemplateRawArticle } from './types';

export function normalizeTemplateArticle(raw: TemplateRawArticle, publisherId = 'replace-me'): NormalizedArticle | null {
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title : '';
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!id || !title || !/^https?:\/\//i.test(url)) return null;
  return { id, title, url, description: typeof raw.description === 'string' ? raw.description : undefined, categories: [], tags: [], publisherId, provenance: { publisherId, sourceArticleId: id, sourceUrl: url, retrievalSource: 'template' } };
}
