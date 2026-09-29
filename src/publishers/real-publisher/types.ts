import type { NormalizedArticle } from '../../core';

export interface RealPublisherApiConfig {
  baseUrl: string;
  searchEndpoint: string;
  articleEndpoint?: string;
  authentication: {
    mode: 'none' | 'server-proxy';
    headerName?: string;
  };
  requestHeaders: Record<string, string>;
  queryParameters: Record<string, string | number>;
  searchQueryParameter: string;
  pageParameter: string;
  limitParameter: string;
  firstPage: number;
  candidateLimit: number;
  timeoutMs: number;
  retrievalSource: string;
}

export interface RealPublisherEnvironment {
  REAL_PUBLISHER_API_BASE_URL?: string;
  REAL_PUBLISHER_SEARCH_ENDPOINT?: string;
  REAL_PUBLISHER_ARTICLE_ENDPOINT?: string;
  REAL_PUBLISHER_AUTH_MODE?: 'none' | 'server-proxy';
  REAL_PUBLISHER_SEARCH_QUERY_PARAMETER?: string;
  REAL_PUBLISHER_PAGE_PARAMETER?: string;
  REAL_PUBLISHER_LIMIT_PARAMETER?: string;
  REAL_PUBLISHER_CANDIDATE_LIMIT?: string;
  REAL_PUBLISHER_TIMEOUT_MS?: string;
}

export type RealPublisherRawArticle = Record<string, unknown>;

export interface RealPublisherSearchResponse {
  results?: unknown[];
  articles?: unknown[];
  items?: unknown[];
  data?: unknown[] | { results?: unknown[]; articles?: unknown[]; items?: unknown[] };
  hits?: unknown[];
}

export type RealPublisherNormalizedArticle = NormalizedArticle;
