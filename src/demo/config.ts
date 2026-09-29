import type { PublisherConfig } from '../core';
import type { PublisherManifest } from '../publishers/manifest';

export const demoConfig: PublisherConfig = {
  publisherId: 'demo',
  publisherName: 'Northstar Journal',
  branding: {
    primaryColor: '#244d3b',
    secondaryColor: '#e8efe6',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    launcherText: 'Find stories for you',
    widgetTitle: 'Your Northstar guide',
    introductoryCopy: 'Answer two quick questions and we’ll find a considered starting point from our latest coverage.',
    radiusPreference: 'round',
    backgroundTreatment: 'tinted',
  },
  questions: [
    {
      id: 'interest',
      question: 'What are you interested in?',
      supportingText: 'Choose a starting point and we’ll tune the reading list around it.',
      type: 'single-select',
      required: true,
      options: [
        { value: 'sustainability', label: 'Sustainability', description: 'Practical ideas for a more resilient future' },
        { value: 'technology', label: 'Technology', description: 'Tools and systems changing how we live' },
        { value: 'science', label: 'Science', description: 'New evidence about our world' },
        { value: 'culture', label: 'Culture & community', description: 'The ideas and places that connect us' },
        { value: 'business', label: 'Business & work', description: 'How organisations and people are adapting' },
        { value: 'health', label: 'Health & wellbeing', description: 'Better ways to live in a changing world' },
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
  branding: demoConfig.branding,
  questions: demoConfig.questions,
  content: { adapterId: demoConfig.content.adapterType, resultLimit: demoConfig.content.resultLimit, candidateRetrievalLimit: demoConfig.content.candidateRetrievalLimit, searchBehavior: 'keywords' },
  results: demoConfig.results,
  ranking: { mode: 'deterministic', deterministicWeight: 0.7, semanticWeight: 0.3 },
  features: { aiEnabled: true, explanationsEnabled: true, analyticsEnabled: true },
};
