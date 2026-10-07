import type { PublisherConfig } from '../../core';
import type { PublisherManifest } from '../manifest';
import type { RealPublisherApiConfig, RealPublisherEnvironment } from './types';

export const realPublisherConfig: PublisherConfig = {
  publisherId: 'real-publisher',
  publisherName: 'Real Publisher',
  branding: {
    primaryColor: '#36566c',
    secondaryColor: '#e8eff3',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    widgetTitle: 'Build your publisher briefing',
    introductoryCopy: 'Tell us where you work and what you do. We’ll find relevant developments from the publisher’s coverage.',
    radiusPreference: 'soft',
    backgroundTreatment: 'plain',
  },
  content: { adapterType: 'real-publisher-api', resultLimit: 8, candidateRetrievalLimit: 30 },
  results: {
    heading: 'Stories selected for you',
    description: 'A few relevant places to begin, chosen from the publisher’s coverage.',
    maximumRecommendations: 8,
    openArticleInNewTab: true,
  },
};

export const realPublisherManifest: PublisherManifest = {
  publisherId: 'real-publisher',
  name: realPublisherConfig.publisherName,
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { ...realPublisherConfig.branding, loading: { backgroundFallback: '#e8eff3', overlay: 'rgba(28,55,70,.34)', textColor: '#ffffff' }, report: { backgroundFallback: '#36566c', overlay: 'rgba(28,55,70,.48)', textColor: '#ffffff' } },
  content: { adapterId: realPublisherConfig.content.adapterType, resultLimit: realPublisherConfig.content.resultLimit, candidateRetrievalLimit: realPublisherConfig.content.candidateRetrievalLimit, searchBehavior: 'keywords' },
  results: realPublisherConfig.results,
  ranking: { mode: 'deterministic', deterministicWeight: 1, semanticWeight: 0 },
  features: { aiEnabled: false, explanationsEnabled: true, analyticsEnabled: true },
  api: { baseUrl: '/api/publishers/real-publisher', searchEndpoint: '/search', articleEndpoint: '/articles/:id', authentication: 'server-proxy', timeoutMs: 8000, candidateLimit: 30 },
};

export const defaultRealPublisherApiConfig: RealPublisherApiConfig = {
  baseUrl: '/api/publishers/real-publisher',
  searchEndpoint: '/search',
  articleEndpoint: '/articles/:id',
  authentication: { mode: 'server-proxy' },
  requestHeaders: { Accept: 'application/json' },
  queryParameters: {},
  searchQueryParameter: 'q',
  pageParameter: 'page',
  limitParameter: 'limit',
  firstPage: 1,
  candidateLimit: 30,
  timeoutMs: 8000,
  retrievalSource: 'real-publisher-api',
};

export function createRealPublisherApiConfig(environment: RealPublisherEnvironment = {}): RealPublisherApiConfig {
  const integer = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    ...defaultRealPublisherApiConfig,
    baseUrl: environment.REAL_PUBLISHER_API_BASE_URL ?? defaultRealPublisherApiConfig.baseUrl,
    searchEndpoint: environment.REAL_PUBLISHER_SEARCH_ENDPOINT ?? defaultRealPublisherApiConfig.searchEndpoint,
    articleEndpoint: environment.REAL_PUBLISHER_ARTICLE_ENDPOINT ?? defaultRealPublisherApiConfig.articleEndpoint,
    authentication: { mode: environment.REAL_PUBLISHER_AUTH_MODE ?? defaultRealPublisherApiConfig.authentication.mode },
    searchQueryParameter: environment.REAL_PUBLISHER_SEARCH_QUERY_PARAMETER ?? defaultRealPublisherApiConfig.searchQueryParameter,
    pageParameter: environment.REAL_PUBLISHER_PAGE_PARAMETER ?? defaultRealPublisherApiConfig.pageParameter,
    limitParameter: environment.REAL_PUBLISHER_LIMIT_PARAMETER ?? defaultRealPublisherApiConfig.limitParameter,
    candidateLimit: integer(environment.REAL_PUBLISHER_CANDIDATE_LIMIT, defaultRealPublisherApiConfig.candidateLimit),
    timeoutMs: integer(environment.REAL_PUBLISHER_TIMEOUT_MS, defaultRealPublisherApiConfig.timeoutMs),
  };
}
