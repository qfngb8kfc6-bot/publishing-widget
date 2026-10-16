import { normalizeToken, tokenize, type ContentSourceHealth, type Intent, type NormalizedArticle, type PublisherArticle, type SearchOptions } from '../../core';
import { getField, normalizeMappedArticle, normalizeRecords, type CanonicalNormalizationOptions } from './normalize';
import { csvRecords } from './csv';
import { assertSafePublicUrl, ContentSourceError, fetchText, safeSourceFetch } from './security';
import { xmlAttribute, xmlBlocks, xmlFirstText, xmlText } from './xml';
import { DEFAULT_FEED_MAX_BYTES } from './types';
import type { ArticleFieldMappings, ContentAdapter, ContentAdapterFactoryOptions, ContentImportDiagnostics, ContentTimingDiagnostics, FeedSourceConfig, PaginationConfig, RestJsonSourceConfig, SitemapSourceConfig, StaticJsonSourceConfig, CsvSourceConfig, ContentSourceConfig } from './types';

type FetchLike = typeof fetch;
type RawRecord = Record<string, unknown>;

const restPayloadCache = new Map<string, { expiresAt: number; payload: unknown }>();

const emptyIntent: Intent = { publisherId: '', answers: {}, queryText: '', keywords: [], interests: [], personas: [] };

function clockMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

function asRecord(value: unknown): RawRecord | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : null; }

function isCanonical(value: unknown): value is PublisherArticle {
  const record = asRecord(value);
  return Boolean(record && typeof record.id === 'string' && typeof record.title === 'string' && typeof record.url === 'string' && typeof record.publisherId === 'string' && Array.isArray(record.categories) && Array.isArray(record.tags));
}

function normalizeCanonicalOrMapped(value: unknown, options: CanonicalNormalizationOptions): PublisherArticle | null {
  return isCanonical(value) ? value : normalizeMappedArticle(value, options);
}

function mergeDiagnostics(target: ContentImportDiagnostics, source: ContentImportDiagnostics): void {
  target.accepted += source.accepted;
  target.rejected += source.rejected;
  target.duplicates += source.duplicates;
  target.warnings += source.warnings;
  target.issues.push(...source.issues);
}

function sourceOptions(publisherId: string, sourceType: string, sourceUrl: string, endpoint: string | undefined, sourceName: string | undefined, mappings: ArticleFieldMappings | undefined, baseUrl?: string): CanonicalNormalizationOptions {
  return { publisherId, sourceType, sourceUrl, endpoint, sourceName, mappings, baseUrl };
}

function boundedLimit(options: SearchOptions, configured = 100): number { return Math.max(1, Math.min(options.limit, configured, 100)); }

function uniqueTerms(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => tokenize(value)))];
}

function phraseOrTokenMatch(term: string, value: string): boolean {
  const normalizedTerm = normalizeToken(term);
  const normalizedValue = normalizeToken(value);
  if (!normalizedTerm || !normalizedValue) return false;
  if (normalizedTerm.includes(' ')) return normalizedValue.includes(normalizedTerm);
  return tokenize(normalizedValue).some((token) => token === normalizedTerm || (normalizedTerm.length >= 6 && token.length >= 6 && token.slice(0, 5) === normalizedTerm.slice(0, 5)));
}

function articlePreselectionScore(article: NormalizedArticle, intent: Intent): number {
  const title = article.title;
  const metadata = [article.description ?? '', article.author ?? '', article.category ?? '', ...article.categories, ...article.tags].join(' ');
  const body = [article.contentSnippet ?? '', article.summary ?? '', article.searchText ?? ''].join(' ');
  const all = `${title} ${metadata} ${body}`;
  const direct = uniqueTerms([...(intent.directInterests ?? []), ...intent.interests, ...intent.personas, ...intent.keywords]);
  const adjacent = uniqueTerms(intent.adjacentInterests ?? []);
  const query = uniqueTerms([intent.queryText]);
  const answerValues = Object.entries(intent.answers ?? {}).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return /company|domain|url/i.test(key) ? values : values.filter((candidate) => /\.[a-z]{2,}$/i.test(String(candidate)));
  });
  const company = uniqueTerms(answerValues.map(String));
  const exclusions = uniqueTerms(intent.excludedConcepts ?? []);
  let score = 0;
  const addMatches = (terms: string[], weight: number) => {
    for (const term of terms) {
      if (phraseOrTokenMatch(term, title)) score += 7 * weight;
      else if (phraseOrTokenMatch(term, metadata)) score += 3 * weight;
      else if (phraseOrTokenMatch(term, body)) score += 1 * weight;
    }
  };
  addMatches(direct, 1);
  addMatches(adjacent, 0.65);
  addMatches(query, 0.35);
  addMatches(company, 1.25);
  for (const term of exclusions) if (phraseOrTokenMatch(term, all)) score -= 6;
  return score;
}

