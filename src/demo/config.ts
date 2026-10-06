import type { PublisherConfig } from '../core';
import type { PublisherManifest } from '../publishers/manifest';

export const demoConfig: PublisherConfig = {
  publisherId: 'demo',
  publisherName: 'Northstar Journal',
  branding: {
    primaryColor: '#244d3b',
    secondaryColor: '#e8efe6',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    launcherText: 'Open professional briefing',
    widgetTitle: 'Build your Northstar briefing',
    introductoryCopy: 'Tell us where you work and what you do. We’ll build a considered briefing from our latest coverage.',
    radiusPreference: 'round',
    backgroundTreatment: 'tinted',
  },
  content: { adapterType: 'demo', resultLimit: 6, candidateRetrievalLimit: 16 },
  results: {
    heading: 'Stories selected for you',
    description: 'A few thoughtful places to begin, chosen from Northstar’s coverage.',
    maximumRecommendations: 6,
    openArticleInNewTab: true,
  },
};

export const demoManifest: PublisherManifest = {
  publisherId: 'demo',
  name: demoConfig.publisherName,
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { ...demoConfig.branding, loading: { backgroundFallback: '#dfe9dc', overlay: 'rgba(24,58,41,.38)', textColor: '#ffffff' }, report: { backgroundFallback: '#28583f', overlay: 'rgba(24,58,41,.48)', textColor: '#ffffff' } },
  content: { adapterId: demoConfig.content.adapterType, resultLimit: demoConfig.content.resultLimit, candidateRetrievalLimit: demoConfig.content.candidateRetrievalLimit, searchBehavior: 'keywords' },
  results: demoConfig.results,
  ranking: { mode: 'deterministic', deterministicWeight: 0.7, semanticWeight: 0.3 },
  features: { aiEnabled: true, explanationsEnabled: true, analyticsEnabled: true },
};
