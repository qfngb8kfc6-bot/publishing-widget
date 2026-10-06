import type { NormalizedArticle } from '../../core';
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

function imageValue(value: unknown): string | undefined {
  const image = record(value);
  return stringValue(value, image?.url, image?.src, image?.href);
}

export function normalizeRealPublisherArticle(raw: unknown, publisherId = 'real-publisher', retrievalSource = 'real-publisher-api'): NormalizedArticle | null {
  const article = record(raw);
  if (!article) return null;
  const id = stringValue(article.id, article.uuid, article.articleId, article.article_id);
  const title = stringValue(article.title, article.headline, article.name);
  const url = stringValue(article.url, article.link, article.canonicalUrl, article.canonical_url, article.webUrl);
  if (!id || !title || !url) return null;

  const author = record(article.author);
  const sourceUrl = url;
  return {
    id,
    title,
    description: stringValue(article.description, article.dek, article.standfirst, article.summary, article.excerpt),
    url,
    imageUrl: imageValue(article.imageUrl ?? article.image_url ?? article.image ?? article.thumbnail),
    publishedAt: stringValue(article.publishedAt, article.published_at, article.publishDate, article.date),
    updatedAt: stringValue(article.updatedAt, article.updated_at, article.modifiedAt, article.modified_at),
    author: stringValue(article.author, article.byline, article.authorName, author?.name),
    categories: stringList(article.categories ?? article.category ?? article.section ?? article.sections),
    tags: stringList(article.tags ?? article.keywords ?? article.topics),
    contentSnippet: stringValue(article.contentSnippet, article.content_snippet, article.snippet, article.body, article.content),
    body: stringValue(article.body, article.content),
    summary: stringValue(article.summary, article.description, article.dek, article.excerpt),
    contentType: stringValue(article.contentType, article.content_type, article.type),
    publisherId,
    audiences: stringList(article.audiences ?? article.audience ?? article.personas),
    provenance: { publisherId, sourceArticleId: id, sourceUrl, retrievalSource },
  };
}

export function normalizeRealPublisherResponseArticle(raw: RealPublisherRawArticle): NormalizedArticle | null {
  return normalizeRealPublisherArticle(raw);
}