function archiveAwareFeedPreselection(articles: PublisherArticle[], intent: Intent, limit: number): PublisherArticle[] {
  const scored = articles.map((article, index) => ({ article, index, score: articlePreselectionScore(article, intent) }));
  const ordered = [...scored].sort((left, right) => right.score - left.score || compareFeedDates(left.article, right.article) || left.index - right.index);
  return ordered.slice(0, limit).map(({ article }) => article);
}

function safeRequestDebug(url: URL): { url: string; query: Record<string, string> } {
  const safe = new URL(url.toString());
  const query: Record<string, string> = {};
  safe.searchParams.forEach((value, key) => {
    const redacted = /token|secret|api[-_]?key|authorization|password/i.test(key) ? '[redacted]' : value;
    query[key] = redacted;
    safe.searchParams.set(key, redacted);
  });
  return { url: safe.toString(), query };
}

function responseRecords(payload: unknown, path?: string): unknown[] | null {
  if (path) {
    const selected = getField(payload, path);
    return Array.isArray(selected) ? selected : null;
  }
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of ['results', 'articles', 'items', 'hits', 'records']) if (Array.isArray(record[key])) return record[key];
  if (record.data) return responseRecords(record.data);
  return null;
}

function requestUrl(config: RestJsonSourceConfig, intent: Intent, pagination: PaginationConfig, page: number, offset: number, cursor?: string): URL {
  const url = new URL(config.endpoint, new URL(config.baseUrl));
  Object.entries(config.queryParameters ?? {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const query = intent.queryText || [...intent.keywords, ...intent.interests, ...intent.personas].join(' ');
  if (query && config.searchQueryParameter) url.searchParams.set(config.searchQueryParameter, query.slice(0, 500));
  const limit = pagination.pageSize ?? config.candidateLimit ?? 30;
  if (pagination.style === 'page') {
    url.searchParams.set(pagination.pageParameter ?? 'page', String((pagination.firstPage ?? 1) + page));
    url.searchParams.set(pagination.limitParameter ?? 'limit', String(limit));
  } else if (pagination.style === 'offset') {
    url.searchParams.set(pagination.offsetParameter ?? 'offset', String(offset));
    url.searchParams.set(pagination.limitParameter ?? 'limit', String(limit));
  } else if (pagination.style === 'cursor' && cursor) url.searchParams.set(pagination.cursorParameter ?? 'cursor', cursor);
  return url;
}

function nextCursor(payload: unknown, path?: string): string | undefined {
  const selected = path ? getField(payload, path) : getField(payload, 'nextCursor') ?? getField(payload, 'next_cursor') ?? getField(payload, 'pagination.next') ?? getField(payload, 'meta.nextCursor');
  return typeof selected === 'string' && selected ? selected : undefined;
}

export class RestJsonContentAdapter implements ContentAdapter<unknown> {
  readonly sourceType = 'rest-json' as const;
  readonly supportsPagination: boolean;
  lastDiagnostics?: ContentImportDiagnostics;
  private readonly fetchImpl: FetchLike;
  private readonly resolveSecret?: (reference: string) => string | undefined;

  constructor(readonly publisherId: string, private readonly config: RestJsonSourceConfig, fetchImpl?: FetchLike, resolveSecret?: (reference: string) => string | undefined) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    this.resolveSecret = resolveSecret;
    if (!this.fetchImpl) throw new Error('A fetch implementation is required for a REST content adapter.');
    this.supportsPagination = (config.pagination?.style ?? 'page') !== 'none';
  }

  async search(intent: Intent, options: SearchOptions): Promise<unknown[]> {
    const startedAt = Date.now();
    const target = boundedLimit(options, this.config.candidateLimit ?? 100);
    const pagination = this.config.pagination ?? { style: 'page', pageSize: Math.min(target, 30), maxPages: 4 };
    const maxPages = Math.max(1, Math.min(pagination.maxPages ?? 4, 20));
    const normalized: PublisherArticle[] = [];
    const diagnostics: ContentImportDiagnostics = { accepted: 0, rejected: 0, duplicates: 0, warnings: 0, issues: [] };
    let offset = 0;
    let cursor: string | undefined;
    let pagesFetched = 0;
    for (let page = 0; page < maxPages && normalized.length < target; page += 1) {
      pagesFetched += 1;
      const url = requestUrl(this.config, intent, pagination, page, offset, cursor);
      const debugRequest = safeRequestDebug(url);
      options.onDebug?.({ type: 'publisher_search_request', publisherId: this.publisherId, url: debugRequest.url, method: 'GET', query: debugRequest.query });
      const payload = await this.requestJson(url);
      const records = responseRecords(payload, this.config.responsePath);
      if (!records) throw new ContentSourceError('invalid-response', 'Source response did not contain an article array.');
      const result = normalizeRecords(records, sourceOptions(this.publisherId, this.sourceType, this.config.baseUrl, this.config.endpoint, this.config.sourceName, this.config.mappings, this.config.baseUrl));
      mergeDiagnostics(diagnostics, result.diagnostics);
      normalized.push(...result.articles);
      if (!records.length || records.length < (pagination.pageSize ?? target)) break;
      if (pagination.style === 'cursor') {
        cursor = nextCursor(payload, pagination.nextCursorPath);
        if (!cursor) break;
      } else if (pagination.style === 'offset') offset += pagination.pageSize ?? target;
    }
    const unique = normalizeRecords(normalized, sourceOptions(this.publisherId, this.sourceType, this.config.baseUrl, this.config.endpoint, this.config.sourceName, undefined), 0);
    diagnostics.accepted = unique.articles.length;
    diagnostics.duplicates += unique.diagnostics.duplicates;
    diagnostics.issues.push(...unique.diagnostics.issues);
    this.lastDiagnostics = diagnostics;
    options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: Date.now() - startedAt, pagesFetched, rawCount: diagnostics.accepted + diagnostics.rejected + diagnostics.duplicates, normalizedCount: unique.articles.length, rejectedCount: diagnostics.rejected, duplicateCount: diagnostics.duplicates });
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: unique.articles.length });
    return unique.articles.slice(0, target);
  }

  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }

  normalizeArticle(raw: unknown): PublisherArticle | null {
    return normalizeCanonicalOrMapped(raw, sourceOptions(this.publisherId, this.sourceType, this.config.baseUrl, this.config.endpoint, this.config.sourceName, this.config.mappings, this.config.baseUrl));
  }

  async getArticle(id: string): Promise<unknown | null> {
    if (!this.config.articleEndpoint) return null;
    const endpoint = this.config.articleEndpoint.replace(':id', encodeURIComponent(id));
    const payload = await this.requestJson(new URL(endpoint, new URL(this.config.baseUrl)));
    const records = responseRecords(payload, this.config.responsePath);
    if (records?.[0]) return records[0];
    return asRecord(payload) ? payload : null;
  }

  async healthCheck(): Promise<ContentSourceHealth> {
    try {
      const records = await this.search(emptyIntent, { limit: 1 });
      return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: records.length, normalized: records.filter((record) => Boolean(this.normalizeArticle(record))).length, warnings: this.lastDiagnostics?.issues.filter((issue) => issue.status === 'warning').map((issue) => issue.message) ?? [] };
    } catch (error) {
      return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Source check failed.'] };
    }
  }

  private async requestJson(url: URL): Promise<unknown> {
    const cacheTtl = this.config.cacheTtlMs ?? 0;
    const authKey = this.config.authentication?.secretRef ?? this.config.authentication?.mode ?? 'none';
    const cacheKey = `${this.publisherId}|${url.toString()}|${authKey}`;
    const cached = cacheTtl > 0 ? restPayloadCache.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.payload;
    if (cached) restPayloadCache.delete(cacheKey);
    const auth = this.config.authentication;
    const secret = auth?.secretRef && this.resolveSecret ? this.resolveSecret(auth.secretRef) : undefined;
    if (auth && auth.mode !== 'none' && !secret) throw new ContentSourceError('authentication-failure', 'Source authentication is not configured.');
    const headers: Record<string, string> = { Accept: 'application/json', ...(this.config.headers ?? {}) };
    if (secret && auth?.mode === 'bearer') headers.Authorization = `Bearer ${secret}`;
    if (secret && auth?.mode === 'api-key') headers[auth.headerName ?? 'X-API-Key'] = secret;
    if (secret && auth?.mode === 'custom-header') {
      if (!auth.headerName) throw new ContentSourceError('authentication-failure', 'Custom source authentication requires a header name.');
      headers[auth.headerName] = secret;
    }
    const response = await safeSourceFetch(url, { method: this.config.method ?? 'GET', headers }, { timeoutMs: this.config.timeoutMs ?? 8000, fetchImpl: this.fetchImpl });
    let payload: unknown;
    try {
      const body = await response.text();
      if (body.length > 2_000_000) throw new ContentSourceError('invalid-response', 'Source response exceeded the safety limit.');
      payload = JSON.parse(body);
    } catch (error) {
      if (error instanceof ContentSourceError) throw error;
      throw new ContentSourceError('invalid-response', 'Source returned malformed JSON.');
    }
    if (cacheTtl > 0) {
      if (restPayloadCache.size >= 100) restPayloadCache.delete(restPayloadCache.keys().next().value!);
      restPayloadCache.set(cacheKey, { expiresAt: Date.now() + Math.min(cacheTtl, 300_000), payload });
    }
    return payload;
  }
}

