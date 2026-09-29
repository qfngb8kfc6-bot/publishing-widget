import type { PublisherManifest } from '../manifest';

export const acmemediaManifest: PublisherManifest = {
  publisherId: 'acme-media',
  name: 'Replace with publisher name',
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { primaryAccent: '#244d3b', secondaryColor: '#e8efe6', launcherText: 'Find stories for you', widgetTitle: 'Your reading guide', introductoryCopy: 'Answer a few quick questions and we will find relevant stories.' },
  questions: [{ id: 'interest', question: 'What are you interested in?', type: 'free-text', required: true }],
  content: { adapterId: 'acme-media-api', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'intent' },
  results: { heading: 'Stories selected for you', maximumRecommendations: 8, openArticleInNewTab: true },
  features: { analyticsEnabled: true, explanationsEnabled: true, aiEnabled: false },
};
