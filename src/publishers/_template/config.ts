import type { PublisherManifest } from '../manifest';

export const templateManifest: PublisherManifest = {
  publisherId: 'replace-me',
  name: 'Replace Me Publisher',
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { primaryAccent: '#244d3b', secondaryColor: '#e8efe6', launcherText: 'Open professional briefing', widgetTitle: 'Build your publisher briefing', introductoryCopy: 'Tell us where you work and what you do. We will build a briefing from the publisher archive.' },
  content: { adapterId: 'replace-me-api', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'keywords' },
  results: { heading: 'Your professional briefing', maximumRecommendations: 8, openArticleInNewTab: true },
  ranking: { mode: 'deterministic' },
  features: { analyticsEnabled: true, explanationsEnabled: true, aiEnabled: false },
};