function feedImage(block: string): string | undefined {
  const mediaContent = block.match(/<media:content\b[^>]*>/i)?.[0];
  const enclosure = block.match(/<enclosure\b[^>]*>/i)?.[0];
  const mediaThumbnail = block.match(/<media:thumbnail\b[^>]*>/i)?.[0];
  return (mediaContent && xmlAttribute(mediaContent, 'url')) ?? (enclosure && xmlAttribute(enclosure, 'url')) ?? (mediaThumbnail && xmlAttribute(mediaThumbnail, 'url'));
}

function feedAuthor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = xmlText(value).replace(/^#\d+¦/, '').replace(/\[.*$/, '').replace(/#+$/, '').trim();
  return cleaned || undefined;
}

function feedSection(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean)[0];
    if (!segment) return undefined;
    const known: Record<string, string> = { csr: 'CSR', 'csr-and-sustainability': 'CSR and Sustainability' };
    return known[segment.toLowerCase()] ?? segment.split(/[-_]+/).map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : '').join(' ');
  } catch {
    return undefined;
  }
}

function feedRecords(xml: string, type: 'rss' | 'atom', deriveCategoryFromUrl = false): RawRecord[] {
  const blocks = type === 'atom' ? xmlBlocks(xml, 'entry') : xmlBlocks(xml, 'item');
  return blocks.map((block) => {
    const linkTag = block.match(/<link\b[^>]*>/i)?.[0];
    const link = (linkTag && xmlAttribute(linkTag, 'href')) ?? xmlFirstText(block, ['link']);
    const section = deriveCategoryFromUrl ? feedSection(link) : undefined;
    return {
      id: xmlFirstText(block, type === 'atom' ? ['id', 'guid'] : ['guid', 'id']),
      guid: xmlFirstText(block, ['guid', 'id']),
      title: xmlFirstText(block, ['title']),
      url: link,
      description: xmlFirstText(block, ['content:encoded', 'content', 'summary', 'description']),
      body: xmlFirstText(block, ['content:encoded', 'content']),
      author: feedAuthor(xmlFirstText(block, type === 'atom' ? ['author', 'name', 'dc:creator'] : ['abacus:byline', 'author', 'dc:creator'])),
      publishedAt: xmlFirstText(block, type === 'atom' ? ['published', 'updated'] : ['pubDate', 'published', 'date']),
      categories: [section, ...xmlBlocks(block, 'category').map(xmlText)].filter((value): value is string => Boolean(value)),
      image: feedImage(block),
    };
  });
}

