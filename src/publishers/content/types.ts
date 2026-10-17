import type { ContentSourceHealth, DebugSink, NormalizedArticle, PublisherContentAdapter, PublisherArticle, Intent } from '../../core';

export const DEFAULT_FEED_MAX_BYTES = 5_000_000;
export const MAX_CONFIGURED_FEED_MAX_BYTES = 20 * 1024 * 1024;

export type ContentSourceType = 'rest-json' | 'rss' | 'atom' | 'sitemap' | 'json' | 'csv' | 'static-demo';

export type FieldPath = string | string[];

export interface ArticleFieldMappings {
  id?: FieldPath;
  externalId?: FieldPath;
  guid?: FieldPath;
  title?: FieldPath;
  summary?: FieldPath;
  description?: FieldPath;
  body?: FieldPath;
  excerpt?: FieldPath;
  url?: FieldPath;
  canonicalUrl?: FieldPath;
  imageUrl?: FieldPath;
  author?: FieldPath;
  category?: FieldPath;
  categories?: FieldPath;
  tags?: FieldPath;
  publishedAt?: FieldPath;
  updatedAt?: FieldPath;
  language?: FieldPath;
}

export interface PaginationConfig {
  style: 'page' | 'offset' | 'cursor' | 'none';
  pageParameter?: string;
  offsetParameter?: string;
  limitParameter?: string;
  cursorParameter?: string;
  nextCursorPath?: string;
  firstPage?: number;
  pageSize?: number;
  maxPages?: number;
}

export interface RestJsonSourceConfig {
  type: 'rest-json';
  baseUrl: string;
  endpoint: string;
  articleEndpoint?: string;
  method?: 'GET';
  queryParameters?: Record<string, string | number | boolean>;
  searchQueryParameter?: string;
  headers?: Record<string, string>;
  /** Public headers only. Private credentials are resolved by the server adapter. */
  authentication?: { mode: 'none' | 'api-key' | 'bearer' | 'custom-header'; headerName?: string; secretRef?: string };
  responsePath?: string;
  mappings?: ArticleFieldMappings;
  pagination?: PaginationConfig;
  timeoutMs?: number;
  candidateLimit?: number;
  sourceName?: string;
  cacheTtlMs?: number;
}

export interface FeedSourceConfig {
  type: 'rss' | 'atom';
  feedUrl: string;
  mappings?: ArticleFieldMappings;
  headers?: Record<string, string>;
  allowedHostnames?: string[];
  deriveCategoryFromUrl?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  candidateLimit?: number;
  sourceName?: string;
}

export interface SitemapSourceConfig {
  type: 'sitemap';
  sitemapUrl: string;
  pageTimeoutMs?: number;
  maxUrls?: number;
  maxSitemaps?: number;
  allowedHostnames?: string[];
  urlPattern?: string;
  sourceName?: string;
}

export interface StaticJsonSourceConfig {
  type: 'json';
  mappings?: ArticleFieldMappings;
  sourceName?: string;
}

export interface CsvSourceConfig {
  type: 'csv';
  mappings?: ArticleFieldMappings;
  sourceName?: string;
}

export type ContentSourceConfig = RestJsonSourceConfig | FeedSourceConfig | SitemapSourceConfig | StaticJsonSourceConfig | CsvSourceConfig | { type: 'static-demo'; sourceName?: string };

export interface ContentDiagnostic {
  status: 'accepted' | 'rejected' | 'duplicate' | 'warning';
  message: string;
  row?: number;
  articleId?: string;
}

export interface ContentImportDiagnostics {
  accepted: number;
  rejected: number;
  duplicates: number;
  warnings: number;
  issues: ContentDiagnostic[];
  sourceStats?: {
    feedItemsFetched?: number;
    feedItemsSelected?: number;
    preselectionInputCount?: number;
    preselectionOutputCount?: number;
    sitemapDocumentsFetched?: number;
    sitemapUrlsFound?: number;
    articleUrlsAccepted?: number;
    articleUrlsSelected?: number;
    articlePagesFetched?: number;
    normalizedArticles?: number;
  };
  timings?: ContentTimingDiagnostics;
}

export interface ContentTimingDiagnostics {
  sourceFetchMs?: number;
  sourceReadMs?: number;
  sourceParseMs?: number;
  normalizationMs?: number;
  cataloguePreparationMs?: number;
}

export interface ContentImportResult {
  articles: PublisherArticle[];
  diagnostics: ContentImportDiagnostics;
}

export interface ContentAdapter<RawArticle = unknown> extends PublisherContentAdapter<RawArticle> {
  readonly sourceType: ContentSourceType;
  readonly supportsPagination: boolean;
  lastDiagnostics?: ContentImportDiagnostics;
  /** Loads the complete source catalogue for archive-capable sources. */
  loadCatalogue?(options?: { limit?: number; onDebug?: DebugSink }): Promise<RawArticle[]>;
  /** Applies the source's existing candidate-selection semantics to a cached catalogue. */
  selectCatalogue?(articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean }): NormalizedArticle[];
  sourceTimings?: ContentTimingDiagnostics;
  healthCheck(): Promise<ContentSourceHealth>;
}

export interface ContentFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  allowedHostnames?: string[];
  maxBytes?: number;
  timings?: { sourceFetchMs?: number; sourceReadMs?: number };
}

export interface ContentAdapterFactoryOptions {
  fetchImpl?: typeof fetch;
  resolveSecret?: (reference: string) => string | undefined;
  loadJson?: () => unknown | Promise<unknown>;
  loadCsv?: () => string | Promise<string>;
}
