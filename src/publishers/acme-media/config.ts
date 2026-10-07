import type { PublisherManifest } from '../manifest';

export const acmemediaManifest: PublisherManifest = {
  publisherId: 'acme-media',
  name: 'Replace with publisher name',
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { primaryAccent: '#244d3b', secondaryColor: '#e8efe6', widgetTitle: 'Build your publisher briefing', introductoryCopy: 'Tell us where you work and what you do. We will build a briefing from the publisher archive.' },
  content: { adapterId: 'acme-media-api', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'keywords' },
  results: { heading: 'Your professional briefing', maximumRecommendations: 8, openArticleInNewTab: true },
  features: { analyticsEnabled: true, explanationsEnabled: true, aiEnabled: false },
};