function compareFeedDates(left: PublisherArticle, right: PublisherArticle): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.NaN;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
  if (Number.isFinite(rightTime)) return 1;
  if (Number.isFinite(leftTime)) return -1;
  return 0;
}

export class FeedContentAdapter implements ContentAdapter<unknown> {
  readonly sourceType: 'rss' | 'atom';
  readonly supportsPagination = false;
  lastDiagnostics?: ContentImportDiagnostics;
  sourceTimings?: ContentTimingDiagnostics;
  private readonly fetchImpl: FetchLike;

  constructor(readonly publisherId: string, private readonly config: FeedSourceConfig, fetchImpl?: FetchLike) {
    this.sourceType = config.type;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('A fetch implementation is required for a feed content adapter.');
    assertSafePublicUrl(config.feedUrl, config.allowedHostnames);
  }

  async search(intent: Intent, options: SearchOptions): Promise<unknown[]> {
    const startedAt = clockMs();
    const records = await this.loadCatalogue({ onDebug: options.onDebug });
    const normalizationStartedAt = clockMs();
    const result = normalizeRecords(records, sourceOptions(this.publisherId, this.sourceType, this.config.feedUrl, this.config.feedUrl, this.config.sourceName, this.config.mappings, this.config.feedUrl));
    const normalizationMs = clockMs() - normalizationStartedAt;
    this.sourceTimings = { ...this.sourceTimings, normalizationMs, cataloguePreparationMs: clockMs() - startedAt };
    // RSS has no server-side search or pagination contract. For focused theme
    // searches, return the complete normalized archive so the professional
    // profile can preselect across every article instead of ranking an
    // arbitrary first page. Normal report generation keeps the bounded
    // archive-aware preselection path.
    const selected = options.archiveWide
      ? result.articles
      : archiveAwareFeedPreselection(result.articles, intent, boundedLimit(options, this.config.candidateLimit ?? 100));
    this.lastDiagnostics = result.diagnostics;
    this.lastDiagnostics.sourceStats = { feedItemsFetched: records.length, feedItemsSelected: selected.length, preselectionInputCount: result.articles.length, preselectionOutputCount: selected.length, normalizedArticles: result.articles.length };
    this.lastDiagnostics.timings = this.sourceTimings;
    options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: Math.round(clockMs() - startedAt), pagesFetched: 1, rawCount: records.length, normalizedCount: result.articles.length, rejectedCount: result.diagnostics.rejected, duplicateCount: result.diagnostics.duplicates });
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: selected.length });
    return selected;
  }

  async loadCatalogue(options: { limit?: number; onDebug?: import('../../core').DebugSink } = {}): Promise<unknown[]> {
    const startedAt = clockMs();
    const xml = await fetchText(this.config.feedUrl, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', ...(this.config.headers ?? {}) } }, { timeoutMs: this.config.timeoutMs ?? 8000, maxBytes: this.config.maxBytes ?? DEFAULT_FEED_MAX_BYTES, fetchImpl: this.fetchImpl, allowedHostnames: this.config.allowedHostnames });
    const fetchMs = clockMs() - startedAt;
    const parseStartedAt = clockMs();
    const records = feedRecords(xml, this.config.type, this.config.deriveCategoryFromUrl);
    const parseMs = clockMs() - parseStartedAt;
    if (!records.length) throw new ContentSourceError('empty-source', 'Feed did not contain any entries.');
    this.sourceTimings = { sourceFetchMs: fetchMs, sourceParseMs: parseMs, cataloguePreparationMs: clockMs() - startedAt };
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: records.length });
    return records;
  }

  selectCatalogue(articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean }): NormalizedArticle[] {
    return options.archiveWide ? articles : archiveAwareFeedPreselection(articles, intent, boundedLimit(options, this.config.candidateLimit ?? 100));
  }

  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }

  normalizeArticle(raw: unknown): PublisherArticle | null { return normalizeCanonicalOrMapped(raw, sourceOptions(this.publisherId, this.sourceType, this.config.feedUrl, this.config.feedUrl, this.config.sourceName, this.config.mappings, this.config.feedUrl)); }
  async healthCheck(): Promise<ContentSourceHealth> { try { const records = await this.search(emptyIntent, { limit: 1 }); return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: this.lastDiagnostics?.sourceStats?.feedItemsFetched ?? records.length, normalized: this.lastDiagnostics?.accepted ?? records.length, warnings: this.lastDiagnostics?.issues.filter((issue) => issue.status === 'warning').map((issue) => issue.message) ?? [] }; } catch (error) { return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Source check failed.'] }; } }
}

