import type { ContentSourceHealth, DebugSink, NormalizedArticle, PublisherContentAdapter, PublisherArticle, Intent } from '../../core';

export const DEFAULT_FEED_MAX_BYTES = 5_000_000;
export const MAX_CONFIGURED_FEED_MAX_BYTES = 20 * 1024 * 1024;

export type ContentSourceType = 'wvc' | 'rest-json' | 'rss' | 'atom' | 'sitemap' | 'json' | 'csv' | 'static-demo';

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

/**
 * Server-side full-text enrichment (WVC story-list API). It never replaces the catalogue source: it adds cleaned
 * body text, stored in Postgres and joined on the numeric story code, for matching and AI grounding only.
 * The key is read only from the server environment variable named by `secretRef`.
 */
export interface WvcEnrichmentSourceConfig {
  type: 'wvc';
  /** Full story-list endpoint, e.g. https://www.sgieurope.com/abaapi/storylistpagination/json (GET only). */
  baseUrl: string;
  profileName: string;
  /** The API rejects page sizes below 50. */
  pageSize: number;
  /** 4 adds STORYTEXT (the body); 0-2 omit it. */
  dataConstraint: number;
  /** Environment variable holding the key, e.g. `env:SGI_WVC_API_KEY`. */
  secretRef: string;
  allowedHostnames: string[];
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * The WVC story-list API as the catalogue itself (not only enrichment). A background sync stores each story's
 * catalogue fields and cleaned text in Postgres (publisher_article_texts); the catalogue is built from those rows,
 * so a refresh never downloads a feed. With `rss`, the feed is read too, but only for images and categories.
 */
export interface WvcCatalogueSourceConfig {
  type: 'wvc';
  /** Full story-list endpoint (GET only), e.g. https://www.sgieurope.com/abaapi/storylistpagination/json. */
  baseUrl: string;
  profileName: string;
  /** At least 50 (the API rejects smaller pages). */
  pageSize: number;
  /** Must name an environment variable ending in _WVC_API_KEY, e.g. `env:ACME_WVC_API_KEY`. */
  secretRef: string;
  /** Hosts for the API and for story URLs. */
  allowedHostnames: string[];
  /** Hosts an image found in STORYTEXT may come from (default: allowedHostnames). */
  imageHostnames?: string[];
  /**
   * "Show text excerpt as description for subscriber-only stories". Off by default: a PRIVATE=true story then has
   * no description (its card shows headline, category and date); free stories keep their 1-2 sentence excerpt.
   */
  showPrivateExcerpts?: boolean;
  /**
   * API field names tried in order for the headline. Default HEADLINE first (confirmed on SGI responses; present
   * at dataconstraint 1-4, absent at 0), then TITLE, STORYTITLE, STORYHEADLINE, HEADING.
   */
  titleFields?: string[];
  /** WVC API + RSS: the feed supplies images and categories for stories it carries. */
  rss?: { feedUrl: string; allowedHostnames?: string[]; timeoutMs?: number; maxBytes?: number };
  timeoutMs?: number;
  maxBytes?: number;
  candidateLimit?: number;
  sourceName?: string;
}

export type ContentSourceConfig = WvcCatalogueSourceConfig | RestJsonSourceConfig | FeedSourceConfig | SitemapSourceConfig | StaticJsonSourceConfig | CsvSourceConfig | { type: 'static-demo'; sourceName?: string };

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
  /** `preselectionFields` lets a caller supply cached per-article indexes; results must not depend on it. */
  selectCatalogue?(articles: NormalizedArticle[], intent: Intent, options: { limit: number; archiveWide?: boolean; preselectionFields?: (article: NormalizedArticle) => import('./adapters').FeedPreselectionFields }): NormalizedArticle[];
  sourceTimings?: ContentTimingDiagnostics;
  healthCheck(): Promise<ContentSourceHealth>;
}

/** One stored WVC story with its catalogue fields (no text). */
export interface WvcCatalogueRecord {
  storyCode: string;
  title: string;
  url: string;
  publishedAt?: string;
  lastModified?: string;
  description?: string;
  imageUrl?: string;
  isPrivate: boolean;
}

export interface WvcCatalogueReader {
  cataloguePage(publisherId: string, afterStoryCode: string, limit: number): Promise<WvcCatalogueRecord[]>;
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
  /** Reads the rows a WVC catalogue source builds its catalogue from (Postgres, migration 010). */
  wvcCatalogueStore?: WvcCatalogueReader;
  resolveSecret?: (reference: string) => string | undefined;
  loadJson?: () => unknown | Promise<unknown>;
  loadCsv?: () => string | Promise<string>;
}
