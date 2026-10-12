import type { NormalizedArticle } from '../../core';
import { normalizeMappedArticle } from '../content';
import type { ArticleFieldMappings } from '../content';
import type { RealPublisherRawArticle } from './types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  const objectValue = record(value);
  if (objectValue) {
    const candidate = stringValue(objectValue.name, objectValue.label, objectValue.value, objectValue.slug);
    return candidate ? [candidate] : [];
  }
  if (!Array.isArray(value)) return typeof value === 'string' && value.trim() ? [value.trim()] : [];
  return value.flatMap((item) => {
    const itemRecord = record(item);
    const candidate = itemRecord ? stringValue(itemRecord.name, itemRecord.label, itemRecord.value, itemRecord.slug) : stringValue(item);
    return candidate ? [candidate] : [];
  });
}

export function normalizeRealPublisherArticle(raw: unknown, publisherId = 'real-publisher', retrievalSource = 'real-publisher-api', endpoint?: string, mappings?: ArticleFieldMappings): NormalizedArticle | null {
  const article = record(raw);
  if (!article) return null;
  const id = stringValue(article.id, article.uuid, article.articleId, article.article_id);
  const title = stringValue(article.title, article.headline, article.name);
  const url = stringValue(article.url, article.link, article.canonicalUrl, article.canonical_url, article.webUrl);
  if (!mappings && (!id || !title || !url)) return null;
  const normalized = normalizeMappedArticle(raw, { publisherId, sourceType: 'rest-json', sourceName: retrievalSource, sourceUrl: url ?? 'https://invalid.example/', endpoint, mappings });
  if (!normalized) return null;
  const stableId = id ?? normalized.id;
  return { ...normalized, id: stableId, externalId: id ?? normalized.externalId, contentType: stringValue(article.contentType, article.content_type, article.type), audiences: stringList(article.audiences ?? article.audience ?? article.personas), provenance: { ...normalized.provenance!, sourceArticleId: id ?? stableId, retrievalSource } };
}

export function normalizeRealPublisherResponseArticle(raw: RealPublisherRawArticle): NormalizedArticle | null {
  return normalizeRealPublisherArticle(raw);
}