function extractHtmlAttribute(tag: string, name: string): string | undefined { return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]; }

function pageMetadata(html: string, pageUrl: string): RawRecord {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const findMeta = (names: string[]): string | undefined => { for (const name of names) { const tag = metas.find((candidate) => (extractHtmlAttribute(candidate, 'property') ?? extractHtmlAttribute(candidate, 'name'))?.toLowerCase() === name.toLowerCase()); const value = tag ? extractHtmlAttribute(tag, 'content') : undefined; if (value) return value; } return undefined; };
  const jsonLd = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => { try { const parsed = JSON.parse(match[1]); const values = Array.isArray(parsed) ? parsed : [parsed]; return values.flatMap((value) => { const graph = asRecord(value)?.['@graph']; return Array.isArray(graph) ? [value, ...graph] : [value]; }); } catch { return []; } }).find((value) => { const type = asRecord(value)?.['@type']; return typeof type === 'string' ? /article|newsarticle|blogposting/i.test(type) : Array.isArray(type) && type.some((item) => /article|newsarticle|blogposting/i.test(String(item))); });
  const structured = asRecord(jsonLd) ?? {};
  const canonical = html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0];
  const body = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: structured['@id'], title: structured.headline ?? findMeta(['og:title', 'twitter:title']) ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    description: structured.description ?? findMeta(['description', 'og:description', 'twitter:description']),
    body: structured.articleBody ?? body.slice(0, 50000), url: structured.url ?? findMeta(['og:url']) ?? (canonical ? extractHtmlAttribute(canonical, 'href') : undefined) ?? pageUrl,
    image: typeof structured.image === 'string' ? structured.image : asRecord(structured.image)?.url ?? findMeta(['og:image', 'twitter:image']),
    author: typeof structured.author === 'string' ? structured.author : asRecord(structured.author)?.name ?? findMeta(['author', 'article:author']),
    publishedAt: structured.datePublished ?? findMeta(['article:published_time', 'pubdate', 'date']), updatedAt: structured.dateModified ?? findMeta(['article:modified_time']),
    categories: structured.articleSection ?? findMeta(['article:section', 'primarynavigation']), tags: structured.keywords ?? findMeta(['keywords', 'news_keywords']), language: structured.inLanguage ?? findMeta(['og:locale']),
  };
}

