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
    launcherText: 'Find stories for you',
    widgetTitle: 'Your reading guide',
    introductoryCopy: 'Answer two quick questions and we’ll find relevant stories from the publisher’s coverage.',
    radiusPreference: 'soft',
    backgroundTreatment: 'plain',
  },
  questions: [
    {
      id: 'interest',
      question: 'What are you interested in?',
      supportingText: 'Choose a starting point and we’ll tune the reading list around it.',
      type: 'single-select',
      required: true,
      options: [
        { value: 'sustainability', label: 'Sustainability' },
        { value: 'technology', label: 'Technology' },
        { value: 'science', label: 'Science' },
        { value: 'culture', label: 'Culture & community' },
        { value: 'business', label: 'Business & work' },
        { value: 'health', label: 'Health & wellbeing' },
      ],
    },
    {
      id: 'role',
      question: 'What best describes you?',
      supportingText: 'This helps us choose stories with the right perspective and level of detail.',
      type: 'single-select',
      required: true,
      options: [
        { value: 'executive', label: 'I lead a team or organisation' },
        { value: 'manufacturer', label: 'I make or build things' },
        { value: 'developer', label: 'I work with technology' },
        { value: 'student', label: 'I’m learning or researching' },
        { value: 'curious-reader', label: 'I’m here to explore' },
      ],
    },
  ],
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
  branding: realPublisherConfig.branding,
  questions: realPublisherConfig.questions,
  content: { adapterId: realPublisherConfig.content.adapterType, resultLimit: realPublisherConfig.content.resultLimit, candidateRetrievalLimit: realPublisherConfig.content.candidateRetrievalLimit, searchBehavior: 'intent' },
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
