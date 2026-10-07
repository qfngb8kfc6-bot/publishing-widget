import { DEFAULT_THEME, type PublisherConfig } from '../core';
import type { PublisherManifest } from '../publishers/manifest';

export const demoConfig: PublisherConfig = {
  publisherId: 'demo',
  publisherName: 'Northstar Journal',
  branding: {
    primaryColor: DEFAULT_THEME.indigo,
    secondaryColor: DEFAULT_THEME.surfaceMuted,
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
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
  branding: { ...demoConfig.branding, loading: { backgroundFallback: DEFAULT_THEME.loadingBackground, overlay: 'rgba(21,26,58,.52)', textColor: '#ffffff' }, report: { backgroundFallback: DEFAULT_THEME.reportBackground, overlay: 'rgba(21,26,58,.55)', textColor: '#ffffff' } },
  content: { adapterId: demoConfig.content.adapterType, resultLimit: demoConfig.content.resultLimit, candidateRetrievalLimit: demoConfig.content.candidateRetrievalLimit, searchBehavior: 'keywords' },
  results: demoConfig.results,
  ranking: { mode: 'deterministic', deterministicWeight: 0.7, semanticWeight: 0.3 },
  features: { aiEnabled: true, explanationsEnabled: true, analyticsEnabled: true },
};
