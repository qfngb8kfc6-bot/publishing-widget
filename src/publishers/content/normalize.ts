import type { NormalizedArticle, PublisherArticle } from '../../core';
import type { ArticleFieldMappings, ContentDiagnostic, ContentImportDiagnostics, ContentImportResult, FieldPath } from './types';

export const CONTENT_NORMALIZER_VERSION = '1.0';

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const cleaned = stripHtml(value);
  return cleaned || undefined;
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : match;
    }
    return entities[lower] ?? match;
  });
}

function pathParts(path: FieldPath): string[] {
  return Array.isArray(path) ? path : path.split('.').filter(Boolean);
}

export function getField(record: unknown, paths: FieldPath | undefined): unknown {
  if (!paths) return undefined;
  const candidates = Array.isArray(paths) ? paths : [paths];
  for (const candidate of candidates) {
    let current: unknown = record;
    for (const part of pathParts(candidate)) {
      const object = asRecord(current);
      if (!object || !(part in object)) { current = undefined; break; }
      current = object[part];
    }
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return undefined;
}

function firstValue(record: RecordValue, mappings: ArticleFieldMappings | undefined, key: keyof ArticleFieldMappings, defaults: string[]): unknown {
  return getField(record, mappings?.[key]) ?? defaults.map((path) => getField(record, path)).find((value) => value !== undefined && value !== null && value !== '');
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const object = asRecord(item);
    return text(object?.name ?? object?.label ?? object?.value ?? item) ? [text(object?.name ?? object?.label ?? object?.value ?? item)!] : [];
  });
  const object = asRecord(value);
  const objectText = text(object?.name ?? object?.label ?? object?.value);
  if (objectText) return [objectText];
  const valueText = text(value);
  return valueText ? valueText.split(/[|,;]/).map((item) => item.trim()).filter(Boolean) : [];
}

function image(value: unknown): string | undefined {
  const object = asRecord(value);
  return text(object?.url ?? object?.src ?? object?.href ?? value);
}