export class SitemapContentAdapter implements ContentAdapter<unknown> {
  readonly sourceType = 'sitemap' as const;
  readonly supportsPagination = true;
  lastDiagnostics?: ContentImportDiagnostics;
  sourceTimings?: ContentTimingDiagnostics;
  private readonly fetchImpl: FetchLike;

  constructor(readonly publisherId: string, private readonly config: SitemapSourceConfig, fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error('A fetch implementation is required for a sitemap content adapter.');
    assertSafePublicUrl(config.sitemapUrl, config.allowedHostnames);
  }

  async search(_intent: Intent, options: SearchOptions): Promise<unknown[]> {
    const startedAt = clockMs();
    const records = await this.loadCatalogue({ limit: Math.min(options.limit, this.config.maxUrls ?? 30), onDebug: options.onDebug });
    const normalizationStartedAt = clockMs();
    const result = normalizeRecords(records, sourceOptions(this.publisherId, this.sourceType, this.config.sitemapUrl, this.config.sitemapUrl, this.config.sourceName, undefined));
    this.sourceTimings = { ...this.sourceTimings, normalizationMs: clockMs() - normalizationStartedAt, cataloguePreparationMs: clockMs() - startedAt };
    this.lastDiagnostics = result.diagnostics;
    this.lastDiagnostics.sourceStats = { ...(this.lastDiagnostics.sourceStats ?? {}), normalizedArticles: result.articles.length };
    this.lastDiagnostics.timings = this.sourceTimings;
    if (!result.articles.length) throw new ContentSourceError('empty-source', 'Sitemap did not yield any normalizable articles.');
    options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: Math.round(clockMs() - startedAt), pagesFetched: this.lastDiagnostics.sourceStats?.sitemapDocumentsFetched ?? 0 + (this.lastDiagnostics.sourceStats?.articlePagesFetched ?? 0), rawCount: records.length, normalizedCount: result.articles.length, rejectedCount: result.diagnostics.rejected, duplicateCount: result.diagnostics.duplicates });
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: result.articles.length });
    return result.articles;
  }

  async loadCatalogue(options: { limit?: number; onDebug?: import('../../core').DebugSink } = {}): Promise<unknown[]> {
    const startedAt = clockMs();
    const sitemapUrl = assertSafePublicUrl(this.config.sitemapUrl, this.config.allowedHostnames);
    const fetchStartedAt = clockMs();
    const discovery = await this.discoverUrls(sitemapUrl, this.config.maxSitemaps ?? 5);
    const discoveryMs = clockMs() - fetchStartedAt;
    const pattern = this.config.urlPattern ? new RegExp(this.config.urlPattern) : undefined;
    const articleUrls = discovery.entries
      .filter((entry) => !pattern || pattern.test(entry.url))
      .sort((left, right) => compareSitemapDates(right.lastmod, left.lastmod));
    const pages = articleUrls.slice(0, Math.min(options.limit ?? this.config.maxUrls ?? 30, this.config.maxUrls ?? 30));
    const records: RawRecord[] = [];
    let articlePagesFetched = 0;
    for (const page of pages) {
      try { const html = await fetchText(page.url, { headers: { Accept: 'text/html,application/xhtml+xml' } }, { timeoutMs: this.config.pageTimeoutMs ?? 8000, fetchImpl: this.fetchImpl, allowedHostnames: this.config.allowedHostnames ?? [sitemapUrl.hostname] }); records.push(pageMetadata(html, page.url)); articlePagesFetched += 1; }
      catch (error) { this.lastDiagnostics = this.lastDiagnostics ?? { accepted: 0, rejected: 0, duplicates: 0, warnings: 0, issues: [] }; this.lastDiagnostics.warnings += 1; this.lastDiagnostics.issues.push({ status: 'warning', message: error instanceof Error ? error.message : 'Article page could not be fetched.' }); }
    }
    if (!pages.length) throw new ContentSourceError('empty-source', 'Sitemap did not contain any matching article URLs.');
    this.sourceTimings = { sourceFetchMs: clockMs() - fetchStartedAt, sourceParseMs: discoveryMs, cataloguePreparationMs: clockMs() - startedAt };
    this.lastDiagnostics = { accepted: 0, rejected: 0, duplicates: 0, warnings: 0, issues: [], sourceStats: { sitemapDocumentsFetched: discovery.documentsFetched, sitemapUrlsFound: discovery.entries.length, articleUrlsAccepted: articleUrls.length, articleUrlsSelected: pages.length, articlePagesFetched } };
    options.onDebug?.({ type: 'candidate_retrieval', publisherId: this.publisherId, count: records.length });
    return records;
  }

  selectCatalogue(articles: NormalizedArticle[], _intent: Intent, options: { limit: number; archiveWide?: boolean }): NormalizedArticle[] {
    return articles.slice(0, Math.min(options.limit, this.config.maxUrls ?? 30));
  }

  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }

  normalizeArticle(raw: unknown): PublisherArticle | null { return isCanonical(raw) ? raw : normalizeMappedArticle(raw, sourceOptions(this.publisherId, this.sourceType, this.config.sitemapUrl, this.config.sitemapUrl, this.config.sourceName, undefined)); }
  async healthCheck(): Promise<ContentSourceHealth> { try { const records = await this.search(emptyIntent, { limit: 1 }); return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: records.length, normalized: records.length, warnings: this.lastDiagnostics?.issues.filter((issue) => issue.status === 'warning').map((issue) => issue.message) ?? [] }; } catch (error) { return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Source check failed.'] }; } }

  private async discoverUrls(root: URL, maxSitemaps: number): Promise<{ entries: SitemapEntry[]; documentsFetched: number }> {
    const queue = [root.toString()]; const visited = new Set<string>(); const entries: SitemapEntry[] = [];
    while (queue.length && visited.size < maxSitemaps) {
      const current = queue.shift()!; if (visited.has(current)) continue; visited.add(current);
      const xml = await fetchText(current, { headers: { Accept: 'application/xml,text/xml' } }, { timeoutMs: this.config.pageTimeoutMs ?? 8000, fetchImpl: this.fetchImpl, allowedHostnames: this.config.allowedHostnames ?? [root.hostname] });
      const isIndex = /<sitemapindex\b/i.test(xml);
      const blocks = xmlBlocks(xml, isIndex ? 'sitemap' : 'url');
      const locations = blocks.flatMap((block) => {
        const loc = xmlFirstText(block, ['loc']);
        if (!loc) return [];
        const safe = assertSafePublicUrl(loc, this.config.allowedHostnames ?? [root.hostname]);
        return [{ url: safe.toString(), lastmod: xmlFirstText(block, ['lastmod']) }];
      });
      if (isIndex) {
        // Some publisher indexes put a broad, non-article sitemap before the
        // year-specific sitemaps. Prefer the newest year within the bounded
        // traversal so maxSitemaps cannot silently exclude current content.
        locations.sort((left, right) => sitemapPriority(right.url) - sitemapPriority(left.url));
        for (const location of locations) if (visited.size + queue.length < maxSitemaps) queue.push(location.url);
      } else {
        for (const location of locations) entries.push({ url: location.url, lastmod: location.lastmod });
      }
    }
    return { entries: [...new Map(entries.map((entry) => [entry.url, entry])).values()], documentsFetched: visited.size };
  }
}

