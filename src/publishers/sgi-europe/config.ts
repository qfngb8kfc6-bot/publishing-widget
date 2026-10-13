import type { PublisherConfig } from '../../core';
import type { PublisherManifest } from '../manifest';
import type { FeedSourceConfig } from '../content';

export const sgiEuropeFeedUrl = 'https://www.sgieurope.com/9871.rss?adredir=1';

export const sgiEuropeContentSource: FeedSourceConfig = {
  type: 'rss',
  feedUrl: sgiEuropeFeedUrl,
  allowedHostnames: ['www.sgieurope.com', 'sgieurope.com'],
  deriveCategoryFromUrl: true,
  candidateLimit: 100,
  timeoutMs: 8000,
  maxBytes: 5_000_000,
  sourceName: 'SGI Europe RSS feed',
};

export const sgiEuropeConfig: PublisherConfig = {
  publisherId: 'sgi-europe',
  publisherName: 'SGI Europe',
  branding: {
    primaryColor: '#244f68',
    secondaryColor: '#e8f0f3',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    widgetTitle: 'Build your SGI Europe briefing',
    introductoryCopy: 'Tell us where you work and what you do. We will find relevant developments from SGI Europe coverage.',
    radiusPreference: 'soft',
    backgroundTreatment: 'plain',
  },
  content: { adapterType: 'rss', resultLimit: 8, candidateRetrievalLimit: 100 },
  results: {
    heading: 'Stories selected for your work',
    description: 'Relevant developments selected from SGI Europe coverage.',
    maximumRecommendations: 8,
    openArticleInNewTab: true,
  },
};

export const sgiEuropeManifest: PublisherManifest = {
  publisherId: 'sgi-europe',
  name: 'SGI Europe',
  enabled: true,
  environment: 'production',
  publisherConfigVersion: '1',
  branding: {
    ...sgiEuropeConfig.branding,
    loading: { backgroundFallback: '#244f68', overlay: 'rgba(15,39,53,.42)', textColor: '#ffffff' },
    report: { backgroundFallback: '#244f68', overlay: 'rgba(15,39,53,.48)', textColor: '#ffffff' },
  },
  content: { adapterId: 'rss', resultLimit: 8, candidateRetrievalLimit: 100, searchBehavior: 'keywords' },
  results: sgiEuropeConfig.results,
  ranking: { mode: 'hybrid', deterministicWeight: 0.7, semanticWeight: 0.3 },
  features: { aiEnabled: true, explanationsEnabled: true, analyticsEnabled: true },
  contentSource: sgiEuropeContentSource,
  allowedOrigins: ['https://www.sgieurope.com', 'https://sgieurope.com'],
  reportSections: ['top-developments', 'companies-to-watch', 'market-moves', 'sustainability-developments', 'more-relevant-stories'],
  primaryCTA: 'Build your SGI Europe briefing',
  poweredBy: true,
};