export function normalizeUrl(value: unknown, baseUrl?: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw, baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
    parsed.hash = '';
    [...parsed.searchParams.keys()].forEach((key) => { if (/^(utm_[a-z]+|fbclid|gclid)$/i.test(key)) parsed.searchParams.delete(key); });
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch { return undefined; }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function stableArticleId(input: { externalId?: unknown; guid?: unknown; canonicalUrl?: string; title?: string; publishedAt?: string }): string | undefined {
  const externalId = text(input.externalId) ?? text(input.guid);
  if (externalId) return externalId;
  if (input.canonicalUrl) return `url-${stableHash(input.canonicalUrl.toLowerCase().replace(/^https?:\/\//, ''))}`;
  const fallback = `${input.title ?? ''}|${input.publishedAt ?? ''}`.trim();
  return fallback ? `article-${stableHash(fallback)}` : undefined;
}

export interface CanonicalNormalizationOptions {
  publisherId: string;
  sourceType: string;
  sourceName?: string;
  sourceUrl: string;
  endpoint?: string;
  ingestedAt?: string;
  baseUrl?: string;
  mappings?: ArticleFieldMappings;
}

export function normalizeMappedArticle(raw: unknown, options: CanonicalNormalizationOptions): PublisherArticle | null {
  const record = asRecord(raw);
  if (!record) return null;
  const mappings = options.mappings;
  const title = text(firstValue(record, mappings, 'title', ['title', 'headline', 'name']));
  const url = normalizeUrl(firstValue(record, mappings, 'url', ['url', 'link', 'webUrl', 'canonical_url', 'canonicalUrl']), options.baseUrl);
  if (!title || !url) return null;
  const canonicalUrl = normalizeUrl(firstValue(record, mappings, 'canonicalUrl', ['canonical_url', 'canonicalUrl', 'url', 'link']), options.baseUrl) ?? url;
  const publishedRaw = firstValue(record, mappings, 'publishedAt', ['publishedAt', 'published_at', 'publishDate', 'pubDate', 'date', 'published']);
  const updatedRaw = firstValue(record, mappings, 'updatedAt', ['updatedAt', 'updated_at', 'modifiedAt', 'modified_at', 'lastmod']);
  const publishedAt = text(publishedRaw) && !Number.isNaN(Date.parse(String(publishedRaw))) ? new Date(String(publishedRaw)).toISOString() : undefined;
  const updatedAt = text(updatedRaw) && !Number.isNaN(Date.parse(String(updatedRaw))) ? new Date(String(updatedRaw)).toISOString() : undefined;
  const externalId = text(firstValue(record, mappings, 'externalId', ['externalId', 'external_id', 'id', 'uuid', 'articleId', 'article_id']));
  const guid = text(firstValue(record, mappings, 'guid', ['guid', 'guid.$t', 'id']));
  const id = text(firstValue(record, mappings, 'id', ['id', 'uuid', 'articleId', 'article_id'])) ?? stableArticleId({ externalId, guid, canonicalUrl, title, publishedAt });
  if (!id) return null;
  const description = text(firstValue(record, mappings, 'description', ['description', 'dek', 'standfirst', 'summary', 'excerpt']));
  const summary = text(firstValue(record, mappings, 'summary', ['summary', 'description', 'dek', 'excerpt']));
  const body = text(firstValue(record, mappings, 'body', ['body', 'content', 'content:encoded']));
  const contentSnippet = text(firstValue(record, mappings, 'excerpt', ['contentSnippet', 'content_snippet', 'snippet', 'excerpt', 'description'])) ?? body;
  const authorValue = firstValue(record, mappings, 'author', ['author', 'byline', 'authorName', 'dc:creator']);
  const authorObject = asRecord(authorValue);
  const categories = list(firstValue(record, mappings, 'categories', ['categories', 'category', 'section', 'sections']) ?? firstValue(record, mappings, 'category', ['category', 'section']));
  const tags = list(firstValue(record, mappings, 'tags', ['tags', 'keywords', 'topics']));
  const imageUrl = normalizeUrl(image(firstValue(record, mappings, 'imageUrl', ['imageUrl', 'image_url', 'image', 'thumbnail', 'enclosure', 'media:content'])), options.baseUrl);
  const sourceArticleId = externalId ?? guid ?? id;
  const ingestedAt = options.ingestedAt ?? new Date().toISOString();
  const normalized: NormalizedArticle = {
    id,
    externalId: externalId ?? guid,
    title,
    description,
    url,
    canonicalUrl,
    imageUrl,
    publishedAt,
    updatedAt,
    author: text(authorObject?.name ?? authorValue),
    category: categories[0],
    categories,
    tags,
    excerpt: contentSnippet,
    contentSnippet,
    body,
    summary,
    language: text(firstValue(record, mappings, 'language', ['language', 'lang', 'inLanguage'])),
    sourceType: options.sourceType,
    sourceName: options.sourceName,
    searchText: [title, description, summary, contentSnippet, body, authorObject?.name ?? authorValue, ...categories, ...tags].filter(Boolean).join(' '),
    publisherId: options.publisherId,
    provenance: {
      publisherId: options.publisherId,
      sourceArticleId,
      sourceUrl: options.sourceUrl,
      retrievalSource: options.sourceName ?? options.sourceType,
      sourceType: options.sourceType,
      endpoint: options.endpoint,
      originalUrl: url,
      ingestedAt,
      normalizerVersion: CONTENT_NORMALIZER_VERSION,
    },
  };
  return normalized;
}

function dedupeKey(article: PublisherArticle): string[] {
  const keys = [`id:${article.publisherId}:${article.id}`];
  if (article.externalId) keys.push(`external:${article.publisherId}:${article.externalId.toLowerCase()}`);
  if (article.canonicalUrl) keys.push(`url:${article.publisherId}:${normalizeUrl(article.canonicalUrl)?.replace(/^https?:/i, '')}`);
  const date = article.publishedAt?.slice(0, 10) ?? '';
  keys.push(`title:${article.publisherId}:${article.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${date}`);
  return keys;
}

export function deduplicateArticles(articles: PublisherArticle[]): { articles: PublisherArticle[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: PublisherArticle[] = [];
  let duplicates = 0;
  for (const article of articles) {
    const keys = dedupeKey(article);
    if (keys.some((key) => seen.has(key))) { duplicates += 1; continue; }
    keys.forEach((key) => seen.add(key));
    unique.push(article);
  }
  return { articles: unique, duplicates };
}

export function createDiagnostics(): ContentImportDiagnostics {
  return { accepted: 0, rejected: 0, duplicates: 0, warnings: 0, issues: [] };
}

export function normalizeRecords(records: unknown[], options: CanonicalNormalizationOptions, rowOffset = 1): ContentImportResult {
  const diagnostics = createDiagnostics();
  const normalized: PublisherArticle[] = [];
  records.forEach((record, index) => {
    const article = normalizeMappedArticle(record, options);
    if (!article) {
      diagnostics.rejected += 1;
      diagnostics.issues.push({ status: 'rejected', row: index + rowOffset, message: 'Missing a valid title or HTTP(S) URL.' });
      return;
    }
    const recordValue = asRecord(record);
    const rawDate = recordValue ? firstValue(recordValue, options.mappings, 'publishedAt', ['publishedAt', 'published_at', 'publishDate', 'pubDate', 'date', 'published']) : undefined;
    const rawUpdated = recordValue ? firstValue(recordValue, options.mappings, 'updatedAt', ['updatedAt', 'updated_at', 'modifiedAt', 'modified_at', 'lastmod']) : undefined;
    if ((text(rawDate) && Number.isNaN(Date.parse(String(rawDate)))) || (text(rawUpdated) && Number.isNaN(Date.parse(String(rawUpdated))))) {
      diagnostics.warnings += 1;
      diagnostics.issues.push({ status: 'warning', row: index + rowOffset, articleId: article.id, message: 'Article date was invalid and was omitted.' });
    }
    normalized.push(article);
  });
  const deduplicated = deduplicateArticles(normalized);
  diagnostics.accepted = deduplicated.articles.length;
  diagnostics.duplicates = deduplicated.duplicates;
  if (deduplicated.duplicates) diagnostics.issues.push({ status: 'duplicate', message: `${deduplicated.duplicates} duplicate article record(s) ignored.` });
  return { articles: deduplicated.articles, diagnostics };
}

export function diagnostic(status: ContentDiagnostic['status'], message: string): ContentDiagnostic { return { status, message }; }
