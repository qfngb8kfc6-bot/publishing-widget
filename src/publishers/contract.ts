import type { Intent, NormalizedArticle, PublisherAdapter, PublisherDefinition } from '../core';

export interface PublisherContractReport {
  publisherId: string;
  rawCount: number;
  normalizedCount: number;
  errors: string[];
}

export async function checkPublisherContract(definition: PublisherDefinition, intent: Intent, limit = definition.config.content.candidateRetrievalLimit): Promise<PublisherContractReport> {
  const errors: string[] = [];
  if (definition.config.publisherId !== definition.adapter.publisherId) errors.push('config and adapter publisher ids differ');
  const raw = await definition.adapter.search(intent, { limit });
  const normalized: NormalizedArticle[] = [];
  for (const item of raw) {
    try {
      const article = definition.adapter.normalizeArticle(item);
      if (!article) continue;
      normalized.push(article);
      if (!article.id || !article.title || !/^https?:\/\//i.test(article.url)) errors.push(`invalid normalized article: ${article.id || 'unknown'}`);
      if (article.publisherId !== definition.config.publisherId) errors.push(`article publisher mismatch: ${article.id}`);
      if (article.provenance?.publisherId !== article.publisherId) errors.push(`missing provenance: ${article.id}`);
    } catch (error) { errors.push(error instanceof Error ? error.message : 'normalizer threw'); }
  }
  return { publisherId: definition.config.publisherId, rawCount: raw.length, normalizedCount: normalized.length, errors };
}

export function assertPublisherAdapter(adapter: PublisherAdapter, publisherId: string): void {
  if (adapter.publisherId !== publisherId) throw new Error(`Expected adapter ${publisherId}, received ${adapter.publisherId}.`);
}
