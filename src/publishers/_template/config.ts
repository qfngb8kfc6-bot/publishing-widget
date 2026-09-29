import type { PublisherManifest } from '../manifest';

export const templateManifest: PublisherManifest = {
  publisherId: 'replace-me',
  name: 'Replace Me Publisher',
  enabled: true,
  environment: 'development',
  publisherConfigVersion: '1',
  branding: { primaryAccent: '#244d3b', secondaryColor: '#e8efe6', launcherText: 'Find stories for you', widgetTitle: 'Your reading guide', introductoryCopy: 'Answer a few quick questions and we will find relevant stories.' },
  questions: [{ id: 'interest', question: 'What are you interested in?', type: 'free-text', required: true, placeholder: 'Tell us what you want to read about' }],
  content: { adapterId: 'replace-me-api', resultLimit: 8, candidateRetrievalLimit: 30, searchBehavior: 'intent' },
  results: { heading: 'Stories selected for you', maximumRecommendations: 8, openArticleInNewTab: true },
  ranking: { mode: 'deterministic' },
  features: { analyticsEnabled: true, explanationsEnabled: true, aiEnabled: false },
};