interface SitemapEntry { url: string; lastmod?: string; }

function compareSitemapDates(left: string | undefined, right: string | undefined): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  if (Number.isFinite(leftTime)) return -1;
  if (Number.isFinite(rightTime)) return 1;
  return 0;
}

function sitemapPriority(value: string): number {
  try {
    const year = Number(new URL(value).searchParams.get('year'));
    return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : 0;
  } catch {
    return 0;
  }
}

export class StaticJsonContentAdapter implements ContentAdapter<unknown> {
  readonly sourceType = 'json' as const;
  readonly supportsPagination = false;
  lastDiagnostics?: ContentImportDiagnostics;
  constructor(readonly publisherId: string, private readonly config: StaticJsonSourceConfig, private readonly load: () => unknown | Promise<unknown>) {}
  async search(_intent: Intent, options: SearchOptions): Promise<unknown[]> { const payload = await this.load(); const records = Array.isArray(payload) ? payload : asRecord(payload)?.articles ?? asRecord(payload)?.items; if (!Array.isArray(records)) throw new ContentSourceError('invalid-response', 'JSON import must be an array or contain an articles array.'); const result = normalizeRecords(records, sourceOptions(this.publisherId, this.sourceType, `static:${this.publisherId}`, undefined, this.config.sourceName, this.config.mappings)); this.lastDiagnostics = result.diagnostics; options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: 0, pagesFetched: 1, rawCount: records.length, normalizedCount: result.articles.length, rejectedCount: result.diagnostics.rejected, duplicateCount: result.diagnostics.duplicates }); return result.articles.slice(0, boundedLimit(options, 100)); }
  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }
  normalizeArticle(raw: unknown): PublisherArticle | null { return isCanonical(raw) ? raw : normalizeMappedArticle(raw, sourceOptions(this.publisherId, this.sourceType, `static:${this.publisherId}`, undefined, this.config.sourceName, this.config.mappings)); }
  async healthCheck(): Promise<ContentSourceHealth> { try { const records = await this.search(emptyIntent, { limit: 1 }); return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: records.length, normalized: records.length, warnings: [] }; } catch (error) { return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Import check failed.'] }; } }
}

