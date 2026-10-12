import type { ContentSourceHealth, PublisherContentAdapter, PublisherArticle } from '../../core';

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
  timeoutMs?: number;
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
}

export interface ContentImportResult {
  articles: PublisherArticle[];
  diagnostics: ContentImportDiagnostics;
}

export interface ContentAdapter<RawArticle = unknown> extends PublisherContentAdapter<RawArticle> {
  readonly sourceType: ContentSourceType;
  readonly supportsPagination: boolean;
  lastDiagnostics?: ContentImportDiagnostics;
  healthCheck(): Promise<ContentSourceHealth>;
}

export interface ContentFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  allowedHostnames?: string[];
  maxBytes?: number;
}

export interface ContentAdapterFactoryOptions {
  fetchImpl?: typeof fetch;
  resolveSecret?: (reference: string) => string | undefined;
  loadJson?: () => unknown | Promise<unknown>;
  loadCsv?: () => string | Promise<string>;
}
