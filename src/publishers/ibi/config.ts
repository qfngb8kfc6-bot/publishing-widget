import type { PublisherConfig } from '../../core';
import type { PublisherManifest } from '../manifest';
import type { SitemapSourceConfig } from '../content';

export const ibiSitemapUrl = 'https://www.ibinews.com/GoogleSiteMapIndex.aspx';

export const ibiContentSource: SitemapSourceConfig = {
  type: 'sitemap',
  sitemapUrl: ibiSitemapUrl,
  maxSitemaps: 5,
  maxUrls: 30,
  allowedHostnames: ['www.ibinews.com', 'ibinews.com'],
  urlPattern: '\\.article(?:$|\\?)',
  pageTimeoutMs: 8000,
  sourceName: 'IBI News robots-advertised sitemap index',
};

export const ibiConfig: PublisherConfig = {
  publisherId: 'ibi',
  publisherName: 'IBI News',
  branding: {
    primaryColor: '#23445c',
    secondaryColor: '#e8f0f4',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    widgetTitle: 'Build your IBI News briefing',
    introductoryCopy: 'Tell us where you work and what you do. We will find relevant developments from IBI News coverage.',
    radiusPreference: 'soft',
    backgroundTreatment: 'plain',
  },
  content: { adapterType: 'sitemap', resultLimit: 8, candidateRetrievalLimit: 30 },
  results: {
    heading: 'Stories selected for your work',
    description: 'Relevant developments selected from IBI News coverage.',
    maximumRecommendations: 8,
    openArticleInNewTab: true,
  },
};

export const ibiManifest: PublisherManifest = {
  publisherId: 'ibi',
  name: 'IBI News',
  enabled: true,
  environment: 'production',
  publisherConfigVersion: '1',
  branding: {
    ...ibiConfig.branding,
    loading: { backgroundFallback: '#23445c', overlay: 'rgba(13,35,51,.42)', textColor: '#ffffff' },
    report: { backgroundFallback: '#23445c', overlay: 'rgba(13,35,51,.48)', textColor: '#ffffff' },
  },
  content: { adapterId: 'sitemap', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'keywords' },
  results: ibiConfig.results,
  ranking: { mode: 'hybrid', deterministicWeight: 0.7, semanticWeight: 0.3 },
  features: { aiEnabled: true, explanationsEnabled: true, analyticsEnabled: true },
  contentSource: ibiContentSource,
  allowedOrigins: ['https://ibinews.com', 'https://www.ibinews.com'],
  reportSections: ['top-developments', 'companies-to-watch', 'market-moves', 'technology-developments', 'more-relevant-stories'],
  primaryCTA: 'Build your IBI briefing',
  poweredBy: true,
};