export class CsvContentAdapter implements ContentAdapter<unknown> {
  readonly sourceType = 'csv' as const;
  readonly supportsPagination = false;
  lastDiagnostics?: ContentImportDiagnostics;
  constructor(readonly publisherId: string, private readonly config: CsvSourceConfig, private readonly load: () => string | Promise<string>) {}
  async search(_intent: Intent, options: SearchOptions): Promise<unknown[]> { const content = await this.load(); const records = csvRecords(content); const result = normalizeRecords(records, sourceOptions(this.publisherId, this.sourceType, `static:${this.publisherId}`, undefined, this.config.sourceName, this.config.mappings)); this.lastDiagnostics = result.diagnostics; options.onDebug?.({ type: 'content_source', publisherId: this.publisherId, sourceType: this.sourceType, durationMs: 0, pagesFetched: 1, rawCount: records.length, normalizedCount: result.articles.length, rejectedCount: result.diagnostics.rejected, duplicateCount: result.diagnostics.duplicates }); return result.articles.slice(0, boundedLimit(options, 100)); }
  fetch(intent: Intent, options: SearchOptions): Promise<unknown[]> { return this.search(intent, options); }
  normalizeArticle(raw: unknown): PublisherArticle | null { return isCanonical(raw) ? raw : normalizeMappedArticle(raw, sourceOptions(this.publisherId, this.sourceType, `static:${this.publisherId}`, undefined, this.config.sourceName, this.config.mappings)); }
  async healthCheck(): Promise<ContentSourceHealth> { try { const records = await this.search(emptyIntent, { limit: 1 }); return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: true, recordsChecked: records.length, normalized: records.length, warnings: [] }; } catch (error) { return { publisherId: this.publisherId, sourceType: this.sourceType, reachable: false, recordsChecked: 0, normalized: 0, warnings: [error instanceof Error ? error.message : 'Import check failed.'] }; } }
}

export function createContentAdapter(publisherId: string, config: ContentSourceConfig, options: ContentAdapterFactoryOptions = {}): ContentAdapter<unknown> {
  if (config.type === 'rest-json') return new RestJsonContentAdapter(publisherId, config, options.fetchImpl, options.resolveSecret);
  if (config.type === 'rss' || config.type === 'atom') return new FeedContentAdapter(publisherId, config, options.fetchImpl);
  if (config.type === 'sitemap') return new SitemapContentAdapter(publisherId, config, options.fetchImpl);
  if (config.type === 'json') {
    if (!options.loadJson) throw new Error('A JSON loader is required for a static JSON content source.');
    return new StaticJsonContentAdapter(publisherId, config, options.loadJson);
  }
  if (config.type === 'csv') {
    if (!options.loadCsv) throw new Error('A CSV loader is required for a CSV content source.');
    return new CsvContentAdapter(publisherId, config, options.loadCsv);
  }
  throw new Error(`Unsupported content source type: ${config.type}`);
}
